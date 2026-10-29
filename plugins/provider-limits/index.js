/**
 * dsh-provider-limits — Host half.
 *
 * The composer dock already shows cache hit, tok/s and the context meter. What it does not
 * show is how much of each subscription is left and how much money sits on the provider
 * account. This half owns the network, the secrets and the user's choice of which pills show.
 *
 * Keys come from the harness `credentials` service (the same store the models use), so no
 * secret ever reaches the browser. The Client half polls `GET /plugin/provider-limits` and the
 * snapshot behind it is cached for `refreshMs`.
 *
 * Two layers of settings, on purpose:
 * - the plugin Config (profile patch) owns the provider catalogue — endpoints, key names, labels;
 * - a small user store under `$DSH_HOME/provider-limits/settings.json` owns visibility — which
 *   providers the dock shows and how often the snapshot refreshes. Only that second layer is
 *   writable from the Settings page, and the write route accepts nothing but ids and a number,
 *   so a stray local request can never redirect a key to another host.
 *
 * @module dsh-provider-limits
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Route path; the Client half calls exactly this. */
const ROUTE_PATH = '/plugin/provider-limits'
/** Route that carries the provider catalogue and the user store. */
const CONFIG_PATH = '/plugin/provider-limits/config'
/** Body cap for the settings write, bytes. */
const BODY_LIMIT = 8 * 1024
/** Bounds for the refresh interval accepted from the page, ms. */
const MIN_REFRESH_MS = 15_000
const MAX_REFRESH_MS = 3_600_000
/**
 * User-Agent sent to providers: some CDNs (opencode.ai among them) reject the runtime's
 * default `node` agent, just like they reject Python's urllib, with a 403.
 */
const USER_AGENT = 'curl/8.7.1'
/** Timeout of a single provider request, ms. */
const HTTP_TIMEOUT_MS = 15_000
/** How long a snapshot lives in memory when the user store does not override it, ms. */
const DEFAULT_REFRESH_MS = 120_000
/** Where the user store lives. */
const SETTINGS_DIR = join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'provider-limits')
const SETTINGS_FILE = join(SETTINGS_DIR, 'settings.json')

/**
 * Default providers — public API addresses and environment variable names, no keys and no
 * personal data. Every field can be overridden in Config.
 */
const DEFAULT_PROVIDERS = [
  {
    id: 'opencode',
    kind: 'opencode-zen',
    label: 'OpenCode',
    short: 'OC',
    keyRef: 'OPENCODE_GO_API_KEY',
    url: 'https://opencode.ai/zen/go/v1/usage',
  },
  {
    id: 'zai',
    kind: 'zai-quota',
    label: 'GLM Coding Plan',
    short: 'GLM',
    keyRef: 'ZAI_API_KEY',
    url: 'https://api.z.ai/api/monitor/usage/quota/limit',
  },
  {
    id: 'deepseek',
    kind: 'balance-account',
    label: 'DeepSeek',
    short: 'DS',
    keyRef: 'DEEPSEEK_API_KEY',
    url: 'https://api.deepseek.com/user/balance',
    fallback: 'balance-api',
  },
]

export const name = 'provider-limits'

/**
 * Only the routes are required. Keys (`credentials`) and the account (`deepseekAccount`) are
 * read lazily through ctx.get, so a profile without them still mounts: the affected pill
 * simply reports an error.
 */
export const inject = ['webServer']

/**
 * Mount the routes, the snapshot cache and the user store.
 * @param ctx - plugin context.
 * @param config - plugin row from cordis.patch.yml; every field is optional.
 */
export function apply(ctx, config = {}) {
  const settings = {
    refreshMs: positive(config.refreshMs) ?? DEFAULT_REFRESH_MS,
    providers: resolveProviders(config),
    accountLocale:
      typeof config.accountLocale === 'string' && config.accountLocale !== '' ? config.accountLocale : 'en',
    accountVersion:
      typeof config.accountVersion === 'string' && config.accountVersion !== '' ? config.accountVersion : name,
  }

  /** User store: which providers are visible, and an optional refresh override. */
  let user = readStore()
  /** Last snapshot and when it was built (ms); 0 means not built yet. */
  let snapshot = { updatedAt: 0, fetchedAt: null, providers: [] }
  /** Shared build promise: concurrent Client requests never multiply provider calls. */
  let inFlight = undefined

  const routeDispose = ctx.webServer.register({
    kind: 'exact',
    path: ROUTE_PATH,
    handler: async (request, response) => {
      if (request.method !== 'GET') return methodNotAllowed(response)
      await answer(response, async () => await current())
    },
  })
  ctx.effect(() => () => routeDispose(), 'provider-limits: snapshot route')

  const configDispose = ctx.webServer.register({
    kind: 'exact',
    path: CONFIG_PATH,
    handler: async (request, response) => {
      if (request.method === 'GET') {
        await answer(response, async () => catalogue())
        return
      }
      if (request.method === 'PUT') {
        await answer(response, async () => await writeStore(request))
        return
      }
      methodNotAllowed(response, ['GET', 'PUT'])
    },
  })
  ctx.effect(() => () => configDispose(), 'provider-limits: config route')

  /** @returns the snapshot, refreshed when older than the effective interval. */
  async function current() {
    if (snapshot.updatedAt !== 0 && Date.now() - snapshot.updatedAt < effectiveRefreshMs()) return snapshot
    if (inFlight !== undefined) return await inFlight
    inFlight = refresh().finally(() => {
      inFlight = undefined
    })
    return await inFlight
  }

  /** @returns the rebuild of the snapshot over the visible providers. */
  async function refresh() {
    const providers = await Promise.all(visibleProviders().map(readProvider))
    snapshot = { updatedAt: Date.now(), fetchedAt: new Date().toISOString(), providers }
    return snapshot
  }

  /** @returns the provider catalogue with the user's visibility applied. */
  function catalogue() {
    return {
      providers: settings.providers.map((provider) => ({
        id: provider.id,
        label: provider.label ?? provider.id,
        short: provider.short ?? provider.id,
        kind: provider.kind ?? null,
        enabled: isVisible(provider.id),
      })),
      refreshMs: effectiveRefreshMs(),
      minRefreshMs: MIN_REFRESH_MS,
      maxRefreshMs: MAX_REFRESH_MS,
      updatedAt: snapshot.updatedAt === 0 ? null : new Date(snapshot.updatedAt).toISOString(),
    }
  }

  /**
   * Persist a settings patch from the page. Only ids and a number are accepted: the write
   * route never touches endpoints or key names.
   * @param request - the PUT request.
   * @returns the catalogue after the write.
   */
  async function writeStore(request) {
    const patch = parseBody(await readBody(request))
    let changed = false
    if (patch.enabled !== undefined) {
      if (!Array.isArray(patch.enabled) || patch.enabled.some((id) => typeof id !== 'string')) {
        throw new BadRequest('enabled must be an array of provider ids')
      }
      const known = new Set(settings.providers.map((provider) => provider.id))
      const unknown = patch.enabled.filter((id) => !known.has(id))
      if (unknown.length > 0) throw new BadRequest(`unknown provider id: ${unknown.join(', ')}`)
      const all = new Set(patch.enabled).size === known.size
      user.enabled = all ? null : [...new Set(patch.enabled)]
      changed = true
    }
    if (patch.refreshMs !== undefined) {
      const value = Number(patch.refreshMs)
      if (!Number.isFinite(value) || value < MIN_REFRESH_MS || value > MAX_REFRESH_MS) {
        throw new BadRequest(`refreshMs must be between ${MIN_REFRESH_MS} and ${MAX_REFRESH_MS}`)
      }
      user.refreshMs = Math.round(value)
      changed = true
    }
    if (!changed) return catalogue()
    writeStoreFile(user)
    snapshot = { updatedAt: 0, fetchedAt: null, providers: [] }
    return catalogue()
  }

  /** @returns providers the dock should show. */
  function visibleProviders() {
    return settings.providers.filter((provider) => isVisible(provider.id))
  }

  /** @returns whether one provider is switched on by the user store. */
  function isVisible(id) {
    if (user.enabled === null || user.enabled === undefined) return true
    return user.enabled.includes(id)
  }

  /** @returns the refresh interval in force, ms. */
  function effectiveRefreshMs() {
    return positive(user.refreshMs) ?? settings.refreshMs
  }

  /**
   * One provider: a failure never takes its neighbours down, it lands in `error`.
   * @param provider - entry of the provider list.
   * @returns snapshot element.
   */
  async function readProvider(provider) {
    const base = { id: provider.id, label: provider.label, short: provider.short }
    const kinds = [provider.kind, provider.fallback].filter((kind) => typeof kind === 'string' && kind !== '')
    let lastError
    for (const kind of kinds) {
      const adapter = ADAPTERS[kind]
      if (adapter === undefined) {
        lastError = `unknown kind "${kind}"`
        continue
      }
      try {
        const value = await adapter(provider)
        if (value.error !== undefined) {
          lastError = value.error
          continue
        }
        return { ...base, kind, ...value }
      } catch (error) {
        lastError = message(error)
      }
    }
    return { ...base, error: lastError ?? 'no data' }
  }

  /**
   * Resolve one secret through the credentials service; it never reaches logs or responses.
   * @param ref - environment variable name (CredentialRef).
   * @returns the value, or undefined when it is not configured.
   */
  async function key(ref) {
    if (typeof ref !== 'string' || ref === '') return undefined
    const service = ctx.get('credentials')
    if (service === undefined || service === null) return undefined
    const resolved = await service.resolve(ref)
    const value = resolved?.value
    return typeof value === 'string' && value !== '' ? value : undefined
  }

  /**
   * Platform account balance through the harness service — the same wallets Settings →
   * Account shows.
   * @returns wallets, or an error.
   */
  async function accountBalance() {
    const service = ctx.get('deepseekAccount')
    if (service === undefined || service === null) return { error: 'account service unavailable' }
    const details = await service.getBalance({
      version: settings.accountVersion,
      locale: settings.accountLocale,
      timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
    })
    if (details === null || details?.status !== 'ready') return { error: 'account returned no balance' }
    const wallets = [...(details.value ?? []), ...(details.bonusWallets ?? [])]
      .map((wallet) => ({ currency: wallet.currency, amount: Number(wallet.balance) }))
      .filter((wallet) => typeof wallet.currency === 'string' && Number.isFinite(wallet.amount))
    if (wallets.length === 0) return { error: 'no wallets' }
    return { display: 'money', wallets: sumByCurrency(wallets) }
  }

  /** @returns the API-key balance of a provider. */
  async function apiBalance(provider) {
    const token = await key(provider.keyRef)
    if (token === undefined) return { error: `no ${provider.keyRef} credential` }
    const body = await getJson(provider.url, token)
    const infos = Array.isArray(body?.balance_infos) ? body.balance_infos : []
    const wallets = infos
      .map((info) => ({ currency: info?.currency, amount: Number(info?.total_balance) }))
      .filter((wallet) => typeof wallet.currency === 'string' && Number.isFinite(wallet.amount))
    if (wallets.length === 0) return { error: 'no balances in response' }
    return { display: 'money', wallets }
  }

  /** @returns OpenCode Zen Go quota windows: rolling (5h), weekly, monthly. */
  async function opencodeZen(provider) {
    const token = await key(provider.keyRef)
    if (token === undefined) return { error: `no ${provider.keyRef} credential` }
    const body = await getJson(provider.url, token)
    const usage = body?.usage ?? {}
    const windows = ['rolling', 'weekly', 'monthly'].flatMap((name) => {
      const window = usage?.[name]
      if (window === undefined || window === null) return []
      return [
        {
          label: name,
          percent: percentOf(window.percent),
          resetsAt: resetsAt(window.resetsAt),
          status: typeof window.status === 'string' ? window.status : null,
        },
      ]
    })
    if (windows.length === 0) return { error: 'no windows in response' }
    return { display: 'percent', percent: tightest(windows), windows }
  }

  /** @returns GLM Coding Plan quota windows: entries of `data.limits[]`. */
  async function zaiQuota(provider) {
    const token = await key(provider.keyRef)
    if (token === undefined) return { error: `no ${provider.keyRef} credential` }
    const body = await getJson(provider.url, token)
    const data = body?.data ?? {}
    const limits = Array.isArray(data.limits) ? data.limits : []
    if (limits.length === 0) return { error: 'no windows in response' }
    const windows = limits.map((limit, index) => ({
      // `unit`/`number` spell the window out: the live answer sends 5 hours and 1 month.
      label: quotaWindowLabel(limit?.unit, limit?.number) ?? `w${index + 1}`,
      percent: percentOf(limit?.percentage),
      resetsAt: resetsAt(limit?.nextResetTime),
      remaining: numberOrNull(limit?.remaining),
      total: numberOrNull(limit?.usage),
    }))
    return {
      display: 'percent',
      level: typeof data.level === 'string' ? data.level : null,
      percent: tightest(windows),
      windows,
    }
  }

  /**
   * Adapter table: `kind` → reader. An adapter result is either
   * `{ display, percent, windows }` / `{ display, wallets }` or `{ error }`.
   */
  const ADAPTERS = {
    'opencode-zen': opencodeZen,
    'zai-quota': zaiQuota,
    'balance-account': accountBalance,
    'balance-api': apiBalance,
  }

  /** One bearer-token GET; a non-2xx response throws with its status. */
  async function getJson(url, token) {
    if (typeof url !== 'string' || url === '') throw new Error('no url configured')
    const response = await fetch(url, {
      headers: { authorization: `Bearer ${token}`, 'user-agent': USER_AGENT, accept: 'application/json' },
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return await response.json()
  }
}

/** A rejected settings write; the handler answers 400 with its message. */
class BadRequest extends Error {}

/** @returns the JSON body of `response`, or 400 on a bad request. */
async function answer(response, produce) {
  try {
    const body = JSON.stringify(await produce())
    response.statusCode = 200
    response.setHeader('content-type', 'application/json; charset=utf-8')
    response.setHeader('cache-control', 'no-store')
    response.end(body)
  } catch (error) {
    const status = error instanceof BadRequest ? 400 : 500
    response.statusCode = status
    response.setHeader('content-type', 'application/json; charset=utf-8')
    response.end(JSON.stringify({ error: message(error) }))
  }
}

/** @returns 405 with the allowed methods. */
function methodNotAllowed(response, methods = ['GET']) {
  response.statusCode = 405
  response.setHeader('allow', methods.join(', '))
  response.end()
}

/** @returns the request body, capped at BODY_LIMIT bytes. */
async function readBody(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > BODY_LIMIT) throw new BadRequest('body too large')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/** @returns the parsed JSON body; an empty body means "no change". */
function parseBody(text) {
  if (typeof text !== 'string' || text.trim() === '') return {}
  try {
    const value = JSON.parse(text)
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}
  } catch {
    throw new BadRequest('body must be JSON')
  }
}

/**
 * Read the user store; a missing or broken file means "everything visible, default interval".
 * @returns `{ enabled, refreshMs }` where `enabled` is null for "all providers".
 */
function readStore() {
  try {
    const raw = JSON.parse(readFileSync(SETTINGS_FILE, 'utf8'))
    const enabled = Array.isArray(raw?.enabled) ? raw.enabled.filter((id) => typeof id === 'string') : null
    const refreshMs = positive(raw?.refreshMs)
    return { enabled, refreshMs }
  } catch {
    return { enabled: null, refreshMs: null }
  }
}

/** Write the user store atomically, owner-readable only. */
function writeStoreFile(store) {
  mkdirSync(SETTINGS_DIR, { recursive: true, mode: 0o700 })
  const temp = `${SETTINGS_FILE}.tmp`
  writeFileSync(temp, `${JSON.stringify({ enabled: store.enabled, refreshMs: store.refreshMs }, null, 2)}\n`, {
    mode: 0o600,
  })
  renameSync(temp, SETTINGS_FILE)
}

/**
 * Provider list: defaults without Config, otherwise a merge by id (Config fields win over
 * the defaults and `enabled: false` drops the entry).
 * @param config - plugin row.
 * @returns provider list.
 */
function resolveProviders(config) {
  const configured = Array.isArray(config.providers) ? config.providers : null
  if (configured === null) return DEFAULT_PROVIDERS.map((provider) => ({ ...provider }))
  const byId = new Map(DEFAULT_PROVIDERS.map((provider) => [provider.id, provider]))
  const providers = []
  for (const entry of configured) {
    if (entry === null || typeof entry !== 'object' || typeof entry.id !== 'string') continue
    const merged = { ...(byId.get(entry.id) ?? {}), ...entry }
    if (merged.enabled === false) continue
    providers.push(merged)
  }
  return providers
}

/**
 * Window name from a quota window's `unit` and `number`. Only the pairs observed in live
 * responses are mapped (`3:5` = a five-hour window, `6:1` = one month); anything else stays
 * unlabelled and the Client shows the provider's own label.
 * @param unit - provider time unit code.
 * @param number - amount of those units.
 * @returns a short window name such as `5h` or `1mo`, or undefined.
 */
function quotaWindowLabel(unit, number) {
  const amount = Number(number)
  if (!Number.isFinite(amount) || amount <= 0) return undefined
  if (Number(unit) === 3) return `${amount}h`
  if (Number(unit) === 6) return `${amount}mo`
  return undefined
}

/** @returns a positive number from Config, or undefined. */
function positive(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

/** @returns a whole percent within 0..100, or null. */
function percentOf(value) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return null
  return Math.max(0, Math.min(100, Math.round(parsed)))
}

/** @returns a number, or null. */
function numberOrNull(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/** @returns an ISO reset time from an ms timestamp or an ISO string, or null. */
function resetsAt(value) {
  if (typeof value === 'string' && value !== '') {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null
  }
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? new Date(parsed).toISOString() : null
}

/** @returns the largest window percent (the window that will trip first). */
function tightest(windows) {
  const values = windows.map((window) => window.percent).filter((value) => value !== null)
  return values.length === 0 ? null : Math.max(...values)
}

/** @returns wallets folded by currency. */
function sumByCurrency(wallets) {
  const totals = new Map()
  for (const wallet of wallets) totals.set(wallet.currency, (totals.get(wallet.currency) ?? 0) + wallet.amount)
  return [...totals].map(([currency, amount]) => ({ currency, amount: Math.round(amount * 100) / 100 }))
}

/** @returns an error message without a stack. */
function message(error) {
  return error instanceof Error ? error.message : String(error)
}
