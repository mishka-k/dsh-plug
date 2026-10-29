/**
 * dsh-mcp-manager — Host half.
 *
 * MCP servers in DSH are loader rows of `@deepseek-ai/dsh-mcp-client`, written by hand into the
 * profile patch. This plugin puts a page in front of those rows: list, add, edit, probe, enable,
 * disable, remove — for any MCP server, with the two transports the harness client understands
 * (`streamable-http`, and `stdio` when Config allows it).
 *
 * Persistence, the part that is easy to get wrong: `ctx.loader.create()` gives a live row but does
 * not write it anywhere, and rewriting the user's patch from a plugin would destroy its comments.
 * So the plugin keeps its own overlay next to the harness state —
 * `$DSH_HOME/mcp-manager/servers.json` (0600) — and reconciles it against the loader:
 *
 * - `created` — servers added from the page: rows the plugin owns and recreates on every start;
 * - `overrides` — edits to rows that live in the profile patch (edit without touching the patch);
 * - `disabled` / `removed` — switches and deletions applied to patch rows on start.
 *
 * Nothing about a particular server is hardcoded, and the protocol probe is a plain JSON-RPC
 * exchange (`initialize`, `notifications/initialized`, `tools/list`) — no MCP SDK dependency.
 *
 * Write surface: these routes listen on the plugin's own loopback origin without authentication,
 * which is why they are narrow by construction — a route can only create, edit or remove a row
 * whose module is `@deepseek-ai/dsh-mcp-client` and whose server name matches `[a-z0-9][a-z0-9-]*`.
 * It can never load another package. `stdio` rows spawn a command, so they stay behind
 * `config.allowStdio` (off by default).
 *
 * @module dsh-mcp-manager
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Loader module every managed row uses. */
const MCP_MODULE = '@deepseek-ai/dsh-mcp-client'
/** Route prefix of the page API. */
const ROUTE = '/plugin/mcp-manager'
/** Body cap for a write request, bytes. */
const BODY_LIMIT = 16 * 1024
/** Default probe timeout, ms. */
const DEFAULT_PROBE_MS = 8_000
/** Protocol version sent in `initialize`; servers negotiate down if they know an older one. */
const PROTOCOL_VERSION = '2025-06-18'
/** Server-name shape accepted from the page: lowercase, digits, dash. */
const SERVER_NAME = /^[a-z0-9][a-z0-9-]{1,30}$/
/** Delay before the first reconcile, ms: patch rows may mount after this plugin does. */
const RECONCILE_DELAY_MS = 150
/** Overlay directory and file. */
const STATE_DIR = join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'mcp-manager')
const STATE_FILE = join(STATE_DIR, 'servers.json')

export const name = 'mcp-manager'

/** The route needs the web server; loader, tools and credentials are read lazily. */
export const inject = ['webServer']

/**
 * Mount the page API and reconcile the overlay.
 * @param ctx - plugin context.
 * @param config - plugin row; `allowStdio` enables command-spawning rows.
 */
export function apply(ctx, config = {}) {
  const settings = {
    allowStdio: config.allowStdio === true,
    probeTimeoutMs: positive(config.probeTimeoutMs) ?? DEFAULT_PROBE_MS,
  }
  /** The overlay; every write goes through {@link saveState}. */
  let state = readState()

  const dispose = ctx.webServer.register({
    kind: 'prefix',
    path: ROUTE,
    handler: async (request, response) => {
      const url = new URL(request.url ?? ROUTE, 'http://127.0.0.1')
      const path = url.pathname.slice(ROUTE.length) || '/'
      try {
        if (request.method === 'GET' && path === '/servers') {
          await reply(response, page())
          return
        }
        if (request.method === 'POST' && path === '/servers') {
          await upsert(await json(request))
          await reply(response, page())
          return
        }
        if (request.method === 'PUT' && path === '/servers/enabled') {
          await setEnabled(await json(request))
          await reply(response, page())
          return
        }
        if (request.method === 'DELETE' && path === '/servers') {
          await remove(url.searchParams.get('id'))
          await reply(response, page())
          return
        }
        if (request.method === 'POST' && path === '/restore') {
          await restore(await json(request))
          await reply(response, page())
          return
        }
        if (request.method === 'POST' && path === '/probe') {
          await reply(response, await probe(await json(request)))
          return
        }
        response.statusCode = 404
        response.end()
      } catch (error) {
        const status = error instanceof BadRequest ? 400 : 500
        response.statusCode = status
        response.setHeader('content-type', 'application/json; charset=utf-8')
        response.end(JSON.stringify({ error: message(error) }))
      }
    },
  })
  ctx.effect(() => () => dispose(), 'mcp-manager: page routes')

  // Patch rows mount around this plugin, so the overlay is applied on a later tick and again
  // whenever the page asks for the list.
  const timer = setTimeout(() => {
    try {
      reconcile()
    } catch (error) {
      console.error('[mcp-manager] reconcile failed:', message(error))
    }
  }, RECONCILE_DELAY_MS)
  ctx.effect(() => () => clearTimeout(timer), 'mcp-manager: reconcile timer')

  /** @returns the loader service, or throws when this profile exposes none. */
  function loader() {
    const service = ctx.get('loader')
    if (service === undefined || service === null) throw new Error('the loader service is unavailable')
    return service
  }

  /** @returns every managed MCP row, current tree. */
  function rows() {
    try {
      return [...loader().entries()].filter((entry) => entry?.options?.name === MCP_MODULE)
    } catch {
      return []
    }
  }

  /** @returns the page payload. */
  function page() {
    return {
      servers: listServers(),
      allowStdio: settings.allowStdio,
      hidden: Object.keys(state.removed),
    }
  }

  /** @returns the page view of every managed row. */
  function listServers() {
    return rows()
      .map(view)
      .sort((left, right) => String(left.serverName).localeCompare(String(right.serverName)))
  }

  /** @returns the page view of one row. */
  function view(entry) {
    const row = entry.options ?? {}
    const rowConfig = row.config ?? {}
    const serverName = typeof rowConfig.serverName === 'string' ? rowConfig.serverName : row.id
    return {
      id: row.id,
      serverName,
      transport: rowConfig.transport === 'stdio' ? 'stdio' : 'streamable-http',
      url: typeof rowConfig.url === 'string' ? rowConfig.url : null,
      command: typeof rowConfig.command === 'string' ? rowConfig.command : null,
      args: Array.isArray(rowConfig.args) ? rowConfig.args : [],
      headers: Object.keys(rowConfig.headers ?? {}),
      origin: state.created[row.id] === undefined ? 'patch' : 'plugin',
      enabled: row.disabled !== true,
      active: entry.fiber !== undefined && entry.fiber !== null,
      tools: toolCount(serverName),
    }
  }

  /**
   * Registered tool count for one server. MCP tools are published as `mcp__<server>__<tool>`, so
   * the registry is enough; a server whose tools are scoped elsewhere reports 0 and the page
   * simply omits the number.
   * @param serverName - MCP server name.
   * @returns registered tool count.
   */
  function toolCount(serverName) {
    const tools = ctx.get('tools')
    if (tools === undefined || tools === null) return 0
    try {
      const prefix = `mcp__${serverName.replace(/[^a-zA-Z0-9_]/g, '_')}__`
      return tools.schemas().filter((schema) => String(schema.name).startsWith(prefix)).length
    } catch {
      return 0
    }
  }

  /**
   * Bring the live tree in line with the overlay: create owned rows, apply edits, switches and
   * removals. Safe to call repeatedly.
   */
  function reconcile() {
    const service = loader()
    for (const [id, rowConfig] of Object.entries(state.created)) {
      if (rows().some((entry) => entry.options.id === id)) continue
      void service.create({ id, name: MCP_MODULE, config: rowConfig }).catch((error) => {
        console.error(`[mcp-manager] could not create ${id}:`, message(error))
      })
    }
    for (const entry of rows()) {
      const id = entry.options.id
      if (state.removed[id] === true) {
        service.remove(id)
        continue
      }
      const patch = {}
      const override = state.overrides[id]
      if (override !== undefined && !sameConfig(entry.options.config, override)) patch.config = override
      const wantedDisabled = state.disabled[id] === true
      if ((entry.options.disabled === true) !== wantedDisabled) patch.disabled = wantedDisabled
      if (Object.keys(patch).length === 0) continue
      void service.update(id, patch).catch((error) => {
        console.error(`[mcp-manager] could not update ${id}:`, message(error))
      })
    }
  }

  /**
   * Create or update one row.
   * @param body - page input.
   */
  async function upsert(body) {
    const record = asRecord(body)
    const serverName = normalizeName(record.serverName)
    const transport = record.transport === 'stdio' ? 'stdio' : 'streamable-http'
    if (transport === 'stdio' && !settings.allowStdio) {
      throw new BadRequest('stdio transport is disabled for this plugin (allowStdio: false)')
    }
    const rowConfig = { serverName, transport }
    if (transport === 'streamable-http') {
      rowConfig.url = requireUrl(record.url)
      const headers = normalizeHeaders(record.headers)
      if (headers !== undefined) rowConfig.headers = headers
    } else {
      rowConfig.command = requireText(record.command, 'command')
      const args = Array.isArray(record.args) ? record.args.map((arg) => String(arg)) : []
      if (args.length > 0) rowConfig.args = args
      if (typeof record.cwd === 'string' && record.cwd.trim() !== '') rowConfig.cwd = record.cwd.trim()
    }

    const requestedId = typeof record.id === 'string' && record.id !== '' ? record.id : undefined
    const existing = requestedId === undefined ? undefined : rows().find((entry) => entry.options.id === requestedId)
    if (existing !== undefined) {
      const id = existing.options.id
      // The page never receives header values, so an empty field on an existing server means
      // "keep the headers that are already configured", not "drop them".
      if (transport === 'streamable-http' && rowConfig.headers === undefined) {
        const current = existing.options.config?.headers
        if (current !== undefined) rowConfig.headers = current
      }
      if (state.created[id] !== undefined) state.created[id] = rowConfig
      else state.overrides[id] = rowConfig
      delete state.removed[id]
      saveState(state)
      await loader().update(id, { config: rowConfig, disabled: state.disabled[id] === true })
      return
    }
    const id = nextId(serverName)
    state.created[id] = rowConfig
    delete state.disabled[id]
    delete state.removed[id]
    saveState(state)
    await loader().create({ id, name: MCP_MODULE, config: rowConfig })
  }

  /**
   * Switch one row on or off.
   * @param body - `{ id, enabled }`.
   */
  async function setEnabled(body) {
    const record = asRecord(body)
    const entry = findRow(record.id)
    const id = entry.options.id
    const enabled = record.enabled === true
    if (enabled) delete state.disabled[id]
    else state.disabled[id] = true
    delete state.removed[id]
    saveState(state)
    await loader().update(id, { disabled: !enabled })
  }

  /**
   * Remove one row. Owned rows are deleted outright; a patch row is removed from the live tree and
   * remembered as hidden, because its patch entry would recreate it on the next start.
   * @param id - row id.
   */
  async function remove(id) {
    const entry = findRow(id)
    const rowId = entry.options.id
    const owned = state.created[rowId] !== undefined
    delete state.created[rowId]
    delete state.overrides[rowId]
    delete state.disabled[rowId]
    // A patch row would come back on the next start, so its removal is remembered instead.
    if (!owned) state.removed[rowId] = true
    saveState(state)
    loader().remove(rowId)
  }

  /**
   * Bring back rows hidden by a removal.
   * @param body - `{ id }` for one row, or `{}` for every hidden row.
   */
  async function restore(body) {
    const record = asRecord(body)
    const ids = typeof record.id === 'string' && record.id !== '' ? [record.id] : Object.keys(state.removed)
    for (const id of ids) delete state.removed[id]
    saveState(state)
    reconcile()
  }

  /** @returns the managed row with this id, or throws a 400. */
  function findRow(id) {
    if (typeof id !== 'string' || id === '') throw new BadRequest('id is required')
    const entry = rows().find((candidate) => candidate.options.id === id)
    if (entry === undefined) throw new BadRequest(`unknown server row: ${id}`)
    return entry
  }

  /** @returns a unique row id derived from the server name. */
  function nextId(serverName) {
    const taken = new Set(rows().map((entry) => entry.options.id))
    const base = `mcp-${serverName}`
    if (!taken.has(base) && state.created[base] === undefined) return base
    let index = 2
    while (taken.has(`${base}-${index}`) || state.created[`${base}-${index}`] !== undefined) index += 1
    return `${base}-${index}`
  }

  /**
   * Speak just enough MCP to answer "does this server work and what does it expose".
   * Standard Streamable HTTP: `initialize`, `notifications/initialized`, `tools/list`, carrying the
   * session id the server returns on the first response.
   * @param body - `{ url, headers }`.
   * @returns probe outcome.
   */
  async function probe(body) {
    const record = asRecord(body)
    const transport = record.transport === 'stdio' ? 'stdio' : 'streamable-http'
    if (transport === 'stdio') {
      return { ok: false, error: 'probe supports streamable-http only', tools: [] }
    }
    const url = requireUrl(record.url)
    const headers = normalizeHeaders(record.headers) ?? {}
    try {
      const answer = await exchange(url, headers)
      return {
        ok: true,
        serverInfo: answer.serverInfo ?? null,
        protocolVersion: answer.protocolVersion ?? null,
        tools: answer.tools,
      }
    } catch (error) {
      const reason = message(error)
      // A stateful server that the harness already holds answers a second handshake this way; it
      // means "this server is up", not "this server is broken".
      if (/already initialized|already connected|session/i.test(reason) && /HTTP 4\d\d/.test(reason)) {
        return { ok: true, note: 'already connected', tools: [] }
      }
      return { ok: false, error: reason, tools: [] }
    }
  }

  /** @returns server info and tool names from one handshake. */
  async function exchange(url, headers) {
    const send = async (payload, session) => {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          'user-agent': 'dsh-mcp-manager',
          ...headers,
          ...(session === undefined || session === null ? {} : { 'mcp-session-id': session }),
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(settings.probeTimeoutMs),
      })
      const text = await response.text()
      if (!response.ok) throw new Error(httpReason(response.status, text))
      return { response, payload: parseBody(text) }
    }
    const init = await send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'dsh-mcp-manager', version: '0.1.0' },
      },
    })
    if (init.payload?.error !== undefined) throw new Error(init.payload.error.message ?? 'initialize failed')
    const session = init.response.headers.get('mcp-session-id')
    await send({ jsonrpc: '2.0', method: 'notifications/initialized' }, session)
    const list = await send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }, session)
    if (list.payload?.error !== undefined) throw new Error(list.payload.error.message ?? 'tools/list failed')
    const tools = Array.isArray(list.payload?.result?.tools) ? list.payload.result.tools : []
    return {
      serverInfo: init.payload?.result?.serverInfo,
      protocolVersion: init.payload?.result?.protocolVersion,
      tools: tools.map((tool) => ({ name: String(tool?.name ?? ''), description: String(tool?.description ?? '') })),
    }
  }
}

/** A rejected page request; the handler answers 400 with its message. */
class BadRequest extends Error {}

/** @returns the overlay, empty when the file is missing or broken. */
function readState() {
  const empty = { created: {}, overrides: {}, disabled: {}, removed: {} }
  try {
    const raw = JSON.parse(readFileSync(STATE_FILE, 'utf8'))
    return {
      created: asRecord(raw?.created),
      overrides: asRecord(raw?.overrides),
      disabled: asRecord(raw?.disabled),
      removed: asRecord(raw?.removed),
    }
  } catch {
    return empty
  }
}

/** Write the overlay atomically, owner-readable only. */
function saveState(state) {
  mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 })
  const temp = `${STATE_FILE}.tmp`
  writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 })
  renameSync(temp, STATE_FILE)
}

/** @returns whether two row configs describe the same server. */
function sameConfig(left, right) {
  try {
    return JSON.stringify(left ?? {}) === JSON.stringify(right ?? {})
  } catch {
    return false
  }
}

/** @returns the JSON body, or 400 when it is not a JSON object. */
async function json(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > BODY_LIMIT) throw new BadRequest('body too large')
    chunks.push(chunk)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (text.trim() === '') return {}
  try {
    const value = JSON.parse(text)
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}
  } catch {
    throw new BadRequest('body must be a JSON object')
  }
}

/** Write one JSON answer. */
async function reply(response, value) {
  response.statusCode = 200
  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.setHeader('cache-control', 'no-store')
  response.end(JSON.stringify(value))
}

/** @returns the object body or an empty record. */
function asRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

/** @returns a validated server name. */
function normalizeName(value) {
  const name = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (!SERVER_NAME.test(name)) {
    throw new BadRequest('server name must be 2-31 characters of lowercase letters, digits or dashes')
  }
  return name
}

/** @returns a validated http(s) URL. */
function requireUrl(value) {
  const text = requireText(value, 'url')
  let url
  try {
    url = new URL(text)
  } catch {
    throw new BadRequest('url must be absolute')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new BadRequest('url must use http or https')
  return url.href
}

/** @returns a non-empty trimmed string. */
function requireText(value, field) {
  const text = typeof value === 'string' ? value.trim() : ''
  if (text === '') throw new BadRequest(`${field} is required`)
  return text
}

/**
 * @param value - header map or a list of `Key: Value` lines.
 * @returns a clean header map, or undefined when there is nothing to send.
 */
function normalizeHeaders(value) {
  const pairs = []
  if (typeof value === 'string') {
    for (const line of value.split('\n')) {
      const trimmed = line.trim()
      if (trimmed === '') continue
      const at = trimmed.indexOf(':')
      if (at <= 0) throw new BadRequest('headers must be one "Key: Value" per line')
      pairs.push([trimmed.slice(0, at), trimmed.slice(at + 1)])
    }
  } else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, entry] of Object.entries(value)) pairs.push([key, String(entry)])
  } else {
    return undefined
  }
  const headers = {}
  for (const [rawKey, rawValue] of pairs) {
    const key = rawKey.trim()
    const headerValue = rawValue.trim()
    if (key === '') continue
    if (/^(host|content-length|connection)$/i.test(key)) throw new BadRequest(`header "${key}" is not allowed`)
    if (/[\r\n]/.test(headerValue)) throw new BadRequest('header values must be single-line')
    headers[key] = headerValue
  }
  return Object.keys(headers).length === 0 ? undefined : headers
}

/**
 * @param text - response body, plain JSON or an SSE stream.
 * @returns the last JSON message of the body.
 */
function parseBody(text) {
  const trimmed = text.trim()
  if (trimmed === '') return {}
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed)
    } catch {
      return {}
    }
  }
  let last = {}
  for (const line of trimmed.split('\n')) {
    const value = line.startsWith('data:') ? line.slice(5).trim() : ''
    if (value === '' || value === '[DONE]') continue
    try {
      last = JSON.parse(value)
    } catch {
      // A non-JSON SSE frame is not the answer we are looking for.
    }
  }
  return last
}

/** @returns a short reason for a failed HTTP probe. */
function httpReason(status, body) {
  const parsed = parseBody(body)
  const detail = parsed?.error?.message ?? parsed?.message ?? ''
  return detail === '' ? `HTTP ${status}` : `HTTP ${status}: ${detail}`
}

/** @returns a positive number from Config, or undefined. */
function positive(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

/** @returns an error message without a stack. */
function message(error) {
  return error instanceof Error ? error.message : String(error)
}
