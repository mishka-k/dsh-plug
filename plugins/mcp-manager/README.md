# dsh-mcp-manager

Connect any MCP server to DSH from the Web GUI: add, edit, test, enable, disable, remove. No file
editing, no restart.

Settings → Plugins → **MCP servers**:

```
MCP servers                                  [ Add server ]
Connect any MCP server to this profile. Changes are written to the profile patch, so they survive restarts.

┌──────────────────────────────────────────────────────────────────────────┐
│ ● bitrix24        http://…:3003/mcp · connected        [Edit] [Remove] [on]│
│ ● context7        https://mcp.context7.com/mcp · connected                 │
│ ● playwright…     http://localhost:3016/mcp · not connected                │
└──────────────────────────────────────────────────────────────────────────┘
```

"Add server" takes a name, a transport and either a URL (HTTP) or a command (stdio), and a
**Test** button that speaks MCP to the candidate (`initialize` → `tools/list`) before anything is
saved: you see either the server name and its tools, or the exact refusal (`HTTP 401: Missing or
invalid Authorization header`).

## Install

```
plugin_manager install_bundle target=/absolute/path/to/dsh-plug/plugins/mcp-manager
```

Then open Settings → Plugins → MCP servers. The page lists every row of
`@deepseek-ai/dsh-mcp-client` this profile has, including the ones written by hand into the
profile patch.

## What the page can do

| Action | Result |
|---|---|
| Add | creates a loader row; the client connects immediately and its tools join the registry |
| Edit | changes URL, headers, command or arguments; the previous headers are kept when the field is left empty, because the page never receives their values |
| Test | full MCP handshake against the candidate, returns server info and tool names |
| Enable / disable | switches the row off without deleting it |
| Remove | deletes a row the page created; a hand-written patch row is hidden and remembered, with a "restore" action |

## Where state lives

The overlay is `$DSH_HOME/mcp-manager/servers.json` (0600):

```
created      servers added from the page, recreated on every start
overrides    edits applied to rows that live in the profile patch
disabled     rows switched off
removed      patch rows hidden by a removal
```

Reconciling on start is deliberate: `ctx.loader.create()` gives a live row but writes nothing, and
rewriting the profile patch from a plugin would destroy its comments and ordering. The overlay is
small, private, and never touches the hand-written configuration.

## Config

| Field | Default | Meaning |
|---|---|---|
| `allowStdio` | `false` | allow rows that spawn a command |
| `probeTimeoutMs` | `8000` | timeout of one test handshake |

A row may also carry the client's `reconnect` policy (`maxAttempts`, `maxDelayMs`). The page does
not edit it; the API passes it through, so a server migrated from the profile patch keeps its retry
behaviour.

## Security

The page talks to its Host half over loopback routes on the plugin's own origin. Those routes are
unauthenticated, so they are narrow by construction: a route can only create, edit or remove a row
whose module is `@deepseek-ai/dsh-mcp-client` with a server name matching `[a-z0-9][a-z0-9-]*`. It
can never load another package. `stdio` rows execute a command, so they stay behind
`allowStdio: false` until an operator turns them on.

Header values are never sent to the browser: the list reports header names only, and editing a
server keeps the existing headers unless you type new ones.

## Limitations

- The test handshake covers `streamable-http`; a `stdio` command is saved but not probed.
- A stateful server that the harness already holds answers a second handshake with "Server already
  initialized"; the page reports that as connected rather than as an error.
- Tool counts come from the harness registry, which is scoped per agent: a server may show
  "connected" with no count.

## License

MIT.
