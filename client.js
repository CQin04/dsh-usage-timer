/**
 * Usage timer — browser half of the bundle.
 *
 * Timing model: the module applies once when the page boots (the DSH window
 * opens), appends one use record and heartbeats it while the page is alive.
 * `pagehide`, `beforeunload`, and the plugin cleanup close the record; a
 * record left open by a crash or forced quit is closed from its last heartbeat
 * on the next boot. Reopening within CONTINUITY_GAP_MS of the previous close
 * reopens that record instead of appending a new one, so short restarts read
 * as one continuous use. The sidebar panellist entry selects the `main` page
 * that shows the live use, the running total, and the grouped history.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-usage-timer',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const NS = 'usage-timer';
    const PANEL_ID = 'usage-timer';
    const STORAGE_KEY = 'dsh-usage-timer.v1';
    const HEARTBEAT_MS = 5000;
    // Quitting and reopening inside this window continues one use instead of
    // counting a new one; the short gap is included in that use.
    const CONTINUITY_GAP_MS = 3 * 60 * 1000;
    const MAX_SESSIONS = 2000;
    const DAY_MS = 86400000;

    const zh = {
      panel: '使用计时',
      title: '使用计时',
      subtitle: '打开 DSH 时自动开始计时，关闭时停止；3 分钟内重新打开会继续同一次计时。',
      current: '本次使用',
      total: '累计使用',
      sessions: '打开次数',
      since: '开始于',
      live: '计时中',
      idle: '未在计时',
      history: '使用记录',
      empty: '还没有使用记录，下次打开 DSH 时会自动开始计时。',
      inProgress: '进行中',
      today: '今天',
      yesterday: '昨天',
      times: '{count} 次',
      dayTotal: '合计 {duration}',
      avg: '平均每次 {duration}',
      hour: '小时',
      minute: '分',
      second: '秒',
    };

    const en = {
      panel: 'Usage timer',
      title: 'Usage timer',
      subtitle: 'Starts timing when DSH opens and stops when it closes; reopening within 3 minutes continues the same use.',
      current: 'This use',
      total: 'Total time',
      sessions: 'Opens',
      since: 'Started at',
      live: 'Timing',
      idle: 'Not timing',
      history: 'Usage history',
      empty: 'No usage recorded yet. Timing starts automatically the next time DSH opens.',
      inProgress: 'In progress',
      today: 'Today',
      yesterday: 'Yesterday',
      times: '{count} opens',
      dayTotal: 'Total {duration}',
      avg: 'Average {duration} per open',
      hour: 'h',
      minute: 'min',
      second: 's',
    };

    // English stands in for the locales this plugin does not translate yet.
    const dictionaries = { zh, en, ja: en, es: en, fr: en, de: en, ru: en, pt: en };

    //#region records

    function storage() {
      try {
        return window.localStorage;
      } catch (_error) {
        return undefined;
      }
    }

    function isSession(value) {
      return Boolean(
        value &&
          typeof value.id === 'string' &&
          Number.isFinite(value.start) &&
          (value.end == null || Number.isFinite(value.end)),
      );
    }

    function readData() {
      const store = storage();
      if (!store) return { version: 1, sessions: [] };
      try {
        const parsed = JSON.parse(store.getItem(STORAGE_KEY) || 'null');
        if (parsed && Array.isArray(parsed.sessions)) {
          return { version: 1, sessions: parsed.sessions.filter(isSession) };
        }
      } catch (_error) {
        // Corrupted storage falls back to an empty record set.
      }
      return { version: 1, sessions: [] };
    }

    function writeData(sessions) {
      const store = storage();
      if (!store) return;
      const ordered = sessions
        .filter(isSession)
        .sort((left, right) => left.start - right.start)
        .slice(-MAX_SESSIONS);
      try {
        store.setItem(STORAGE_KEY, JSON.stringify({ version: 1, sessions: ordered }));
      } catch (_error) {
        // A full or blocked storage keeps the in-memory view usable.
      }
    }

    function makeId() {
      return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    }

    /**
     * Open one use record at boot and close it when the page goes away.
     * @param ctx - browser plugin context that owns the cleanup.
     */
    function startTracking(ctx) {
      ctx.effect(() => {
        const now = Date.now();
        const sessions = readData().sessions
          .slice()
          .sort((left, right) => left.start - right.start);
        const closeAt = (session) => {
          const lastSeen = Number.isFinite(session.lastSeen) ? session.lastSeen : session.start;
          session.end = Math.max(session.start, lastSeen);
          session.lastSeen = session.end;
        };

        // A quick restart continues the newest use instead of opening a new
        // one: reopen a just-closed record, or keep an interrupted one open.
        const last = sessions[sessions.length - 1];
        let own;
        if (last !== undefined) {
          const lastSeen = Number.isFinite(last.lastSeen) ? last.lastSeen : last.start;
          if (last.end == null) {
            if (now - lastSeen <= CONTINUITY_GAP_MS) own = last;
            else closeAt(last);
          } else if (now - last.end <= CONTINUITY_GAP_MS) {
            last.end = null;
            own = last;
          }
        }

        // Every other record still marked open belongs to a run that never
        // closed it; close it from its last heartbeat.
        for (const session of sessions) {
          if (session !== own && session.end == null) closeAt(session);
        }

        if (own === undefined) {
          own = { id: makeId(), start: now, lastSeen: now, end: null };
          sessions.push(own);
        } else {
          own.lastSeen = now;
        }
        writeData(sessions);

        const beat = () => {
          if (own.end != null) return;
          const snapshot = readData();
          const target = snapshot.sessions.find((session) => session.id === own.id);
          if (target === undefined) {
            own.lastSeen = Date.now();
            snapshot.sessions.push({ ...own });
            writeData(snapshot.sessions);
            return;
          }
          if (target.end != null) {
            // Closed elsewhere (a second window booted and reclaimed it).
            own.end = target.end;
            return;
          }
          target.lastSeen = Date.now();
          writeData(snapshot.sessions);
        };

        const finish = () => {
          if (own.end != null) return;
          own.end = Date.now();
          own.lastSeen = own.end;
          const snapshot = readData();
          const target = snapshot.sessions.find((session) => session.id === own.id);
          if (target === undefined) {
            snapshot.sessions.push({ ...own });
          } else if (target.end == null) {
            target.end = own.end;
            target.lastSeen = own.end;
          }
          writeData(snapshot.sessions);
        };

        const timer = window.setInterval(beat, HEARTBEAT_MS);
        window.addEventListener('pagehide', finish);
        window.addEventListener('beforeunload', finish);

        return () => {
          window.clearInterval(timer);
          window.removeEventListener('pagehide', finish);
          window.removeEventListener('beforeunload', finish);
          finish();
        };
      }, 'usage-timer: use tracking');
    }

    //#endregion

    //#region formatting

    function formatTemplate(template, values) {
      return template.replace(/\{(\w+)\}/g, (match, name) =>
        values[name] == null ? match : String(values[name]),
      );
    }

    function two(value) {
      return value < 10 ? `0${value}` : String(value);
    }

    function clock(ms) {
      const total = Math.max(0, Math.round(ms / 1000));
      const hours = Math.floor(total / 3600);
      const minutes = Math.floor((total % 3600) / 60);
      const seconds = total % 60;
      return `${two(hours)}:${two(minutes)}:${two(seconds)}`;
    }

    function durationText(ms, t) {
      const total = Math.max(0, Math.round(ms / 1000));
      const hours = Math.floor(total / 3600);
      const minutes = Math.floor((total % 3600) / 60);
      const seconds = total % 60;
      if (hours > 0) return `${hours} ${t('hour')} ${two(minutes)} ${t('minute')}`;
      if (minutes > 0) return `${minutes} ${t('minute')} ${two(seconds)} ${t('second')}`;
      return `${seconds} ${t('second')}`;
    }

    function startOfDay(ts) {
      const date = new Date(ts);
      date.setHours(0, 0, 0, 0);
      return date.getTime();
    }

    let timeFormatter;
    function timeText(ts) {
      if (timeFormatter === undefined) {
        timeFormatter = new Intl.DateTimeFormat(undefined, {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
        });
      }
      return timeFormatter.format(ts);
    }

    let dateFormatter;
    function dayText(ts, t) {
      const days = Math.round((startOfDay(Date.now()) - startOfDay(ts)) / DAY_MS);
      if (days === 0) return t('today');
      if (days === 1) return t('yesterday');
      if (dateFormatter === undefined) {
        dateFormatter = new Intl.DateTimeFormat(undefined, {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          weekday: 'short',
        });
      }
      return dateFormatter.format(ts);
    }

    function groupSessions(sessions) {
      const groups = [];
      const byDay = new Map();
      const ordered = sessions.slice().sort((left, right) => right.start - left.start);
      for (const session of ordered) {
        const key = startOfDay(session.start);
        let group = byDay.get(key);
        if (group === undefined) {
          group = { key, start: session.start, sessions: [] };
          byDay.set(key, group);
          groups.push(group);
        }
        group.sessions.push(session);
      }
      return groups;
    }

    //#endregion

    //#region view

    const styles = {
      page: {
        height: '100%',
        overflowY: 'auto',
        background: 'var(--dsw-alias-bg-base)',
        color: 'var(--dsw-alias-label-primary)',
      },
      container: {
        maxWidth: 760,
        margin: '0 auto',
        padding: '48px 32px 72px',
        boxSizing: 'border-box',
      },
      title: { margin: 0, fontSize: 24, fontWeight: 600, letterSpacing: '0.01em' },
      subtitle: {
        margin: '8px 0 0',
        fontSize: 13,
        lineHeight: 1.6,
        color: 'var(--dsw-alias-label-secondary)',
      },
      cards: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
        gap: 16,
        marginTop: 28,
      },
      card: {
        background: 'var(--dsw-alias-bg-layer-1)',
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: 12,
        padding: '18px 20px',
      },
      cardLabel: {
        display: 'block',
        fontSize: 12,
        letterSpacing: '0.04em',
        color: 'var(--dsw-alias-label-secondary)',
      },
      clock: {
        marginTop: 8,
        fontSize: 30,
        lineHeight: 1.2,
        fontWeight: 600,
        fontVariantNumeric: 'tabular-nums',
      },
      cardMeta: {
        marginTop: 10,
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 8,
        fontSize: 12,
        color: 'var(--dsw-alias-label-secondary)',
      },
      badgeLive: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '1px 8px',
        borderRadius: 999,
        fontSize: 11,
        color: 'var(--dsw-alias-state-success-primary)',
        border: '1px solid var(--dsw-alias-state-success-primary)',
      },
      badgeIdle: {
        display: 'inline-flex',
        alignItems: 'center',
        padding: '1px 8px',
        borderRadius: 999,
        fontSize: 11,
        color: 'var(--dsw-alias-state-idle-primary)',
        border: '1px solid var(--dsw-alias-border-l2)',
      },
      sectionTitle: { margin: '0 0 12px', fontSize: 15, fontWeight: 600 },
      history: { marginTop: 36 },
      empty: { margin: 0, fontSize: 13, color: 'var(--dsw-alias-label-secondary)' },
      group: { display: 'flex', flexDirection: 'column', gap: 8 },
      groupList: { display: 'flex', flexDirection: 'column', gap: 20 },
      groupHeader: {
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        gap: 12,
        fontSize: 13,
        fontWeight: 500,
      },
      groupTotal: { fontSize: 12, fontWeight: 400, color: 'var(--dsw-alias-label-secondary)' },
      table: {
        background: 'var(--dsw-alias-bg-layer-1)',
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: 10,
        overflow: 'hidden',
      },
      row: {
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 14px',
        fontSize: 13,
      },
      rowRange: { flex: 1, minWidth: 0, fontVariantNumeric: 'tabular-nums' },
      rowDuration: {
        color: 'var(--dsw-alias-label-secondary)',
        fontVariantNumeric: 'tabular-nums',
        whiteSpace: 'nowrap',
      },
    };

    function UsageTimerPage(props) {
      const t = typeof props.t === 'function' ? props.t : (key) => zh[key] || key;
      const [, bump] = React.useState(0);

      React.useEffect(() => {
        const timer = window.setInterval(() => bump((value) => value + 1), 1000);
        return () => window.clearInterval(timer);
      }, []);

      const now = Date.now();
      const sessions = readData().sessions;
      const live = sessions.find((session) => session.end == null);
      const totalMs = sessions.reduce(
        (sum, session) =>
          sum + Math.max(0, (session.end == null ? now : session.end) - session.start),
        0,
      );
      const count = sessions.length;
      const average = count > 0 ? totalMs / count : 0;
      const groups = groupSessions(sessions);

      return h(
        'div',
        { style: styles.page },
        h(
          'div',
          { style: styles.container },
          h(
            'header',
            null,
            h('h1', { style: styles.title }, t('title')),
            h('p', { style: styles.subtitle }, t('subtitle')),
          ),
          h(
            'div',
            { style: styles.cards },
            h(
              'section',
              { style: styles.card, 'aria-label': t('current') },
              h('span', { style: styles.cardLabel }, t('current')),
              h('div', { style: styles.clock }, clock(live ? now - live.start : 0)),
              h(
                'div',
                { style: styles.cardMeta },
                live
                  ? h('span', { style: styles.badgeLive }, t('live'))
                  : h('span', { style: styles.badgeIdle }, t('idle')),
                live
                  ? h(
                      'span',
                      null,
                      `${t('since')} ${timeText(live.start)}`,
                    )
                  : null,
              ),
            ),
            h(
              'section',
              { style: styles.card, 'aria-label': t('total') },
              h('span', { style: styles.cardLabel }, t('total')),
              h('div', { style: styles.clock }, clock(totalMs)),
              h(
                'div',
                { style: styles.cardMeta },
                h('span', null, formatTemplate(t('times'), { count })),
                h('span', { 'aria-hidden': true }, '·'),
                h(
                  'span',
                  null,
                  formatTemplate(t('avg'), { duration: durationText(average, t) }),
                ),
              ),
            ),
          ),
          h(
            'section',
            { style: styles.history },
            h('h2', { style: styles.sectionTitle }, t('history')),
            groups.length === 0
              ? h('p', { style: styles.empty }, t('empty'))
              : h(
                  'div',
                  { style: styles.groupList },
                  groups.map((group) => {
                    const groupTotal = group.sessions.reduce(
                      (sum, session) =>
                        sum +
                        Math.max(0, (session.end == null ? now : session.end) - session.start),
                      0,
                    );
                    return h(
                      'div',
                      { key: group.key, style: styles.group },
                      h(
                        'div',
                        { style: styles.groupHeader },
                        h('span', null, dayText(group.start, t)),
                        h(
                          'span',
                          { style: styles.groupTotal },
                          formatTemplate(t('dayTotal'), {
                            duration: durationText(groupTotal, t),
                          }),
                        ),
                      ),
                      h(
                        'div',
                        { style: styles.table },
                        group.sessions.map((session, index) =>
                          h(
                            'div',
                            {
                              key: session.id,
                              style:
                                index === 0
                                  ? styles.row
                                  : {
                                      ...styles.row,
                                      borderTop: '1px solid var(--dsw-alias-border-l1)',
                                    },
                            },
                            h(
                              'span',
                              { style: styles.rowRange },
                              `${timeText(session.start)} → ${
                                session.end == null ? t('inProgress') : timeText(session.end)
                              }`,
                            ),
                            h(
                              'span',
                              { style: styles.rowDuration },
                              durationText(
                                (session.end == null ? now : session.end) - session.start,
                                t,
                              ),
                            ),
                          ),
                        ),
                      ),
                    );
                  }),
                ),
          ),
        ),
      );
    }

    function UsageTimerIcon(props) {
      const size = typeof props.size === 'number' ? props.size : 18;
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          'aria-hidden': 'true',
          focusable: 'false',
          style: { display: 'block' },
        },
        h('circle', {
          cx: 12,
          cy: 12,
          r: 8.5,
          stroke: 'currentColor',
          strokeWidth: 1.7,
        }),
        h('path', {
          d: 'M12 7.2v5.2l3.4 2',
          stroke: 'currentColor',
          strokeWidth: 1.7,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
      );
    }

    //#endregion

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, dictionaries), 'usage-timer: dictionaries');
      const t = ctx.locale.bind(NS);

      startTracking(ctx);

      ctx.effect(
        () =>
          ctx.slots.inject('main', () =>
            ctx.slots.register(
              {
                name: 'main',
                key: PANEL_ID,
                locale: NS,
                inject: () => ({ t }),
              },
              UsageTimerPage,
            ),
          ),
        'usage-timer: panel',
      );

      ctx.effect(
        () =>
          ctx.slots.inject('sidebar.panellist', () =>
            ctx.slots.register(
              {
                name: 'sidebar.panellist',
                id: PANEL_ID,
                order: 20,
                locale: NS,
                label: () => t('panel'),
              },
              UsageTimerIcon,
            ),
          ),
        'usage-timer: sidebar entry',
      );
    }

    return { inject: ['slots', 'locale'], apply };
  },
});
