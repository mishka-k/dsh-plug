/**
 * dsh-mcp-manager — Client half.
 *
 * One page in Settings → Plugins: the MCP servers this profile runs, with add, edit, test,
 * enable/disable and remove. The page talks to the Host half over its own loopback routes; no
 * MCP server detail is hardcoded here — the list arrives from the Host, so the page works with
 * whatever servers the profile has.
 *
 * @module dsh-mcp-manager/client
 */
window.__ModuleLoader__.load({
  id: 'dsh-mcp-manager',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** Locale namespace of this plugin. */
    const NS = 'mcp-manager'
    /** Page API of the Host half. */
    const API = '/plugin/mcp-manager'

    /** English strings; the host `t` takes over when the slot provides one. */
    const DICT = {
      nav: 'MCP servers',
      title: 'MCP servers',
      intro:
        'Connect any MCP server to this profile. Changes are written to the profile patch, so they survive restarts.',
      add: 'Add server',
      edit: 'Edit',
      remove: 'Remove',
      confirm: 'Confirm',
      cancel: 'Cancel',
      save: 'Save',
      test: 'Test',
      testing: 'Testing…',
      loading: 'Loading…',
      empty: 'No MCP servers yet. Add the first one.',
      name: 'Server name',
      nameHint: 'lowercase letters, digits and dashes; it prefixes tool names as mcp__<name>__',
      transport: 'Transport',
      http: 'HTTP (streamable)',
      stdio: 'Command (stdio)',
      url: 'URL',
      headers: 'Headers',
      headersHint: 'one "Key: Value" per line, for example Authorization: Bearer …',
      command: 'Command',
      args: 'Arguments',
      argsHint: 'one per line',
      cwd: 'Working directory',
      enabled: 'Enabled',
      disabled: 'Disabled',
      active: 'connected',
      inactive: 'not connected',
      tools: '{count} tools',
      saveFailed: 'Save failed',
      removeQuestion: 'Remove this server?',
      stdioOff: 'Command transport is disabled for this plugin (allowStdio: false).',
      probeOk: 'Connected: {count} tools',
      probeFailed: 'Probe failed',
    }

    /** Page styling in the host's settings language: tokens only. */
    const CSS = [
      '.dshm_section{max-width:860px;display:flex;flex-direction:column;gap:12px;',
      'color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px}',
      '.dshm_head{display:flex;align-items:center;justify-content:space-between;gap:16px}',
      '.dshm_title{margin:0;font-size:18px;font-weight:600}',
      '.dshm_intro{margin:0;color:var(--dsw-alias-label-secondary)}',
      '.dshm_card{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;',
      'background:var(--dsw-alias-bg-layer-1);padding:4px 14px}',
      '.dshm_row{display:flex;align-items:center;justify-content:space-between;gap:16px;',
      'min-height:52px;border-top:.5px solid var(--dsw-alias-border-l1)}',
      '.dshm_row:first-child{border-top:0}',
      '.dshm_main{display:flex;flex-direction:column;min-width:0;padding:8px 0}',
      '.dshm_name{font-weight:500;display:flex;align-items:center;gap:8px}',
      '.dshm_meta{color:var(--dsw-alias-label-secondary);font-size:12px;overflow:hidden;',
      'text-overflow:ellipsis;white-space:nowrap}',
      '.dshm_dot{width:7px;height:7px;border-radius:50%;flex:none;background:var(--dsw-alias-state-idle-primary)}',
      '.dshm_dot[data-on="true"]{background:var(--dsw-alias-state-success-primary)}',
      '.dshm_actions{display:flex;align-items:center;gap:8px;flex:none}',
      '.dshm_button{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);',
      'border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary);',
      'font:inherit;padding:3px 10px;cursor:pointer}',
      '.dshm_button:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2)}',
      '.dshm_button:disabled{opacity:.5;cursor:default}',
      '.dshm_button[data-tone="primary"]{border-color:var(--dsw-alias-brand-primary);',
      'color:var(--dsw-alias-brand-primary)}',
      '.dshm_button[data-tone="danger"]{border-color:var(--dsw-alias-state-error-primary);',
      'color:var(--dsw-alias-state-error-primary)}',
      '.dshm_switch{box-sizing:border-box;flex:none;width:36px;height:20px;padding:0;border:0;',
      'border-radius:10px;background:var(--dsw-alias-state-idle-primary);position:relative;cursor:pointer}',
      '.dshm_switch[data-on="true"]{background:var(--dsw-alias-brand-primary)}',
      '.dshm_switch:disabled{opacity:.5;cursor:default}',
      '.dshm_knob{position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;',
      'background:var(--dsw-alias-bg-base);transition:transform .12s}',
      '.dshm_switch[data-on="true"] .dshm_knob{transform:translateX(16px)}',
      '.dshm_form{display:grid;grid-template-columns:minmax(120px,180px) minmax(0,1fr);',
      'gap:10px 14px;align-items:start;padding:14px 0}',
      '.dshm_label{color:var(--dsw-alias-label-primary);padding-top:5px}',
      '.dshm_input,.dshm_select,.dshm_textarea{box-sizing:border-box;width:100%;padding:5px 8px;',
      'border-radius:6px;border:1px solid var(--dsw-alias-border-l2);',
      'background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit}',
      '.dshm_textarea{min-height:64px;resize:vertical;font-family:var(--dsw-font-family,inherit)}',
      '.dshm_hint{color:var(--dsw-alias-label-secondary);font-size:12px;grid-column:2}',
      '.dshm_footer{grid-column:2;display:flex;align-items:center;gap:10px;flex-wrap:wrap}',
      '.dshm_error{color:var(--dsw-alias-state-error-primary);margin:0}',
      '.dshm_ok{color:var(--dsw-alias-state-success-primary);margin:0}',
      '.dshm_muted{color:var(--dsw-alias-label-secondary);margin:0}',
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

    /** @returns the empty draft of one server. */
    function emptyDraft() {
      return { id: '', serverName: '', transport: 'streamable-http', url: '', headers: '', command: '', args: '', cwd: '' }
    }

    /** @returns a draft filled from a listed server (headers only as key names — values stay on the Host). */
    function draftOf(server) {
      return {
        id: server.id,
        serverName: server.serverName,
        transport: server.transport,
        url: server.url ?? '',
        headers: '',
        command: server.command ?? '',
        args: (server.args ?? []).join('\n'),
        cwd: '',
      }
    }

    /** @returns a request body built from a draft. */
    function bodyOf(draft) {
      const body = {
        id: draft.id === '' ? undefined : draft.id,
        serverName: draft.serverName.trim(),
        transport: draft.transport,
      }
      if (draft.transport === 'stdio') {
        body.command = draft.command.trim()
        body.args = draft.args
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line !== '')
        if (draft.cwd.trim() !== '') body.cwd = draft.cwd.trim()
      } else {
        body.url = draft.url.trim()
        if (draft.headers.trim() !== '') body.headers = draft.headers
      }
      return body
    }

    /** @returns the JSON body of a failed response, or a plain HTTP error. */
    async function failure(response) {
      const body = await response.json().catch(() => ({}))
      return new Error(body?.error ?? `HTTP ${response.status}`)
    }

    /**
     * Settings → Plugins page: the server list and its editor.
     * @param props - slot entry props.
     */
    function McpManagerPage(props) {
      const t = translator(props)
      const [state, setState] = React.useState({ loading: true, servers: [], allowStdio: false, error: null })
      const [draft, setDraft] = React.useState(null)
      const [probe, setProbe] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [pendingRemove, setPendingRemove] = React.useState(null)

      const load = async () => {
        try {
          const response = await fetch(`${API}/servers`, { headers: { accept: 'application/json' } })
          if (!response.ok) throw await failure(response)
          const body = await response.json()
          setState({
            loading: false,
            servers: Array.isArray(body.servers) ? body.servers : [],
            allowStdio: body.allowStdio === true,
            error: null,
          })
        } catch (error) {
          setState((current) => ({ ...current, loading: false, error: String(error?.message ?? error) }))
        }
      }

      React.useEffect(() => {
        load()
      }, [])

      /** Run one write request and refresh the list from its answer. */
      const write = async (request) => {
        setBusy(true)
        setState((current) => ({ ...current, error: null }))
        try {
          const response = await request()
          if (!response.ok) throw await failure(response)
          const body = await response.json()
          if (Array.isArray(body.servers)) {
            setState((current) => ({ ...current, servers: body.servers, loading: false }))
          }
          return body
        } catch (error) {
          setState((current) => ({ ...current, error: String(error?.message ?? error) }))
          return null
        } finally {
          setBusy(false)
        }
      }

      const save = async () => {
        if (draft === null) return
        const saved = await write(() =>
          fetch(`${API}/servers`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify(bodyOf(draft)),
          }),
        )
        if (saved !== null) {
          setDraft(null)
          setProbe(null)
        }
      }

      const toggle = async (server) => {
        await write(() =>
          fetch(`${API}/servers/enabled`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify({ id: server.id, enabled: !server.enabled }),
          }),
        )
      }

      const remove = async (server) => {
        const done = await write(() =>
          fetch(`${API}/servers?id=${encodeURIComponent(server.id)}`, { method: 'DELETE', headers: { accept: 'application/json' } }),
        )
        if (done !== null) setPendingRemove(null)
      }

      const runProbe = async () => {
        if (draft === null) return
        setProbe({ pending: true })
        try {
          const response = await fetch(`${API}/probe`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify(bodyOf(draft)),
          })
          if (!response.ok) throw await failure(response)
          setProbe(await response.json())
        } catch (error) {
          setProbe({ ok: false, error: String(error?.message ?? error) })
        }
      }

      const edit = (value) => setDraft((current) => ({ ...current, ...value }))

      const servers = state.servers
      return h(
        'div',
        { className: 'dshm_section' },
        h('style', { key: 'style' }, CSS),
        h(
          'div',
          { className: 'dshm_head' },
          h('h2', { className: 'dshm_title' }, t('title')),
          draft === null
            ? h(
                'button',
                { type: 'button', className: 'dshm_button', 'data-tone': 'primary', disabled: busy, onClick: () => { setDraft(emptyDraft()); setProbe(null) } },
                t('add'),
              )
            : null,
        ),
        h('p', { className: 'dshm_intro' }, t('intro')),

        draft === null
          ? h(
              'div',
              { className: 'dshm_card' },
              state.loading
                ? h('p', { className: 'dshm_muted' }, t('loading'))
                : servers.length === 0
                  ? h('p', { className: 'dshm_muted' }, t('empty'))
                  : servers.map((server) =>
                      h(
                        'div',
                        { className: 'dshm_row', key: server.id },
                        h(
                          'span',
                          { className: 'dshm_main' },
                          h(
                            'span',
                            { className: 'dshm_name' },
                            h('span', { className: 'dshm_dot', 'data-on': server.enabled && server.active ? 'true' : 'false' }),
                            server.serverName,
                          ),
                          h(
                            'span',
                            { className: 'dshm_meta' },
                            [
                              server.transport === 'stdio' ? server.command : server.url,
                              server.enabled ? (server.active ? t('active') : t('inactive')) : t('disabled'),
                              server.tools > 0 ? t('tools', { count: server.tools }) : null,
                            ]
                              .filter(Boolean)
                              .join(' · '),
                          ),
                        ),
                        h(
                          'span',
                          { className: 'dshm_actions' },
                          pendingRemove === server.id
                            ? [
                                h('span', { key: 'q', className: 'dshm_meta' }, t('removeQuestion')),
                                h(
                                  'button',
                                  { key: 'y', type: 'button', className: 'dshm_button', 'data-tone': 'danger', disabled: busy, onClick: () => remove(server) },
                                  t('confirm'),
                                ),
                                h(
                                  'button',
                                  { key: 'n', type: 'button', className: 'dshm_button', disabled: busy, onClick: () => setPendingRemove(null) },
                                  t('cancel'),
                                ),
                              ]
                            : [
                                h(
                                  'button',
                                  { key: 'e', type: 'button', className: 'dshm_button', disabled: busy, onClick: () => { setDraft(draftOf(server)); setProbe(null) } },
                                  t('edit'),
                                ),
                                h(
                                  'button',
                                  { key: 'r', type: 'button', className: 'dshm_button', disabled: busy, onClick: () => setPendingRemove(server.id) },
                                  t('remove'),
                                ),
                                h(
                                  'button',
                                  {
                                    key: 's',
                                    type: 'button',
                                    role: 'switch',
                                    'aria-checked': server.enabled,
                                    'aria-label': server.serverName,
                                    className: 'dshm_switch',
                                    'data-on': server.enabled ? 'true' : 'false',
                                    disabled: busy,
                                    onClick: () => toggle(server),
                                  },
                                  h('span', { className: 'dshm_knob' }),
                                ),
                              ],
                        ),
                      ),
                    ),
            )
          : h(
              'div',
              { className: 'dshm_card' },
              h(
                'div',
                { className: 'dshm_form' },
                h('label', { className: 'dshm_label', htmlFor: 'dshm-name' }, t('name')),
                h('input', {
                  id: 'dshm-name',
                  className: 'dshm_input',
                  value: draft.serverName,
                  disabled: busy || draft.id !== '',
                  onChange: (event) => edit({ serverName: event.target.value }),
                }),
                h('span', { className: 'dshm_hint' }, t('nameHint')),

                h('label', { className: 'dshm_label', htmlFor: 'dshm-transport' }, t('transport')),
                h(
                  'select',
                  {
                    id: 'dshm-transport',
                    className: 'dshm_select',
                    value: draft.transport,
                    disabled: busy,
                    onChange: (event) => edit({ transport: event.target.value }),
                  },
                  h('option', { value: 'streamable-http' }, t('http')),
                  h('option', { value: 'stdio', disabled: !state.allowStdio }, t('stdio')),
                ),
                h('span', { className: 'dshm_hint' }, state.allowStdio ? '' : t('stdioOff')),

                draft.transport === 'stdio'
                  ? [
                      h('label', { key: 'cl', className: 'dshm_label', htmlFor: 'dshm-command' }, t('command')),
                      h('input', {
                        key: 'ci',
                        id: 'dshm-command',
                        className: 'dshm_input',
                        value: draft.command,
                        disabled: busy,
                        onChange: (event) => edit({ command: event.target.value }),
                      }),
                      h('label', { key: 'al', className: 'dshm_label', htmlFor: 'dshm-args' }, t('args')),
                      h('textarea', {
                        key: 'ai',
                        id: 'dshm-args',
                        className: 'dshm_textarea',
                        value: draft.args,
                        disabled: busy,
                        onChange: (event) => edit({ args: event.target.value }),
                      }),
                      h('span', { key: 'ah', className: 'dshm_hint' }, t('argsHint')),
                      h('label', { key: 'wl', className: 'dshm_label', htmlFor: 'dshm-cwd' }, t('cwd')),
                      h('input', {
                        key: 'wi',
                        id: 'dshm-cwd',
                        className: 'dshm_input',
                        value: draft.cwd,
                        disabled: busy,
                        onChange: (event) => edit({ cwd: event.target.value }),
                      }),
                    ]
                  : [
                      h('label', { key: 'ul', className: 'dshm_label', htmlFor: 'dshm-url' }, t('url')),
                      h('input', {
                        key: 'ui',
                        id: 'dshm-url',
                        className: 'dshm_input',
                        placeholder: 'https://example.com/mcp',
                        value: draft.url,
                        disabled: busy,
                        onChange: (event) => edit({ url: event.target.value }),
                      }),
                      h('label', { key: 'hl', className: 'dshm_label', htmlFor: 'dshm-headers' }, t('headers')),
                      h('textarea', {
                        key: 'hi',
                        id: 'dshm-headers',
                        className: 'dshm_textarea',
                        placeholder: 'Authorization: Bearer …',
                        value: draft.headers,
                        disabled: busy,
                        onChange: (event) => edit({ headers: event.target.value }),
                      }),
                      h('span', { key: 'hh', className: 'dshm_hint' }, t('headersHint')),
                    ],

                h(
                  'div',
                  { className: 'dshm_footer' },
                  h('button', { type: 'button', className: 'dshm_button', 'data-tone': 'primary', disabled: busy, onClick: save }, t('save')),
                  h('button', { type: 'button', className: 'dshm_button', disabled: busy || draft.transport === 'stdio', onClick: runProbe },
                    probe?.pending === true ? t('testing') : t('test')),
                  h('button', { type: 'button', className: 'dshm_button', disabled: busy, onClick: () => { setDraft(null); setProbe(null) } }, t('cancel')),
                  probe === null
                    ? null
                    : probe.pending === true
                      ? h('span', { className: 'dshm_muted' }, t('testing'))
                      : probe.ok === true
                        ? h('span', { className: 'dshm_ok' }, t('probeOk', { count: Array.isArray(probe.tools) ? probe.tools.length : 0 }))
                        : h('span', { className: 'dshm_error' }, `${t('probeFailed')}: ${probe.error ?? 'unknown'}`),
                ),
              ),
            ),

        state.error === null ? null : h('p', { className: 'dshm_error' }, state.error),
      )
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, 'en', DICT), 'mcp-manager: dictionary')
        const t = ctx.locale.bind(NS)
        ctx.slots.inject('settings.plugins.tab', () =>
          ctx.slots.register(
            {
              name: 'settings.plugins.tab',
              id: 'mcp-manager',
              order: 40,
              label: () => t('nav'),
              locale: NS,
            },
            McpManagerPage,
          ),
        )
      },
    }
  },
})
