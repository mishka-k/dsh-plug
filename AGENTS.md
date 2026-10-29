# AGENTS.md

This repository holds DeepSeek Harness (DSH) plugins. This file is the project's README for
agents: what to know before the first change. The nearest `AGENTS.md` in the tree wins over this
one, and an explicit user request wins over both.

## Project overview

- `plugins/` contains finished plugins. Each one is a self-contained npm package that installs
  into a DSH profile through `plugin_manager` and needs no build step.
- A plugin has a Host half (`index.js`, runs inside the DSH process: network, secrets, files) and,
  when it needs UI, a browser half (`client.js`, a React component in a Web GUI slot).
- The two halves talk over a same-origin route (`ctx.webServer.register`) or over a generated
  remote namespace of the harness. Session data comes from projections, never from reading the DOM.

## Repository layout

```
plugins/<name>/     package.json, index.js, client.js, cordis.patch.yml, locale/, icon.svg, README.md
wiki/plugins/       plugin pages: what it does, how it was verified, which pitfalls it hit
wiki/harness/       DSH mechanics the plugins rely on
wiki/raw/           captured API responses and measurements — gitignored, never published
wiki/log.md         work chronology — gitignored, never published
index.md            wiki catalog: one line per page
```

`wiki/raw/` and `wiki/log.md` live on the machine only: they may hold material that should not be
published. Wiki pages never link into `wiki/raw/`; facts taken from raw material are written into
the page itself.

## Commands

- Syntax check: `cp index.js /tmp/x.mjs && node --check /tmp/x.mjs`, same for `client.js`;
  `python3 -c "import json;json.load(open('package.json'))"`.
- Install into the profile: `plugin_manager install_bundle` with `target` set to the absolute
  plugin directory. Never hand-edit the profile's `package.json` or `cordis.patch.yml`, and never
  run `pnpm` in the profile — `plugin_manager` does both.
- Verify the Host half: `curl -sS http://127.0.0.1:<profile-port>/<route> | python3 -m json.tool`.
- Verify the Client half is live: `cordis_inspect_query` → client `Slots.listSubTree` with the
  slot as `root`; our `id` must be listed in `occupants` with `active: true`.
- Reload a row after a code change: `plugin_manager set_plugin` off and on again
  (`include:<id>`). Replacing the whole package needs a DSH restart.

## Code style

- ESM without a build step and without dependencies: only `node:` builtins and globals
  (`fetch`, `AbortSignal.timeout`).
- JSDoc on every function (`@param`, `@returns`) and a "why" at the top of the module.
- No machine- or person-specific literals: API addresses, key names, labels and thresholds come
  from the plugin Config; code only carries defaults — public addresses and environment variable
  names.
- Client half: React through `require('react')`, no JSX; styles use `--dsw-alias-*` theme tokens
  only and classes under the plugin's own prefix; user-facing text goes through the locale, never
  hardcoded in markup.

## Verification

"Done" means verified live, not installed.

- Host: the route answers 200 and the JSON carries the numbers the provider dashboard shows.
- Client: the entry is active in the slot (inspect) and visible in the GUI after a page reload.
- Provider numbers move: record the captured response and its date in `wiki/raw/`, not a retelling.
- If something cannot be checked, say so plainly: "done, but not verified: <reason>".

## Pull requests

Git is strictly GitHub Flow. Nothing is committed straight to `main`.

1. `git switch -c feat/<slug>` from a fresh `main`.
2. Commit as `feat(<plugin>): <what>` or `fix(<plugin>): <what>`; the body says what was verified
   and how.
3. `git push -u origin feat/<slug>` and `gh pr create`; the description covers what changed, how it
   was verified, and what remains unverified.
4. Merge after the check is green; delete the branch.

One PR, one change. A rename, a formatting sweep and a new feature are separate PRs.

## Security

- There are no secrets in the repository and there never will be: key values live in the harness
  `credentials` service (or `cred` on the machine); code and docs only name environment variables.
- Captured API responses go to `wiki/raw/` without authorization headers; never quote a token.
- A plugin meant for publication must not depend on personal data: no paths, no account ids, no
  hardcoded provider labels.

## Documentation

The wiki follows the LLM wiki approach (Andrey Karpathy's scheme, the same one our other wikis
use): dense summary pages, each answering a question and linking its neighbours, raw material kept
apart from conclusions.

- A new page gets a line in `index.md` and an entry in `wiki/log.md`
  (`## [YYYY-MM-DD HH:MM] type | summary`, local time).
- Raw material goes to `wiki/raw/` untouched; conclusions go to `wiki/<section>/`.
- Do not delete outdated material: date it and point to the page that replaces it.

## Pitfalls

- `export const inject` is an array of service names. An object `{ required, optional }` is read as
  a list of services and the row stays `pending (waiting for services: required, optional)`.
- Optional services are fetched with `ctx.get('name')` and an `undefined` check: a profile without
  them must still work.
- The Web GUI index page requires a per-process token (`?token=`), known only to DSH. To verify a
  client entry use the `Slots` inspect provider instead of opening a browser yourself.
- Plugin routes on loopback are unauthenticated: serve numbers, never secrets.
