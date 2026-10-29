# mcp-manager — MCP servers from the GUI

## 1 What it is

A page in Settings → Plugins that manages the MCP servers of a profile: list, add, edit, test,
enable, disable, remove. Universal on purpose — it knows nothing about particular servers, only
about the harness row type (`@deepseek-ai/dsh-mcp-client`) and the MCP handshake.

For a non-technical user the flow is: pick a transport, paste a URL and (if the server wants one) a
token, press **Test**, press **Save**. The test speaks MCP to the candidate and answers with the
server name and its tools, or with the exact refusal the server gave.

## 2 How it is built

| Half | What it does |
|---|---|
| Host (`index.js`) | Owns the overlay file, creates/updates/removes loader rows, reconciles the overlay on start, and runs the MCP handshake for the test button |
| Client (`client.js`) | Registers the `mcp-manager` tab in `settings.plugins.tab` (order 40) and renders list + form |

Route prefix: `/plugin/mcp-manager` (`GET/POST /servers`, `PUT /servers/enabled`,
`DELETE /servers?id=`, `POST /restore`, `POST /probe`).

The test is plain JSON-RPC over the standard Streamable HTTP transport — `initialize`, then
`notifications/initialized`, then `tools/list`, carrying the `mcp-session-id` the server returns.
No MCP SDK dependency, so the plugin installs as a package with zero dependencies.

## 3 Persistence, the part that bites

`ctx.loader.create()` gives a live row and calls `tree.write()`, but in this deployment that write
persists nothing: a created row disappears with the process. Rewriting the profile patch from a
plugin is worse — it would destroy the comments and ordering a human put there.

So the plugin keeps an overlay next to the harness state, `$DSH_HOME/mcp-manager/servers.json`
(0600), and reconciles it against the loader:

| Key | Holds | Applied on start |
|---|---|---|
| `created` | servers added from the page | row recreated if absent |
| `overrides` | edits to rows that live in the profile patch | config replaced when it differs |
| `disabled` | rows switched off | `disabled: true` set |
| `removed` | patch rows hidden by a removal | row removed from the tree |

The first reconcile runs 150 ms after mount, because patch rows may be composed after this plugin
itself; it is safe to call repeatedly.

## 4 Security

The write routes listen on the plugin's own loopback origin without authentication. That is why
they are narrow by construction:

- a route can only touch rows whose module is `@deepseek-ai/dsh-mcp-client` and whose server name
  matches `[a-z0-9][a-z0-9-]{1,30}` — it can never load another package;
- header values never travel to the browser (the list reports names only), and an edit keeps the
  existing headers unless new ones are typed;
- `stdio` rows spawn a command, so `allowStdio` is `false` by default and the transport is refused
  until an operator turns it on.

Known gap: tokens are stored in plain text — in the overlay file for created rows, in the profile
patch for hand-written ones. Removing that needs a connection layer of our own with the token in
the `credentials` service; recorded as the next step.

## 5 Verification (2026-10-29)

| What | How | Result |
|---|---|---|
| list | `GET /plugin/mcp-manager/servers` | nine rows of the profile, transport, URL and state |
| create | `POST /servers` for `http://127.0.0.1:3017/mcp` | row `mcp-pw2` appeared, connected, written to the overlay |
| survive a reload | disable and enable the plugin row | `mcp-pw2` recreated from the overlay by the reconcile |
| switch | `PUT /servers/enabled` | row disabled, overlay `disabled.mcp-pw2 = true` |
| remove | `DELETE /servers?id=mcp-pw2` | row gone, overlay clean |
| probe, success | throwaway MCP server on port 3999 | server info `fake-mcp`, two tools `ping`, `echo` |
| probe, refusal | MCP daemon on port 3015 | `HTTP 401` with the server's message |
| probe, already connected | playwright MCP on port 3016 | reported as connected, not as an error |
| page registration | `Slots.listSubTree` on `settings.plugins.tab` | `mcp-manager`, order 40, active |
| pixels | not inspected | the GUI index needs a per-process token; verification went through the API and the slot tree |

## 6 Pitfalls

- `ctx.loader` is not in the service catalogue but exists on the Host context; treat it as an
  internal seam and guard it (`ctx.get('loader')`).
- Tool counts read the harness registry, which is agent-scoped: several connected servers report 0.
  The page shows a count only when it is non-zero; the test button is the reliable source.
- A stateful MCP server already held by the harness rejects a second `initialize` with "Server
  already initialized"; that is a healthy answer and the page maps it to connected.
- Editing a row must reuse its headers when the field is empty, or a save would silently drop the
  token.
- `stdio` is off by default; enabling it turns the page into a way to run commands on this machine,
  so it stays a deliberate Config change.

## 7 Links

- Code and configuration: [plugins/mcp-manager](../../plugins/mcp-manager/README.md)
- Slot the page lives in: [Composer dock slot](../harness/composer-dock.md) (same Settings section
  family; the tab slot itself is `settings.plugins.tab`)
