/**
 * dsh-provider-limits — Client half.
 *
 * Pills under the composer, in the same row as the cache hit, tok/s and the context meter.
 * The numbers come from the Host half through `GET /plugin/provider-limits` (that is where
 * the keys live); this module polls the route once a minute and formats the answer. Provider
 * labels, short codes and currencies are not hardcoded here — they arrive in the snapshot.
 *
 * Hovering (or focusing) a pill opens a small card with the whole quota breakdown: every
 * window, its usage, when it resets, and what is left of its credit. A native `title` cannot
 * do that — it is slow, cannot be styled and is cut off by the dock's single line — so the
 * card is drawn here and portalled to `document.body` to escape the composer's stacking
 * context. If `react-dom` is unavailable the card still renders, anchored above the pill.
 *
 * @module dsh-provider-limits/client
 */
window.__ModuleLoader__.load({
  id: 'dsh-provider-limits',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** Portal helper; a missing `react-dom` only costs the portal, not the card. */
    let createPortal
    try {
      createPortal = require('react-dom').createPortal
    } catch {
      createPortal = undefined
    }

    /** Locale namespace of this plugin. */
    const NS = 'provider-limits'
    /** Host route, same origin as the page. */
    const ENDPOINT = '/plugin/provider-limits'
    /** Snapshot poll interval, ms. */
    const POLL_MS = 60_000
    /** Grace period before closing the card, so the pointer can travel into it, ms. */
    const CLOSE_DELAY_MS = 120

    /** English strings; the host `t` takes over whenever the slot provides it. */
    const DICT = {
      'window.rolling': '5h',
      'window.weekly': 'week',
      'window.monthly': 'month',
      reset: 'reset',
      left: '{remaining} / {total} left',
      balance: '{name} balance',
      error: '{name}: {error}',
      stale: 'updated {age} ago',
      second: 's',
      minute: 'min',
      hour: 'h',
      day: 'd',
    }

    /** Pill and card styling, copied from the host stats pills/dialog under our own prefix. */
    const CSS = [
      '.dshpl_group{display:contents}',
      '.dshpl_anchor{position:relative;min-width:0;',
      'font-size:calc(var(--dsh-content-font-size-secondary,13px) - 1px);',
      'line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));display:inline-flex}',
      '.dshpl_pill{box-sizing:border-box;border-radius:var(--dsw-radius-sm);max-width:100%;',
      'color:var(--dsw-alias-label-tertiary);font:inherit;font-variant-numeric:tabular-nums;',
      'line-height:inherit;white-space:nowrap;background:0 0;border:none;align-items:center;gap:6px;',
      'padding:1px 8px;display:inline-flex;cursor:default}',
      '.dshpl_pill:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}',
      '.dshpl_pill svg{flex:none;width:14px;height:14px}',
      '.dshpl_quiet .dshpl_pill{opacity:.6}',
      '.dshpl_label{text-overflow:ellipsis;min-width:0;overflow:hidden}',
      '.dshpl_panel{box-sizing:border-box;z-index:60;width:max-content;min-width:236px;max-width:340px;',
      'padding:10px 12px;border-radius:var(--dsw-radius-md,10px);background:var(--dsw-specific-menu);',
      'border:.5px solid var(--dsw-alias-border-l1);box-shadow:var(--dsw-elevation-prominent);',
      'color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;font-weight:400;',
      'white-space:normal;text-align:left}',
      '.dshpl_panel[data-portal="false"]{position:absolute;bottom:calc(100% + 8px);left:50%;transform:translateX(-50%)}',
      '.dshpl_title{display:flex;justify-content:space-between;align-items:center;gap:16px;',
      'color:var(--dsw-alias-label-primary);font-weight:500;margin-bottom:8px}',
      '.dshpl_titleLabel{display:inline-flex;align-items:center;gap:6px;min-width:0}',
      '.dshpl_titleLabel svg{flex:none;width:14px;height:14px}',
      '.dshpl_titleValue{font-variant-numeric:tabular-nums}',
      '.dshpl_rule{border-top:.5px solid var(--dsw-alias-border-l2);margin-bottom:8px}',
      '.dshpl_row{display:grid;grid-template-columns:auto auto minmax(0,1fr);align-items:baseline;',
      'gap:2px 10px;padding:2px 0}',
      '.dshpl_rowName{color:var(--dsw-alias-label-tertiary)}',
      '.dshpl_rowValue{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary)}',
      '.dshpl_rowNote{color:var(--dsw-alias-label-tertiary);text-align:right;font-variant-numeric:tabular-nums}',
      '.dshpl_footer{color:var(--dsw-alias-label-caption);margin-top:6px}',
    ].join('')

    /** Quota icon: three rising bars. */
    function WindowIcon(props) {
      return h(
        'svg',
        { viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true, ...props },
        h('path', {
          d: 'M2.5 13.5V9M8 13.5V5.5M13.5 13.5V2.5',
          stroke: 'currentColor',
          strokeWidth: 1.5,
          strokeLinecap: 'round',
        }),
      )
    }

    /** Balance icon: a coin with a slash. */
    function BalanceIcon(props) {
      return h(
        'svg',
        { viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true, ...props },
        h('circle', { cx: 8, cy: 8, r: 5.75, stroke: 'currentColor', strokeWidth: 1.5 }),
        h('path', {
          d: 'M8 4.75v6.5M6.25 6.5h3.5M6.25 9.5h3.5',
          stroke: 'currentColor',
          strokeWidth: 1.25,
          strokeLinecap: 'round',
        }),
      )
    }

    /** @returns the client locale, for Intl formatting. */
    function intlLocale() {
      return String(globalThis.navigator?.language ?? 'en')
    }

    /** @returns a grouped integer for credit counters. */
    function count(value) {
      const parsed = Number(value)
      if (!Number.isFinite(parsed)) return String(value)
      return new Intl.NumberFormat(intlLocale(), { maximumFractionDigits: 0 }).format(parsed)
    }

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

    /** Polls the Host route: snapshot plus a failure flag. */
    function useSnapshot() {
      const [state, setState] = React.useState({ snapshot: undefined, failed: false })
      React.useEffect(() => {
        let alive = true
        let timer
        const load = async () => {
          try {
            const response = await fetch(ENDPOINT, { headers: { accept: 'application/json' } })
            if (!response.ok) throw new Error(`HTTP ${response.status}`)
            const body = await response.json()
            if (!alive) return
            setState({ snapshot: body, failed: false })
          } catch (error) {
            if (!alive) return
            setState((current) => ({ snapshot: current.snapshot, failed: true }))
          }
        }
        load()
        timer = setInterval(load, POLL_MS)
        return () => {
          alive = false
          clearInterval(timer)
        }
      }, [])
      return state
    }

    /** @returns "42 s" / "12 min" / "3 h" / "2 d". */
    function relativeAge(t, fromIso) {
      const from = Date.parse(fromIso)
      if (!Number.isFinite(from)) return null
      const seconds = Math.max(0, Math.round((Date.now() - from) / 1000))
      if (seconds < 90) return `${seconds} ${t('second')}`
      const minutes = Math.round(seconds / 60)
      if (minutes < 90) return `${minutes} ${t('minute')}`
      const hours = Math.round(minutes / 60)
      if (hours < 36) return `${hours} ${t('hour')}`
      return `${Math.round(hours / 24)} ${t('day')}`
    }

    /** @returns "05.11 14:31" in local time, or null. */
    function resetText(iso) {
      const at = Date.parse(iso)
      if (!Number.isFinite(at)) return null
      const date = new Date(at)
      const pad = (value) => String(value).padStart(2, '0')
      return `${pad(date.getDate())}.${pad(date.getMonth() + 1)} ${pad(date.getHours())}:${pad(date.getMinutes())}`
    }

    /** @returns the window name: a known name from the dictionary, else the provider's own label. */
    function windowLabel(t, window) {
      const key = `window.${window.label}`
      const known = t(key)
      return known === key ? String(window.label ?? '?') : known
    }

    /**
     * Money for humans: currency symbol and separators come from Intl, not from a table in
     * the code.
     * @param wallets - snapshot wallets.
     * @returns "¥12.34" or "¥12.34 · $1.00".
     */
    function money(wallets) {
      const locale = intlLocale()
      return wallets
        .map((wallet) => {
          try {
            return new Intl.NumberFormat(locale, {
              style: 'currency',
              currency: wallet.currency,
              maximumFractionDigits: 2,
            }).format(wallet.amount)
          } catch {
            return `${wallet.currency} ${Number(wallet.amount).toFixed(2)}`
          }
        })
        .join(' · ')
    }

    /** @returns the short pill label, or null when there is nothing to show. */
    function label(provider) {
      const short = provider.short ?? provider.id
      if (Array.isArray(provider.wallets) && provider.wallets.length > 0) return money(provider.wallets)
      if (typeof provider.percent === 'number') return `${short} ${Math.round(provider.percent)}%`
      if (typeof provider.error === 'string' && provider.error !== '') return `${short} —`
      return null
    }

    /** @returns flat text for the pill's aria-label. */
    function ariaLabel(provider, t, age) {
      const name = provider.label ?? provider.id
      const parts = []
      if (Array.isArray(provider.windows)) {
        for (const window of provider.windows) {
          parts.push(`${windowLabel(t, window)} ${window.percent ?? '—'}%`)
        }
      }
      if (Array.isArray(provider.wallets)) parts.push(money(provider.wallets))
      if (typeof provider.error === 'string' && provider.error !== '') parts.push(provider.error)
      const text = `${name}: ${parts.join(', ') || '—'}`
      return age === null ? text : `${text} (${t('stale', { age })})`
    }

    /** @returns one quota window row: name, usage, reset and remaining credit. */
    function windowRow(t, window, index) {
      const reset = resetText(window.resetsAt)
      const note = []
      if (reset !== null) note.push(`${t('reset')} ${reset}`)
      if (typeof window.remaining === 'number' && typeof window.total === 'number') {
        note.push(t('left', { remaining: count(window.remaining), total: count(window.total) }))
      }
      return h(
        'div',
        { className: 'dshpl_row', key: `w${index}` },
        h('span', { className: 'dshpl_rowName' }, windowLabel(t, window)),
        h('span', { className: 'dshpl_rowValue' }, `${window.percent ?? '—'}%`),
        h('span', { className: 'dshpl_rowNote' }, note.join(' · ')),
      )
    }

    /**
     * The card body: quota windows for a usage provider, wallets for a balance provider, or the
     * failure that stopped it.
     * @param provider - snapshot element.
     * @param t - translate function.
     * @param age - snapshot age as text.
     * @returns card children.
     */
    function cardBody(provider, t, age) {
      const rows = []
      if (Array.isArray(provider.windows)) {
        provider.windows.forEach((window, index) => rows.push(windowRow(t, window, index)))
      }
      if (Array.isArray(provider.wallets)) {
        for (const [index, wallet] of provider.wallets.entries()) {
          rows.push(
            h(
              'div',
              { className: 'dshpl_row', key: `m${index}` },
              h('span', { className: 'dshpl_rowName' }, wallet.currency),
              h('span', { className: 'dshpl_rowValue' }, money([wallet])),
            ),
          )
        }
      }
      if (rows.length === 0 && typeof provider.error === 'string' && provider.error !== '') {
        rows.push(
          h('div', { className: 'dshpl_row', key: 'error' }, h('span', { className: 'dshpl_rowName' }, 'error'), h('span', { className: 'dshpl_rowValue' }, provider.error)),
        )
      }
      if (age !== null) rows.push(h('div', { className: 'dshpl_footer', key: 'age' }, t('stale', { age })))
      return rows
    }

    /**
     * One pill with its hover card.
     * @param props - provider element, translate function, snapshot age.
     */
    function ProviderPill({ provider, t, age }) {
      const [open, setOpen] = React.useState(false)
      const [pos, setPos] = React.useState(null)
      const anchor = React.useRef(null)
      const timer = React.useRef(undefined)

      const cancelClose = () => {
        if (timer.current !== undefined) {
          clearTimeout(timer.current)
          timer.current = undefined
        }
      }
      const close = () => {
        cancelClose()
        setOpen(false)
      }
      const openCard = () => {
        cancelClose()
        const element = anchor.current
        if (element !== null && element !== undefined && createPortal !== undefined) {
          const rect = element.getBoundingClientRect()
          setPos({ left: rect.left + rect.width / 2, bottom: globalThis.innerHeight - rect.top + 8 })
        }
        setOpen(true)
      }
      const scheduleClose = () => {
        cancelClose()
        timer.current = setTimeout(() => {
          timer.current = undefined
          setOpen(false)
        }, CLOSE_DELAY_MS)
      }
      React.useEffect(() => () => cancelClose(), [])

      const text = label(provider)
      if (text === null) return null
      const ok = typeof provider.percent === 'number' || Array.isArray(provider.wallets)
      const icon = provider.display === 'money' ? h(BalanceIcon) : h(WindowIcon)
      const tip = ariaLabel(provider, t, age)
      const card = open
        ? h(
            'div',
            {
              className: 'dshpl_panel',
              role: 'tooltip',
              'data-portal': createPortal === undefined ? 'false' : 'true',
              style:
                createPortal === undefined || pos === null
                  ? undefined
                  : {
                      position: 'fixed',
                      left: `${pos.left}px`,
                      bottom: `${pos.bottom}px`,
                      transform: 'translateX(-50%)',
                    },
              onMouseEnter: cancelClose,
              onMouseLeave: scheduleClose,
            },
            h(
              'div',
              { className: 'dshpl_title' },
              h('span', { className: 'dshpl_titleLabel' }, icon, provider.label ?? provider.id),
              typeof provider.percent === 'number'
                ? h('span', { className: 'dshpl_titleValue' }, `${Math.round(provider.percent)}%`)
                : null,
            ),
            h('div', { className: 'dshpl_rule' }),
            cardBody(provider, t, age),
          )
        : null

      return h(
        'span',
        {
          ref: anchor,
          className: ok ? 'dshpl_anchor' : 'dshpl_anchor dshpl_quiet',
          'data-composer-stat': `provider-limits-${provider.id}`,
          onMouseEnter: openCard,
          onMouseLeave: scheduleClose,
          onFocus: openCard,
          onBlur: close,
          onKeyDown: (event) => {
            if (event.key === 'Escape') close()
          },
        },
        h(
          'span',
          { className: 'dshpl_pill', tabIndex: 0, 'aria-label': tip },
          icon,
          h('span', { className: 'dshpl_label' }, text),
        ),
        card === null ? null : createPortal === undefined ? card : createPortal(card, document.body),
      )
    }

    /**
     * Limits row under the composer: one pill per provider.
     * @param props - slot entry props (`t` arrives from the slot locale).
     */
    function ProviderLimits(props) {
      const t = translator(props)
      const { snapshot, failed } = useSnapshot()
      const providers = Array.isArray(snapshot?.providers) ? snapshot.providers : []
      const age = relativeAge(t, snapshot?.fetchedAt)
      if (providers.length === 0) {
        // No data yet (or the route is unreachable): render nothing. An empty pill in the
        // dock is worse than no pill; the failure stays in the package console.
        if (failed) console.warn('[provider-limits] /plugin/provider-limits is unreachable')
        return null
      }
      return h(
        'span',
        { className: 'dshpl_group' },
        h('style', { key: 'style' }, CSS),
        providers.map((provider) =>
          h(ProviderPill, { key: provider.id, provider, t, age }),
        ),
      )
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, 'en', DICT), 'provider-limits: dictionary')
        ctx.slots.inject('conversation.composer.dock', () =>
          ctx.slots.register(
            {
              name: 'conversation.composer.dock',
              id: 'provider-limits',
              order: 2,
              locale: NS,
            },
            ProviderLimits,
          ),
        )
      },
    }
  },
})
