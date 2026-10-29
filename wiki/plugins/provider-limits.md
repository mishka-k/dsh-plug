# provider-limits — quotas and balances under the composer

## 1 What it does

Draws pills in the composer dock with what is left on each subscription: OpenCode Zen
(`OC 33%`), GLM Coding Plan (`GLM 44%`) and the money on the account (`$1.37`). They sit in the
same row as the shipped cache hit, tok/s and context meter, immediately to their right (`order: 2`
in the slot).

A pill is a compact reading, like the shipped ones in `performanceUsage: compact` mode: an icon and
a short value. Hovering or focusing it opens a card with the whole breakdown — every window of the
quota, its usage, when it resets, and the remaining credit where the provider reports it — plus the
age of the snapshot.

The card is drawn in the plugin rather than left to `title`: a native tooltip is slow, unstyled and
truncated by the dock's single line. It is portalled to `document.body` (the composer sits inside
its own stacking context) and falls back to an absolutely positioned card when `react-dom` is not
in the bundle's module table.

## 2 How it is built

| Half | What it does |
|---|---|
| Host (`index.js`) | Calls the providers with keys from the `credentials` service, caches the snapshot in memory for `refreshMs`, serves it at `GET /plugin/provider-limits`, and owns the user store behind `GET`/`PUT /plugin/provider-limits/config` |
| Client (`client.js`) | Registers the pills in `conversation.composer.dock`, the configuration tab in `settings.plugins.tab`, polls the snapshot once a minute, formats the numbers |

No secret ever reaches the browser: the key stays inside the DSH process and the page only gets
percentages and amounts. The route listens on loopback of the plugin's own origin and serves
numbers only.

One provider failing does not break the others: the failure lands in that element's `error`, the
pill shows `OC —`, and the tooltip carries the reason. With no snapshot at all the row is not
drawn.

## 3 Data sources

Every address below is an undocumented internal API, verified with live keys on 2026-10-29. The
captured responses live in `wiki/raw/` and are not published; the fields actually used are listed
here.

| Adapter (`kind`) | Address | What is read |
|---|---|---|
| `opencode-zen` | `GET https://opencode.ai/zen/go/v1/usage` | `usage.rolling.percent` (5 h), `weekly`, `monthly`, plus `resetsAt`; the pill shows the maximum |
| `zai-quota` | `GET https://api.z.ai/api/monitor/usage/quota/limit` | `data.limits[].percentage` (first window 5 h, second monthly), `nextResetTime`, `level` |
| `balance-account` | harness service `deepseekAccount.getBalance` | platform account wallets: `{currency, balance}` plus bonus wallets |
| `balance-api` | `GET https://api.deepseek.com/user/balance` | `balance_infos[].total_balance` for the `DEEPSEEK_API_KEY` credential |

`balance-account` is the primary path for money: the platform account knows both topped-up and
granted credit. `balance-api` stays as the fallback — it only sees what sits on the API key.

Two provider quirks worth remembering:

- Cloudflare in front of `opencode.ai` rejects the runtime's default User-Agent (`node`) the same
  way it rejects Python's `urllib`, with a 403. Hence the `curl/8.7.1` constant.
- The stored `DEEPSEEK_API_KEY` credential answered `401` on 2026-10-29, so the balance comes from
  the account. If the key starts working again, `balance-api` picks it up as the fallback.

## 3a Settings: two layers

The provider catalogue and the user's choice live apart on purpose.

| Layer | Where | Owns | Written by |
|---|---|---|---|
| Plugin Config | profile `cordis.patch.yml` | provider catalogue: ids, kinds, endpoints, key names, labels, default interval | the user, by hand |
| User store | `$DSH_HOME/provider-limits/settings.json` (0600) | which providers are visible, refresh override | the Settings page |

The Settings page is a tab in Settings → Plugins (`settings.plugins.tab`, id `provider-limits`,
order 50, next to the built-in inventory tab) with one switch per provider and a refresh field.
`PUT /plugin/provider-limits/config` accepts only `enabled` (a list of known ids) and `refreshMs`
(15 s to 1 h); anything else is a 400. That restriction is the point: the endpoints and key names
stay out of reach of the write route, so a stray local request cannot redirect a key to another
host. A successful write clears the snapshot, and the page asks the pills to reload at once
instead of waiting for the next poll.

## 4 Configuration

The plugin row lives in the bundle layer (`cordis.patch.yml`) and is overridden in
`~/.dsh/profiles/<profile>/cordis.patch.yml` by `id: provider-limits`. Every field is optional.

| Field | Default | Meaning |
|---|---|---|
| `refreshMs` | `120000` | snapshot lifetime in the Host half |
| `providers` | three entries (`DEFAULT_PROVIDERS`) | provider list; merged by `id`, `enabled: false` drops an entry |
| `accountLocale` | `en` | locale sent to the platform with the balance read |
| `accountVersion` | `provider-limits` | "client version" string in the account metadata; the platform only accepts it |

A provider entry: `id`, `kind`, `label`, `short`, `keyRef`, `url`, `fallback`, `enabled`.

Example: drop z.ai and add a custom `balance-api` provider.

```yaml
- id: provider-limits
  name: dsh-provider-limits
  config:
    refreshMs: 300000
    providers:
      - id: zai
        enabled: false
      - id: custom
        kind: balance-api
        label: Custom
        short: CU
        keyRef: CUSTOM_API_KEY
        url: https://api.example.com/user/balance
```

## 5 Verification (2026-10-29)

| What | How | Result |
|---|---|---|
| Host route | `curl http://127.0.0.1:51076/plugin/provider-limits` | 200, three providers: opencode 33%, z.ai 44%, deepseek `$1.37` |
| Client entry | inspect → client `Slots.listSubTree` | `provider-limits`, `order: 2`, `active: true`, beside `activity` and `usage` |
| Account balance | same response, `kind: balance-account` | returned `USD 1.37`, so the account is signed in and the platform accepted the metadata |
| Live polling | snapshot `fetchedAt` advanced while no shell request was made | the page's component polls, i.e. it is mounted and rendering |
| Hover card | reported by the user as missing on the first version, where the tooltip sat on a `display:contents` wrapper and could not receive hover | card moved onto the pill, `title` dropped, breakdown rendered as a portal |
| Settings tab | `Slots.listSubTree` on `settings.plugins.tab` | `provider-limits`, `order: 50`, `active: true` beside the inventory tab |
| Provider switch | `PUT /plugin/provider-limits/config` with two ids | snapshot dropped the switched-off provider; store file written with mode 600 |
| Write guards | `PUT` with an unknown id, then with `refreshMs: 1` | both answered 400 with the reason |
| Pixels in the GUI | not inspected directly | the page's index needs a per-process token; verification went through the slot inspector |

## 6 Pitfalls

- `export const inject` is an array. The loader reads an object `{ required, optional }` as service
  names, so the row hangs at `pending (waiting for services: required, optional)`.
- After a code change the row must be switched off and on (`set_plugin include:provider-limits`);
  replacing the whole package needs a DSH restart.
- The GUI index page only opens with `?token=`; verify the client through the `Slots` inspect
  provider rather than an external browser.
- Percentages are usage, not remaining. The pill shows the tightest window because that is the one
  that will stop work first.

## 7 Links

- Code and configuration: [plugins/provider-limits](../../plugins/provider-limits/README.md)
- The slot the pill lands in: [Composer dock slot](../harness/composer-dock.md)
