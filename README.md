# dsh-plug

DeepSeek Harness (DSH) plugins we write and maintain ourselves. Every plugin is a folder under
`plugins/`, installs into a DSH profile with a single `plugin_manager install_bundle` call, and
then shows up in Settings → Plugins next to the shipped ones.

## Plugins

| Plugin | What it does |
|---|---|
| [provider-limits](plugins/provider-limits/) | Provider quotas and account balance as pills under the composer — next to cache hit, tok/s and the context meter |
| [mcp-manager](plugins/mcp-manager/) | Add, edit, test, enable and remove MCP servers from Settings, without editing the profile patch |
| [web-search-account](plugins/web-search-account/) | Web search on the signed-in DeepSeek account token, whatever model the session runs |
| [subagent-routes](plugins/subagent-routes/) | Provider and model choice for Subagents in every session, with a route page grouped by provider |

## Install

A plugin is a plain npm package with `dsh.bundle` and, when it has a UI, `dsh.client`. Install it
from the directory that holds `package.json`; no build step is involved:

```
plugin_manager install_bundle target=/absolute/path/to/dsh-plug/plugins/provider-limits
```

It then appears in Settings → Plugins and can be switched on and off without touching profile
configuration. Configuration details and verification steps live in the plugin's own README.

## Repository layout

- `plugins/<name>/` — plugin code: `index.js` (Host), `client.js` (browser half),
  `cordis.patch.yml`, locale files, icon, README.
- `wiki/` — documentation maintained by the agent: `plugins/` for plugin pages, `harness/` for
  the DSH mechanics they rely on, `raw/` for captured source material.
- `index.md` — the wiki catalog, one line per page.
- `AGENTS.md` — rules for agents working in this repository.

Local only, kept out of git (`.gitignore`): `wiki/raw/` — captured API responses and
measurements, and `wiki/log.md` — the work chronology. They never enter the repository because
they may hold material that should not be published.

## Rules

Git is strictly GitHub Flow: `main` is always working, every change goes through a `feat/<slug>`
branch and a pull request. There are no secrets in the repository — keys come from the harness
`credentials` service (or the `cred` CLI); code only ever names the environment variables.

License: MIT per plugin (see `license` in its `package.json`).
