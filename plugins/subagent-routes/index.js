/**
 * dsh-subagent-routes — Host half.
 *
 * DSH can let an agent pick a provider and model for each subagent, but three things stand between
 * a user and that behaviour:
 *
 * 1. the tool is closed by default — `tool-subagent` carries `modelSelectionSettings: false`, and the
 *    route list only exists once the `subagent-model-selection` settings section says so;
 * 2. the policy is written for a *fresh* session only. `@deepseek-ai/dsh-tool-subagent` computes
 *    `freshSession = target.firstLiveSeq === 0` and appends `subagent/model-selection-policy` only
 *    then, so every resumed chat has no policy and therefore no choice, forever;
 * 3. reasoning effort cannot be chosen through that policy at all: the event carries
 *    `allowedModels: [{ provider, model }]` and nothing else. The effort a child gets is either the
 *    tool row's `agentOptions.reasoningEffort` default or what the parent passes per call.
 *
 * This plugin closes the second gap, and it is the only one a plugin can close without patching
 * foreign code: on `session/created` it appends the same durable event the harness would have
 * written, before the agent is announced and tools are composed. Children are skipped — they inherit
 * their parent's policy. Nothing is written while the settings section switch is off.
 *
 * `subagent/model-selection-policy` is a documented member of the session event map
 * (`SessionEventMap` in `@deepseek-ai/dsh-session`), so the record is a supported write.
 *
 * @module dsh-subagent-routes
 */

export const name = 'subagent-routes'

/** Session service owns the event append; the settings and projection services are optional. */
export const inject = ['sessions']

/**
 * Mount the backfill.
 * @param ctx - plugin context.
 */
export function apply(ctx) {
  /** Sessions this plugin has already patched, for the status line of the settings page. */
  let patched = 0

  const backfill = (session) => {
    try {
      const settings = ctx.get('subagentModelSelection')
      const projections = ctx.get('sessionProjections')
      if (settings === undefined || projections === undefined) return
      // A child inherits its parent's policy; writing one would be noise, not a choice.
      if (session.header?.origin === 'subagent') return
      const current = settings.current()
      if (current.enabled !== true) return
      const existing = projections.stateOf(session, 'subagentModelSelectionPolicy')
      if (existing !== null && existing !== undefined) return
      const routes = Array.isArray(current.allowedModels) ? current.allowedModels : []
      if (routes.length === 0) return
      session.append('subagent/model-selection-policy', {
        allowedModels: routes.map((route) => ({ provider: route.provider, model: route.model })),
      })
      patched += 1
      ctx.get('logger')?.info?.(
        `subagent-routes: policy granted to session ${session.id} (${routes.length} routes)`,
      )
    } catch (error) {
      // Opening a session must never fail because of this plugin.
      ctx.get('logger')?.warn?.(`subagent-routes: ${String(error)}`)
    }
  }

  ctx.on('session/created', backfill)

  // The page reads this through the plugin's own row state; the accessor is registered as a
  // service so a future tool can report the same number.
  ctx.provide('subagentRoutesStatus', {
    /** @returns how many sessions this process granted a policy to. */
    patched: () => patched,
  })
}
