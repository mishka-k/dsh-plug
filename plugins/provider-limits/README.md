# dsh-provider-limits

Provider quota and account balance pills under the DSH composer — in the same row as the cache
hit, tok/s and the context meter.

```
[ 55 tok/s ]  [ cache hit 42% ]  [ OC 33% ]  [ GLM 44% ]  [ $1.37 ]  ( context )
```

Every pill is a read-only indicator. Hovering or focusing it opens a card with the full
breakdown: each quota window (5h / week / month), its usage, its reset time, and for credit-based
plans what is left of the window allowance. Money values come from the platform account (the same
wallets Settings → Account shows); percentages come from the providers' internal usage APIs.

## Install

From the root of this repository:

```
plugin_manager install_bundle target=/absolute/path/to/dsh-plug/plugins/provider-limits
```

The plugin then appears in Settings → Plugins. No build step: `index.js` is the Host half and
`client.js` the browser half, both plain ESM without dependencies.

Keys are never passed to the plugin. It reads them from the harness `credentials` service by
environment variable name, so it works as soon as the profile has keys for the providers you use
(`OPENCODE_GO_API_KEY`, `ZAI_API_KEY`, `DEEPSEEK_API_KEY` by default).

## Configuration

Every field is optional; override the plugin row in your profile by `id: provider-limits`.

| Field | Type | Default | Meaning |
|---|---|---|---|
| `refreshMs` | number | `120000` | how long the Host snapshot lives in memory |
| `providers` | array | three entries | provider list, merged by `id` |
| `accountLocale` | string | `en` | locale sent in the balance request metadata |
| `accountVersion` | string | `provider-limits` | version string in that metadata; the platform only accepts it |

Provider entry:

| Field | Meaning |
|---|---|
| `id` | entry key; also `data-composer-stat="provider-limits-<id>"` |
| `kind` | adapter: `opencode-zen`, `zai-quota`, `balance-account`, `balance-api` |
| `label` | name shown in the tooltip |
| `short` | prefix inside the pill (`OC`, `GLM`, `DS`) |
| `keyRef` | environment variable name resolved through `credentials` |
| `url` | API address (network adapters) |
| `fallback` | second `kind` used when the first yields no numbers |
| `enabled` | `false` removes the entry |

Example: balance only, refreshed every five minutes.

```yaml
- id: provider-limits
  name: dsh-provider-limits
  config:
    refreshMs: 300000
    providers:
      - id: deepseek
        kind: balance-account
```

## How it works

- `index.js` — the `GET /plugin/provider-limits` route on the plugin's own origin, the snapshot
  cache, and the adapters. Keys are resolved per request; a failing provider never takes its
  neighbours down.
- `client.js` — registration in the `conversation.composer.dock` slot (`order: 2`), a poll of the
  route once a minute, styling matched to the shipped pills.
- `cordis.patch.yml` — the bundle layer: one plugin row with an empty config.

The route listens on loopback only and serves numbers: no keys, no provider response bodies.

## Verify

```bash
curl -sS http://127.0.0.1:<profile-port>/plugin/provider-limits | python3 -m json.tool
```

The answer carries `providers[]` with `percent` (usage, the tightest window) or `wallets[]` (sum
per currency), or an `error` with the provider status. An empty `providers` means every entry is
disabled.

## Limits

- Percentages are usage, not remaining: `80` means 80% spent.
- Values come from undocumented provider APIs. If a format changes, the pill reports an error
  instead of breaking the interface.
- The account balance only exists while you are signed in to a DSH account; otherwise the
  API-key fallback applies, and if that fails too the pill shows a dash.

## License

MIT.
