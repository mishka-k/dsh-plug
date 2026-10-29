# dsh-web-search-account

Web search that authenticates with the **signed-in DeepSeek account**, whatever model the
conversation runs on.

The harness ships `web-search-deepseek`, and it uses the account only when the current turn's model
provider is `deepseek-account`; on any other model it falls back to `DEEPSEEK_API_KEY`. A profile that
runs models from another provider therefore loses search while its account is signed in and healthy.

That fallback is easy to misread: the platform's *app-managed* key (`DeepSeek Harness` in the API
keys panel) exposes only a tracking id, and a store holding that id answers 401 to every key-style
request. With a real `sk-…` key in `DEEPSEEK_API_KEY` the bundled provider works on any model again —
this plugin exists so search does not depend on either credential staying valid.

This plugin registers one more provider, `deepseek-account`, that always sends the account token
(`x-dsh-auth-token`) and never looks at the model.

## Install

```
plugin_manager install_bundle target=/absolute/path/to/dsh-plug/plugins/web-search-account
```

Installing alone changes nothing: the provider is registered but not selected. Point the profile's
`web` row at it:

```yaml
- id: web
  name: '@deepseek-ai/dsh-web'
  config:
    searchProvider: deepseek-account
    fetchProvider: http
```

Keep `fetchProvider` — an override replaces the whole config.

## Config

| Field | Default | Meaning |
|---|---|---|
| `baseURL` | `https://api.deepseek.com/anthropic/v1` | Messages endpoint root; the provider appends `/messages` |
| `model` | `deepseek-v4-flash` | model that serves the server-side search tool |
| `apiVersion` | `2023-06-01` | `anthropic-version` header |
| `maxTokens` | `4096` | output budget of one search turn |
| `maxUses` | `5` | how many server-side searches one request may run |

## How it works

One POST to `${baseURL}/messages` in the Anthropic Messages shape, with the server-side tool
`web_search_20250305`, authorized by `x-dsh-auth-token`. The account service decides which origins
may receive the token (`inferenceOrigin`, `https://api.deepseek.com` by default), so the token never
travels anywhere else. Results come from `web_search_tool_result` blocks; excerpts are joined from
the text blocks' citations, deduped by URL.

The token is resolved per request, so re-signing in takes effect without a restart.

## Limitations

- Requires a signed-in DeepSeek account. Without one the tool answers with a clear
  "account sign-in is required" error instead of a 401 from the API key path.
- The endpoint is the Anthropic-compatible Messages API; a base URL that does not accept
  `web_search_20250305` returns "no web_search_tool_result blocks".
- Only search. Fetching URLs still belongs to the configured fetch provider.

## License

MIT.
