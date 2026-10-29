# Composer dock slot

The strip under the composer card where cache hit, tok/s and the context meter live — and where
plugin pills take their place. Slot key: `conversation.composer.dock`. Verified against the
installed DSH 0.2.1-rc.3 build (`@deepseek-ai/dsh-client-ui-conversation`, `InputBar`).

## Who declares it, who renders it

- The slot is declared in `dsh-client-ui-conversation`: the `conversation.composer.bar` entry
  describes its child slots, `conversation.composer.dock` among them — `kind: list`,
  `scope: session`.
- `InputBar` renders it:

  ```
  <div class="..._dock" data-composer-dock>
    {renderSlot('conversation.composer.dock', {})}
    {activity ? null : <ContextMeter/>}
  </div>
  ```

  So the children of the dock are (a) slot entries in `order`, and (b) the context-meter
  indicator, which `InputBar` draws itself rather than through the slot.
- Dock CSS: `display:flex; justify-content:center; align-items:center; gap:12px; max-width:100%;
  padding-top:4px`. No wrapping, no scrolling: anything added shares the single row with the
  harness pills. `:empty` hides the dock when there are no entries.

## Shipped entries

| id | order | What it shows |
|---|---|---|
| `activity` | 0 | turns/steps and speed, `tok/s` |
| `usage` | 1 | total tokens and the cache-hit share |

Both come from `dsh-client-ui-chat` and share one CSS kit, `StatsPills`: `anchor` (inline-flex,
reduced font size), `pill` (14×14 icon, `gap: 6px`, `padding: 1px 8px`, `tabular-nums`, colour
`--dsw-alias-label-tertiary`), `label` (ellipsis).

The `ui-chat.performanceUsage` config picks the mode:

- `compact` — `PlainPill`: a static `span` with speed and cache hit only;
- `detailed` — `DialogPill`: a button that opens a portalled dialog with the breakdown (LLM and
  tool time, TTFT, input/cache/output).

A plugin that wants to look "on par" copies `PlainPill`: a `span` with an icon and a label, with
details in `title`. Host class names cannot be reused; own styles reference only `--dsw-alias-*`
tokens.

## Taking a place

```js
ctx.slots.inject('conversation.composer.dock', () =>
  ctx.slots.register(
    { name: 'conversation.composer.dock', id: 'provider-limits', order: 2, locale: NS },
    ProviderLimits,
  ),
)
```

- `id` is your own; reusing a shipped id replaces that entry (`activity` and `usage` are taken).
- `order` positions the entry among the list; `2` places it right after `usage`, before the context
  meter.
- `locale: NS` hands the component a `t` bound to your locale namespace; without it you build the
  text yourself.
- The component receives the slot's standard props (`useSession`, `useInput`, `sessionId`,
  `useProjection` and others) — read data through them, never through the DOM.

## Pitfalls

- The dock renders only in the `composer` variant and only with a live session: outside a chat the
  entries are invisible.
- The row is single and does not wrap: three or four new pills already crowd the context meter in a
  narrow window.
- Text without locale, and colours as literals, fall out of the theme: the host switches light and
  dark instantly and literals do not follow.
- A client entry shows up in the `Slots` inspect provider (`occupants`), but that does not prove it
  renders: the page must reload to pick up a new module.
