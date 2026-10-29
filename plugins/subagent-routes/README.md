# dsh-subagent-routes

Let an Agent pick a **provider, model and reasoning effort** for each Subagent — in every session of a
profile, not only in chats created after the switch was turned on.

## What DSH does on its own

Three separate things keep this feature out of reach by default:

1. `tool-subagent` ships `modelSelectionSettings: false`, and the route list only becomes a policy
   once the `subagent-model-selection-settings` section says `enabled: true`.
2. The policy (`subagent/model-selection-policy`) is appended **only for a fresh session**:
   `@deepseek-ai/dsh-tool-subagent` computes `freshSession = target.firstLiveSeq === 0`. A resumed
   chat therefore has no policy and no choice — forever.
3. The policy carries `allowedModels: [{ provider, model }]` and nothing else. Reasoning effort is not
   part of it: a child gets the tool row's `agentOptions.reasoningEffort` or what the parent passes
   per call.

## What this plugin does

- **Grants the policy to every session.** On `session/created` it appends the same durable event the
  harness would have written, before the agent is announced and the tools are composed. Children are
  skipped (they inherit), and nothing is written while the switch is off. This is gap 2, the one a
  plugin can close without patching foreign code.
- **Gives the routes a page of their own** under Settings → Plugins: providers as groups, a switch for
  a whole provider, a visible count, and one save. It edits the same settings namespace the built-in
  section uses, through the harness's authorized `remote.settings`, and reads the live adapter catalog
  from `remote.session.modelCatalog` — so nothing is hardcoded and a stored route that no adapter
  offers any more stays visible, marked as such.

Gap 3 — the child's default reasoning effort — is a property of the Subagent **tool row**, not of the
route list, and a plugin cannot persist it: the rows belong to a bundle, `configEditor` accepts only
profile rows, and `ctx.loader.update` on a bundle row throws `cannot resolve entry`. The page therefore
*reports* the effort in force and the efforts the allowed routes actually offer, and says where to
change it: `agentOptions.reasoningEffort` on the `tool-subagent` row in the profile patch.

## Install

```
plugin_manager install_bundle target=/absolute/path/to/dsh-plug/plugins/subagent-routes
```

Nothing else is needed: the policy switch itself lives in the Subagent settings section, and the page
shows the current state.

## How it behaves

| Situation | Result |
|---|---|
| switch off | no event is written; subagents inherit the parent model |
| switch on, new session | the harness writes the policy itself, the plugin stays out of the way |
| switch on, resumed session | the plugin writes the policy before the tools are composed |
| child session | skipped, it inherits its parent's policy |
| policy already present (old list included) | left untouched |

## Pitfalls

- Anything that touches loader rows must not run inside a route handler without a `.catch` on the
  returned promise: `loader.update` rejects asynchronously for a row it cannot address, and an
  unhandled rejection inside the Web handler takes the whole host down. An earlier version of this
  plugin did exactly that with the effort write; the write is gone, the page is read-only for it.
- `configEditor.entries()` answers "addressable profile rows"; bundle rows are not among them, even
  when `configuration()` lists them.

## Limitations

- The plugin writes the policy the settings section *currently* holds; changing the list later does not
  rewrite sessions that already have one — that is the same rule the harness applies.
- Reasoning effort is not part of the policy; set it on the Subagent tool row (`agentOptions`) or pass
  it per delegation.
- Only the Host half is load-bearing; the page can be closed without affecting the grant.

## License

MIT.
