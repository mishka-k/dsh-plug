/**
 * dsh-web-search-account — Host half.
 *
 * The harness ships `web-search-deepseek`, and it authenticates with the signed-in DeepSeek
 * account **only when the current turn's model provider is `deepseek-account`**; on every other
 * model it falls back to `DEEPSEEK_API_KEY`. A profile that runs models from another provider
 * therefore loses web search, even though the account is signed in and its token is valid — the
 * remaining key in the credential store may be a stale identifier that answers 401.
 *
 * This plugin registers one more provider, `deepseek-account`, which does the same request but
 * always takes the account token (`deepseekAccount.resolveToken`) and sends it as
 * `x-dsh-auth-token`. No model is consulted, so the selection of the conversation model stops
 * mattering. The protocol is the Anthropic Messages shape with the server-side web search tool,
 * which is what `api.deepseek.com/anthropic/v1/messages` accepts.
 *
 * Selection stays explicit: the profile patch names this provider in `web.searchProvider`.
 * Installing the bundle alone changes nothing.
 *
 * @module dsh-web-search-account
 */

/** Provider id the profile selects in `web.searchProvider`. */
const PROVIDER_ID = 'deepseek-account'
/** Messages endpoint root of the DeepSeek Anthropic-compatible API. */
const DEFAULT_BASE_URL = 'https://api.deepseek.com/anthropic/v1'
/** Model that serves the server-side search tool. */
const DEFAULT_MODEL = 'deepseek-v4-flash'
/** Anthropic API version header the endpoint expects. */
const DEFAULT_API_VERSION = '2023-06-01'
/** Output budget of one search turn. */
const DEFAULT_MAX_TOKENS = 4096
/** How many server-side searches one request may run. */
const DEFAULT_MAX_USES = 5
/** Identifying User-Agent, so the endpoint sees a plugin rather than an anonymous client. */
const USER_AGENT = 'dsh-web-search-account/0.1.0'
/** Server-side tool type that turns a normal Messages call into a search. */
const SEARCH_TOOL = 'web_search_20250305'

export const name = 'web-search-account'

/** The web seam is the whole API this plugin needs; the account token is read lazily. */
export const inject = ['web']

/**
 * Register the provider.
 * @param ctx - plugin context.
 * @param config - optional overrides: `baseURL`, `model`, `apiVersion`, `maxTokens`, `maxUses`.
 */
export function apply(ctx, config = {}) {
  const settings = {
    baseURL: text(config.baseURL) ?? DEFAULT_BASE_URL,
    model: text(config.model) ?? DEFAULT_MODEL,
    apiVersion: text(config.apiVersion) ?? DEFAULT_API_VERSION,
    maxTokens: positive(config.maxTokens) ?? DEFAULT_MAX_TOKENS,
    maxUses: positive(config.maxUses) ?? DEFAULT_MAX_USES,
  }

  const dispose = ctx.web.registerSearchProvider({
    id: PROVIDER_ID,
    available: () => ctx.get('deepseekAccount') !== undefined && ctx.get('deepseekAccount') !== null,
    search: async (request, signal) => await search(request, signal),
  })
  ctx.effect(() => () => dispose(), 'web-search-account: provider')

  /**
   * One search through the Messages endpoint, authenticated by the account token alone.
   * @param request - `{ query }` from the web seam.
   * @param signal - caller cancellation.
   * @returns `{ sources, truncated }`.
   */
  async function search(request, signal) {
    const endpoint = `${settings.baseURL.replace(/\/+$/, '')}/messages`
    const token = await accountToken(endpoint)
    if (token === undefined) {
      throw new Error(
        'DeepSeek account sign-in is required for this web search provider: the harness has no account token for ' +
          endpoint,
      )
    }
    const body = {
      model: settings.model,
      max_tokens: settings.maxTokens,
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: `Perform a web search for the query: ${request.query}` }],
        },
      ],
      tools: [{ type: SEARCH_TOOL, name: 'web_search', max_uses: settings.maxUses }],
      thinking: { type: 'disabled' },
    }
    const response = await fetch(endpoint, {
      method: 'POST',
      redirect: 'error',
      headers: {
        'x-dsh-auth-token': token,
        'anthropic-version': settings.apiVersion,
        'content-type': 'application/json',
        accept: 'application/json',
        'user-agent': USER_AGENT,
      },
      body: JSON.stringify(body),
      ...(signal === undefined ? {} : { signal }),
    })
    if (!response.ok) {
      const status = response.status
      let detail = ''
      try {
        const parsed = await response.json()
        const message = typeof parsed?.error === 'string' ? parsed.error : parsed?.error?.message ?? parsed?.message
        if (typeof message === 'string' && message !== '') detail = `: ${message}`
      } catch {
        // A non-JSON failure body leaves the status as the whole story.
      }
      const hint =
        status === 401
          ? '\n\nThe DeepSeek account sign-in was rejected; sign in again in Settings → Account. The endpoint does not need changing.'
          : ''
      throw new Error(`DeepSeek search failed (HTTP ${status}) from ${endpoint}${detail}${hint}`)
    }
    return mapResponse(await response.json())
  }

  /**
   * @param endpoint - the Messages endpoint the token must be valid for.
   * @returns the account token, or undefined when the profile is signed out or the origin does
   *   not match the account's inference origin.
   */
  async function accountToken(endpoint) {
    const account = ctx.get('deepseekAccount')
    if (account === undefined || account === null) return undefined
    try {
      const token = await account.resolveToken(endpoint)
      return typeof token === 'string' && token !== '' ? token : undefined
    } catch {
      return undefined
    }
  }
}

/**
 * Map an Anthropic Messages response to the seam's result.
 *
 * `web_search_tool_result` blocks carry the citeable hits; the excerpt usually lives in a separate
 * text block's citation, keyed by URL, so the two are joined. The web service owns the final
 * truncation, which is why `truncated` is always false here.
 * @param response - the parsed Messages body.
 * @returns `{ sources, truncated }`.
 */
function mapResponse(response) {
  const blocks = Array.isArray(response?.content) ? response.content : []
  const results = blocks.filter((block) => block?.type === 'web_search_tool_result')
  if (results.length === 0) {
    throw new Error(
      'DeepSeek returned no web_search_tool_result blocks: the request did not trigger the server-side search',
    )
  }
  const snippets = citationSnippets(blocks)
  const seen = new Set()
  const sources = []
  for (const block of results) {
    for (const item of Array.isArray(block?.content) ? block.content : []) {
      if (item?.type !== 'web_search_result') continue
      const url = typeof item.url === 'string' ? item.url : ''
      if (url === '' || seen.has(url)) continue
      seen.add(url)
      sources.push({
        url,
        ...(typeof item.title === 'string' && item.title !== '' ? { title: item.title } : {}),
        ...(snippets.has(url) ? { snippet: snippets.get(url) } : {}),
        ...(typeof item.page_age === 'string' && item.page_age !== '' ? { publishedAt: item.page_age } : {}),
      })
    }
  }
  return { sources, truncated: false }
}

/** @returns `url → cited_text` for every citation block, first occurrence wins. */
function citationSnippets(blocks) {
  const map = new Map()
  for (const block of blocks) {
    if (block?.type !== 'text' || !Array.isArray(block.citations)) continue
    for (const citation of block.citations) {
      const url = typeof citation?.url === 'string' ? citation.url : ''
      const text = typeof citation?.cited_text === 'string' ? citation.cited_text : ''
      if (url !== '' && text !== '' && !map.has(url)) map.set(url, text)
    }
  }
  return map
}

/** @returns a trimmed string, or undefined. */
function text(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

/** @returns a positive number, or undefined. */
function positive(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}
