/**
 * dsh-subagent-routes — Host half.
 *
 * DSH can let an agent pick a provider and model for each subagent, but three things stand between
 * a user and that behaviour:
 *
 * 1. the tool is closed by default — `tool-subagent` carries `modelSelectionSettings: false`, and the
 *    route list only exists once the `subagent-model-selection` settings section says so;
 * 2. the policy is written for a *fresh* session only. `@deepseek-ai/dsh-tool-subagent` computes
 *    `freshSession = target.firstLiveSeq === 0` and appends `subagent/model-selection-policy` only
 *    then, so every resumed chat has no policy and therefore no choice, forever;
 * 3. reasoning effort cannot be chosen through that policy at all: the event carries
 *    `allowedModels: [{ provider, model }]` and nothing else. The effort a child gets is either the
 *    tool row's `agentOptions.reasoningEffort` default or what the parent passes per call.
 *
 * This plugin closes the second gap, and it is the only one a plugin can close without patching
 * foreign code: on `session/created` it appends the same durable event the harness would have
 * written, before the agent is announced and tools are composed. Children are skipped — they inherit
 * their parent's policy. Nothing is written while the settings section switch is off.
 *
 * `subagent/model-selection-policy` is a documented member of the session event map
 * (`SessionEventMap` in `@deepseek-ai/dsh-session`), so the record is a supported write.
 *
 * @module dsh-subagent-routes
 */

export const name = 'subagent-routes'

/** Route prefix of the page API. */
const ROUTE = '/plugin/subagent-routes'
/** Profiles rows whose `agentOptions` carry the child default. */
const TOOL_ROWS = ['tool-subagent', 'tool-subagent-fork']
/** Body cap for one write, bytes. */
const BODY_LIMIT = 8 * 1024

/**
 * The session service owns the policy append; the settings service persists the child defaults; the
 * model registry answers which efforts exist. All but the session service are optional so a profile
 * without them still mounts.
 */
export const inject = ['sessions', 'webServer']

/**
 * Mount the backfill.
 * @param ctx - plugin context.
 */
export function apply(ctx) {
  /** Sessions this plugin has already patched, for the status line of the settings page. */
  let patched = 0

  const backfill = (session) => {
    try {
      const settings = ctx.get('subagentModelSelection')
      const projections = ctx.get('sessionProjections')
      if (settings === undefined || projections === undefined) return
      // A child inherits its parent's policy; writing one would be noise, not a choice.
      if (session.header?.origin === 'subagent') return
      const current = settings.current()
      if (current.enabled !== true) return
      const existing = projections.stateOf(session, 'subagentModelSelectionPolicy')
      if (existing !== null && existing !== undefined) return
      const routes = Array.isArray(current.allowedModels) ? current.allowedModels : []
      if (routes.length === 0) return
      session.append('subagent/model-selection-policy', {
        allowedModels: routes.map((route) => ({ provider: route.provider, model: route.model })),
      })
      patched += 1
      ctx.get('logger')?.info?.(
        `subagent-routes: policy granted to session ${session.id} (${routes.length} routes)`,
      )
    } catch (error) {
      // Opening a session must never fail because of this plugin.
      ctx.get('logger')?.warn?.(`subagent-routes: ${String(error)}`)
    }
  }

  ctx.on('session/created', backfill)

  const dispose = ctx.webServer.register({
    kind: 'prefix',
    path: ROUTE,
    handler: async (request, response) => {
      const path = new URL(request.url ?? ROUTE, 'http://127.0.0.1').pathname.slice(ROUTE.length) || '/'
      try {
        if (request.method === 'GET' && path === '/status') {
          await reply(response, { patched, ...(await readEffort()) })
          return
        }
        if (request.method === 'PUT' && path === '/effort') {
          throw new BadRequest(
            'the child default cannot be persisted: the Subagent tool rows belong to a bundle, and a ' +
              'plugin cannot rewrite their config — set agentOptions.reasoningEffort in the profile patch instead',
          )
        }
        response.statusCode = 404
        response.end()
      } catch (error) {
        const status = error instanceof BadRequest ? 400 : 500
        response.statusCode = status
        response.setHeader('content-type', 'application/json; charset=utf-8')
        response.end(JSON.stringify({ error: String(error?.message ?? error) }))
      }
    },
  })
  ctx.effect(() => () => dispose(), 'subagent-routes: page routes')


  /**
   * @returns the child default in force plus the efforts the allowed routes actually offer: the UI
   *   must not invent an effort the current adapters would reject at delegation time.
   */
  async function readEffort() {
    const loader = ctx.get('loader')
    const values = new Set()
    let current = null
    for (const entry of loader === undefined || loader === null ? [] : [...loader.entries()]) {
      if (!TOOL_ROWS.includes(String(entry?.options?.id ?? ''))) continue
      const effort = entry.options.config?.agentOptions?.reasoningEffort
      if (typeof effort === 'string' && effort !== '' && current === null) current = effort
    }
    const candidateRoutes = await allowedRoutes()
    for (const effort of await effortsFor(candidateRoutes)) values.add(effort)
    return {
      effort: current,
      efforts: [...values].sort(),
      rows: TOOL_ROWS.filter((id) =>
        loader === undefined || loader === null ? false : [...loader.entries()].some((entry) => entry?.options?.id === id),
      ),
    }
  }

  /** @returns the routes the settings section currently allows, so the effort list stays relevant. */
  async function allowedRoutes() {
    const selection = ctx.get('subagentModelSelection')
    const current = selection?.current?.()
    const routes = Array.isArray(current?.allowedModels) ? current.allowedModels : []
    return routes.filter((route) => typeof route?.provider === 'string' && typeof route?.model === 'string')
  }

  /** @returns every effort id any of these routes offers, through the live model registry. */
  async function effortsFor(routes) {
    const llm = ctx.get('llm')
    if (llm === undefined || llm === null) return []
    const found = new Set()
    for (const route of routes) {
      try {
        const info = await llm.resolveModelInfo(route.provider, route.model)
        for (const effort of info?.reasoning?.efforts ?? []) {
          if (typeof effort?.id === 'string' && effort.id !== '') found.add(effort.id)
        }
      } catch {
        // A provider that cannot answer right now simply contributes nothing.
      }
    }
    return found
  }


}

/** A rejected page request; the handler answers 400 with its message. */
class BadRequest extends Error {}

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

/** @returns whether two plain values are structurally equal. */
function sameJson(left, right) {
  try {
    return JSON.stringify(left ?? {}) === JSON.stringify(right ?? {})
  } catch {
    return false
  }
}

