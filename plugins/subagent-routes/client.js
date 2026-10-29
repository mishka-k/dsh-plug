/**
 * dsh-subagent-routes — Client half.
 *
 * The settings page the harness does not offer by default: one place to decide which provider and
 * model an Agent may hand to a Subagent. The built-in section edits the same settings namespace but
 * lists routes flat and one at a time; here they are grouped by provider, with a whole-provider
 * switch and a visible count.
 *
 * Everything is read and written through the harness's own authorized surfaces — `remote.settings`
 * for the namespace and `remote.session.modelCatalog` for the live adapter directory — so the page
 * never carries a copy of a catalog and never writes a file itself.
 *
 * @module dsh-subagent-routes/client
 */
window.__ModuleLoader__.load({
  id: 'dsh-subagent-routes',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** Locale namespace of this plugin. */
    const NS = 'subagent-routes'
    /** Settings namespace owned by the model-selection section. */
    const SETTINGS_NS = 'subagent-model-selection-settings'

    /** English strings; the host `t` takes over when the slot provides one. */
    const DICT = {
      nav: 'Subagent routes',
      title: 'Subagent routes',
      intro:
        'Choose which providers and models an Agent may pass to a Subagent. The policy is granted to every session, including chats that were resumed rather than created fresh.',
      toggle: 'Allow agents to choose models for Subagents',
      toggleHint:
        'When off, a Subagent inherits the parent model and no route can be chosen. Switching it on grants the routes below to new and resumed sessions alike.',
      allowed: 'Models agents may choose',
      loading: 'Loading the model catalog…',
      catalogFailed: 'The model catalog did not load',
      unavailable: 'This deployment does not serve the Subagent settings section.',
      readOnly: 'Settings are read-only in this deployment.',
      save: 'Save',
      saving: 'Saving…',
      discard: 'Discard',
      saved: 'Saved',
      saveFailed: 'The deployment rejected the values',
      count: '{count} of {total} routes allowed',
      all: 'All',
      none: 'None',
      readOnlyRoute: 'not offered by any current adapter',
      effort: 'Reasoning effort for Subagents',
      effortHint:
        'The default a Subagent inherits when the delegation does not ask for a specific effort. The route policy carries no effort, so this is a property of the Subagent tool row.',
      effortCurrent: 'current',
      effortKnown: 'efforts these routes report',
      effortDefault: 'Inherit from the parent',
      effortNone: 'The allowed routes report no reasoning effort',
      effortWhere:
        'Change it in the profile patch: agentOptions.reasoningEffort on the tool-subagent row. A plugin cannot persist a bundle row, and this page does not pretend otherwise.',
    }

    /** Page styling in the host's settings language: theme tokens only. */
    const CSS = [
      '.dshsr_section{max-width:860px;display:flex;flex-direction:column;gap:12px;',
      'color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px}',
      '.dshsr_title{margin:0;font-size:18px;font-weight:600}',
      '.dshsr_intro{margin:0;color:var(--dsw-alias-label-secondary)}',
      '.dshsr_card{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;',
      'background:var(--dsw-alias-bg-layer-1);padding:12px 14px;display:flex;flex-direction:column;gap:10px}',
      '.dshsr_row{display:flex;align-items:center;justify-content:space-between;gap:14px}',
      '.dshsr_group{border-top:.5px solid var(--dsw-alias-border-l1);padding-top:10px;display:flex;',
      'flex-direction:column;gap:6px}',
      '.dshsr_group:first-child{border-top:0;padding-top:0}',
      '.dshsr_groupHead{display:flex;align-items:center;justify-content:space-between;gap:12px}',
      '.dshsr_provider{font-weight:500}',
      '.dshsr_models{display:flex;flex-wrap:wrap;gap:6px 14px}',
      '.dshsr_model{display:inline-flex;align-items:center;gap:6px;color:var(--dsw-alias-label-secondary)}',
      '.dshsr_missing{opacity:.6}',
      '.dshsr_actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap}',
      '.dshsr_button{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;',
      'background:transparent;color:var(--dsw-alias-label-primary);font:inherit;padding:3px 10px;cursor:pointer}',
      '.dshsr_button:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2)}',
      '.dshsr_button:disabled{opacity:.5;cursor:default}',
      '.dshsr_button[data-tone="primary"]{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}',
      '.dshsr_switch{box-sizing:border-box;flex:none;width:36px;height:20px;padding:0;border:0;border-radius:10px;',
      'background:var(--dsw-alias-state-idle-primary);position:relative;cursor:pointer}',
      '.dshsr_switch[data-on="true"]{background:var(--dsw-alias-brand-primary)}',
      '.dshsr_knob{position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;',
      'background:var(--dsw-alias-bg-base);transition:transform .12s}',
      '.dshsr_switch[data-on="true"] .dshsr_knob{transform:translateX(16px)}',
      '.dshsr_hint{color:var(--dsw-alias-label-secondary);font-size:12px}',
      '.dshsr_ok{color:var(--dsw-alias-state-success-primary);margin:0}',
      '.dshsr_error{color:var(--dsw-alias-state-error-primary);margin:0}',
    ].join('')

    /**
     * Translation: the slot-provided `t` when present, otherwise this module's dictionary.
     * @param props - slot entry props.
     * @returns translate function.
     */
    function translator(props) {
      if (typeof props.t === 'function') return props.t
      return (key, params) => {
        const template = DICT[key] ?? key
        return params === undefined
          ? template
          : template.replace(/\{(\w+)\}/g, (match, name) =>
              params[name] === undefined ? match : String(params[name]),
            )
      }
    }

    /** @returns `provider/model`, the key the settings section uses. */
    function routeKey(route) {
      return `${route.provider}/${route.model}`
    }

    /** @returns every route of the catalog plus stored routes the catalog no longer offers. */
    function candidates(groups, stored) {
      const list = []
      const seen = new Set()
      for (const group of Array.isArray(groups) ? groups : []) {
        for (const model of Array.isArray(group.models) ? group.models : []) {
          const route = { provider: group.id, model: model.id }
          const key = routeKey(route)
          seen.add(key)
          list.push({ ...route, key, providerName: group.name ?? group.id, modelName: model.name ?? model.id, available: true })
        }
      }
      for (const route of Array.isArray(stored) ? stored : []) {
        const key = routeKey(route)
        if (seen.has(key)) continue
        seen.add(key)
        list.push({ ...route, key, providerName: route.provider, modelName: route.model, available: false })
      }
      return list
    }

    /**
     * Settings → Plugins page: provider-grouped route selection.
     * @param props - slot entry props.
     */
    function SubagentRoutesPage(props) {
      const t = translator(props)
      // `remote` is the harness's authorized client face; the plugin's apply passes it in.
      const client = props.remote
      const [state, setState] = React.useState({
        phase: 'loading',
        enabled: false,
        selected: [],
        revision: undefined,
        writable: true,
        groups: [],
        error: null,
        saved: false,
        effort: null,
        efforts: [],
      })

      /** Load the namespace and the catalog together; either may fail independently. */
      const load = async () => {
        try {
          const described = await client.settings.describe()
          if (described === null || described.ok !== true) throw new Error('settings describe failed')
          const namespace = (described.value.namespaces ?? []).find((entry) => entry.ns === SETTINGS_NS)
          if (namespace === undefined) {
            setState((current) => ({ ...current, phase: 'unavailable' }))
            return
          }
          const value = namespace.value ?? {}
          const stored = Array.isArray(value.allowedModels) ? value.allowedModels : []
          let groups = []
          try {
            const catalog = await client.session.modelCatalog()
            if (catalog.ok === true) groups = catalog.value.groups ?? []
          } catch {
            // A catalog failure leaves the stored routes visible and unselectable-but-kept.
          }
          let effort = null
          let efforts = []
          try {
            const status = await fetch('/plugin/subagent-routes/status', { headers: { accept: 'application/json' } })
            if (status.ok) {
              const body = await status.json()
              effort = typeof body.effort === 'string' ? body.effort : null
              efforts = Array.isArray(body.efforts) ? body.efforts : []
            }
          } catch {
            // Without the status route the page still edits routes; the effort select stays empty.
          }
          setState({
            phase: 'ready',
            enabled: value.enabled === true,
            selected: stored.map(routeKey),
            revision: namespace.revision,
            writable: described.value.writable !== false,
            groups,
            error: null,
            saved: false,
            effort,
            efforts,
          })
        } catch (error) {
          setState((current) => ({ ...current, phase: 'error', error: String(error?.message ?? error) }))
        }
      }

      React.useEffect(() => {
        load()
      }, [])

      const all = candidates(state.groups, state.selected.map((key) => {
        const [provider, ...rest] = String(key).split('/')
        return { provider, model: rest.join('/') }
      }))

      const grouped = new Map()
      for (const item of all) {
        if (!grouped.has(item.provider)) grouped.set(item.provider, { id: item.provider, name: item.providerName, models: [] })
        grouped.get(item.provider).models.push(item)
      }

      const toggleOne = (key) => {
        setState((current) => ({
          ...current,
          saved: false,
          selected: current.selected.includes(key)
            ? current.selected.filter((entry) => entry !== key)
            : [...current.selected, key],
        }))
      }

      const toggleProvider = (provider) => {
        setState((current) => {
          const keys = all.filter((item) => item.provider === provider).map((item) => item.key)
          const allOn = keys.every((key) => current.selected.includes(key))
          const next = allOn
            ? current.selected.filter((key) => !keys.includes(key))
            : [...new Set([...current.selected, ...keys])]
          return { ...current, saved: false, selected: next }
        })
      }

      const save = async () => {
        setState((current) => ({ ...current, phase: 'saving', error: null }))
        try {
          const allowedModels = state.selected.map((key) => {
            const [provider, ...rest] = String(key).split('/')
            return { provider, model: rest.join('/') }
          })
          const result = await client.settings.update(
            SETTINGS_NS,
            { enabled: state.enabled, allowedModels },
            state.revision,
          )
          if (result === null || result.ok !== true) throw new Error('settings update failed')
          await load()
          setState((current) => ({ ...current, saved: true }))
        } catch (error) {
          setState((current) => ({ ...current, phase: 'ready', error: String(error?.message ?? error) }))
        }
      }

      if (state.phase === 'loading') {
        return h('div', { className: 'dshsr_section' }, h('style', { key: 'style' }, CSS),
          h('h2', { className: 'dshsr_title' }, t('title')), h('p', { className: 'dshsr_hint' }, t('loading')))
      }
      if (state.phase === 'unavailable') {
        return h('div', { className: 'dshsr_section' }, h('style', { key: 'style' }, CSS),
          h('h2', { className: 'dshsr_title' }, t('title')), h('p', { className: 'dshsr_hint' }, t('unavailable')))
      }

      const writeBlocked = state.writable !== true
      return h(
        'div',
        { className: 'dshsr_section' },
        h('style', { key: 'style' }, CSS),
        h('h2', { className: 'dshsr_title' }, t('title')),
        h('p', { className: 'dshsr_intro' }, t('intro')),

        h(
          'div',
          { className: 'dshsr_card' },
          h(
            'div',
            { className: 'dshsr_row' },
            h(
              'span',
              null,
              h('span', { style: { fontWeight: 500 } }, t('toggle')),
              h('div', { className: 'dshsr_hint' }, t('toggleHint')),
            ),
            h(
              'button',
              {
                type: 'button',
                role: 'switch',
                'aria-checked': state.enabled,
                'aria-label': t('toggle'),
                className: 'dshsr_switch',
                'data-on': state.enabled ? 'true' : 'false',
                disabled: writeBlocked || state.phase === 'saving',
                onClick: () => setState((current) => ({ ...current, enabled: !current.enabled, saved: false })),
              },
              h('span', { className: 'dshsr_knob' }),
            ),
          ),

          h('div', { className: 'dshsr_group' },
            h('div', { className: 'dshsr_groupHead' },
              h('span', { className: 'dshsr_provider' }, t('allowed')),
              h('span', { className: 'dshsr_hint' },
                t('count', { count: state.selected.length, total: all.length }))),
            [...grouped.values()].sort((a, b) => String(a.id).localeCompare(String(b.id))).map((group) =>
              h('div', { className: 'dshsr_group', key: group.id },
                h('div', { className: 'dshsr_groupHead' },
                  h('span', { className: 'dshsr_provider' }, group.name),
                  h('button', {
                    type: 'button',
                    className: 'dshsr_button',
                    disabled: writeBlocked || state.phase === 'saving',
                    onClick: () => toggleProvider(group.id),
                  }, group.models.every((item) => state.selected.includes(item.key)) ? t('none') : t('all'))),
                h('div', { className: 'dshsr_models' },
                  group.models.map((item) =>
                    h('label', { className: item.available ? 'dshsr_model' : 'dshsr_model dshsr_missing', key: item.key },
                      h('input', {
                        type: 'checkbox',
                        checked: state.selected.includes(item.key),
                        disabled: writeBlocked || state.phase === 'saving',
                        onChange: () => toggleOne(item.key),
                      }),
                      item.modelName,
                      item.available ? null : h('span', { className: 'dshsr_hint' }, `(${t('readOnlyRoute')})`))))))),

          h('div', { className: 'dshsr_group' },
            h('div', { className: 'dshsr_groupHead' },
              h('span', { className: 'dshsr_provider' }, t('effort')),
              h('span', { className: 'dshsr_hint' }, t('effortHint'))),
            h('span', { className: 'dshsr_hint' },
              state.effort === null
                ? t('effortDefault')
                : `${t('effortCurrent')}: ${state.effort}`),
            state.efforts.length === 0
              ? h('span', { className: 'dshsr_hint' }, t('effortNone'))
              : h('span', { className: 'dshsr_hint' }, `${t('effortKnown')}: ${state.efforts.join(', ')}`),
            h('span', { className: 'dshsr_hint' }, t('effortWhere'))),

          h('div', { className: 'dshsr_actions' },
            h('button', { type: 'button', className: 'dshsr_button', 'data-tone': 'primary',
              disabled: writeBlocked || state.phase === 'saving', onClick: save },
              state.phase === 'saving' ? t('saving') : t('save')),
            h('button', { type: 'button', className: 'dshsr_button',
              disabled: state.phase === 'saving', onClick: load }, t('discard')),
            writeBlocked ? h('span', { className: 'dshsr_hint' }, t('readOnly')) : null,
            state.saved ? h('span', { className: 'dshsr_ok' }, t('saved')) : null,
            state.error === null ? null : h('span', { className: 'dshsr_error' }, `${t('saveFailed')}: ${state.error}`)),
        ),
      )
    }

    return {
      inject: ['slots', 'locale', 'remote'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, 'en', DICT), 'subagent-routes: dictionary')
        const t = ctx.locale.bind(NS)
        const remote = ctx.remote
        ctx.slots.inject('settings.plugins.tab', () =>
          ctx.slots.register(
            {
              name: 'settings.plugins.tab',
              id: 'subagent-routes',
              order: 30,
              label: () => t('nav'),
              locale: NS,
              inject: () => ({ remote }),
            },
            SubagentRoutesPage,
          ),
        )
      },
    }
  },
})
