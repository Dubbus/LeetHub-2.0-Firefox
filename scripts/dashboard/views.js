/*
 * DOM builders for the dashboard views. Everything is built with textContent / properties (never
 * innerHTML), so CSV contents can't inject markup. State lives in dashboard.js; views get a `ctx`.
 */
import {
  COLUMNS,
  OPTIONS,
  INTERVAL_DAYS,
  annotateAttempts,
  reviewSchedule,
  weekOf,
  parseDay,
} from '../leetcode/trackerCsv';
import {
  groupByProblem,
  overallStats,
  weekProgress,
  parsePct,
  planProgress,
  focusWeek,
  patternProgress,
  nextNew,
  sessionMix,
} from './stats';
import plan from './data/plan.json';
import planProblems from './data/problems.json';
import cheatsheet from './data/cheatsheet.json';
import guide from './data/guide.json';
import company from './data/company.json';
import overview from './data/overview.json';

const DAY_MS = 86400000;

/* ---------- tiny DOM helper ---------- */

export function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  Object.entries(props).forEach(([k, v]) => {
    if (v === undefined || v === null || v === false) return;
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2).toLowerCase(), v);
    else node[k] = v;
  });
  children.flat().forEach(c => {
    if (c !== undefined && c !== null && c !== false) node.append(c);
  });
  return node;
}

const link = (text, url) =>
  url ? h('a', { href: url, target: '_blank', rel: 'noopener', textContent: text }) : h('span', { textContent: text });

const badge = (text, cls = '') => h('span', { class: `badge ${cls}`.trim(), textContent: text });

const daysBetween = (fromDay, toDay) => Math.round((parseDay(toDay) - parseDay(fromDay)) / DAY_MS);

const dueLabel = daysUntil =>
  daysUntil === null || daysUntil === undefined
    ? ''
    : daysUntil < 0
    ? `overdue ${-daysUntil}d`
    : daysUntil === 0
    ? 'due today'
    : `in ${daysUntil}d`;

const table = (headers, bodyRows) =>
  h(
    'div',
    { class: 'tablewrap' },
    h(
      'table',
      {},
      h('thead', {}, h('tr', {}, headers.map(t => h('th', { textContent: t })))),
      h('tbody', {}, bodyRows)
    )
  );

const emptyCard = text => h('div', { class: 'card empty', textContent: text });

/* ---------- Today ---------- */

const labelled = (text, control, suffix) =>
  h('label', { class: 'row muted' }, text, control, suffix ? ` ${suffix}` : null);

function settingsPanel(ctx) {
  const { settings, onSettings } = ctx;
  const number = (value, min, max, step, key) =>
    h('input', {
      type: 'number',
      min,
      max,
      step,
      value,
      style: 'width:70px',
      onchange: e => onSettings(key, Number(e.target.value)),
    });
  const position = h(
    'select',
    { onchange: e => onSettings('tracker_focus_override', e.target.value) },
    h('option', { value: '', textContent: 'Auto (by progress)' }),
    plan.map(p => h('option', { value: String(p.week), textContent: `Week ${p.week} · ${p.phase}` }))
  );
  position.value = String(settings.focusOverride || '');

  return h(
    'details',
    { class: 'card', style: 'margin-top:20px' },
    h('summary', { textContent: 'Plan & session settings' }),
    h(
      'div',
      { class: 'row', style: 'margin-top:10px;gap:18px' },
      labelled('Problems per day', number(settings.sessionSize, 1, 30, 1, 'tracker_session_size')),
      labelled('Move to the next week at', number(settings.advancePct, 10, 100, 5, 'tracker_advance_pct'), '% solved'),
      labelled('Plan position', position)
    ),
    h('p', {
      class: 'muted',
      textContent:
        'Your plan position follows what you have solved, not the calendar, so falling behind never skips material. The daily new/review split follows the workbook’s weekly mix (Week 1 is all new); overdue reviews always get at least one slot.',
    })
  );
}

export function todayView(ctx) {
  const { rows, today, planStart, keyOf, settings, focusPattern, onFocusPattern } = ctx;

  const groups = groupByProblem(rows, keyOf);
  const stats = overallStats(groups);
  const due = reviewSchedule(rows, ctx.problems).filter(r => r.next <= today);

  // Where you are in the plan (by progress) and what to do today.
  const weeks = planProgress(planProblems, groups, keyOf);
  const focus = focusWeek(weeks, settings.advancePct / 100, settings.focusOverride);
  const focusData = weeks.find(w => w.week === focus);
  const focusPlan = plan.find(p => p.week === focus);
  const mix = guide.mix.find(m => m.week === (focus || plan[plan.length - 1].week));
  const { reviews: nReviews, news: nNew } = sessionMix(settings.sessionSize, mix ? parsePct(mix.review) : 0.5, due.length);
  const reviewsToday = due.slice(0, nReviews);
  const backlog = due.slice(nReviews);
  const queue = nextNew(weeks, focus, nNew + 6, focusPattern);
  const newToday = queue.slice(0, nNew);
  const upNext = queue.slice(nNew);

  // Pace vs the calendar (informational only).
  const calWeek = weekOf(today, planStart);
  const behind = calWeek && focus ? calWeek - focus : null;
  const cal = calWeek ? weekProgress(groups, calWeek, planStart) : null;

  const reviewItem = r =>
    h(
      'li',
      {},
      h('span', { class: 'grow' }, link(r.lc ? `${r.lc}. ${r.name}` : r.name, r.url)),
      badge(`box ${r.box}`),
      h('span', { class: 'muted', textContent: dueLabel(daysBetween(today, r.next)) })
    );

  const newItem = i =>
    h(
      'li',
      {},
      h('span', { class: 'grow' }, link(i.problem.name, i.problem.url)),
      badge(i.problem.difficulty, i.problem.difficulty),
      h('span', { class: 'muted', textContent: i.week === focus ? i.problem.pattern : `${i.problem.pattern} · week ${i.week}` })
    );

  const bars = (counts, order) => {
    const entries = order
      ? order.map(k => [k, counts[k] || 0])
      : Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const max = Math.max(1, ...entries.map(e => e[1]));
    if (entries.every(e => e[1] === 0)) {
      return h('div', { class: 'muted', textContent: 'No solved problems yet (only Solved attempts count).' });
    }
    return entries.map(([k, n]) =>
      h(
        'div',
        { class: `bar ${k}` },
        h('span', { textContent: k }),
        h('div', {}, h('i', { style: `width:${(n / max) * 100}%` })),
        h('span', { textContent: n })
      )
    );
  };

  const stat = (value, label, extra, compact = false) =>
    h('div', { class: `card stat${compact ? ' compact' : ''}` }, h('b', { textContent: value }), h('span', { textContent: label }), extra || null);

  const paceText =
    behind === null
      ? ''
      : behind > 0
      ? `calendar week ${calWeek}: ${behind} week${behind === 1 ? '' : 's'} behind`
      : behind < 0
      ? `calendar week ${calWeek}: ${-behind} week${behind === -1 ? '' : 's'} ahead`
      : `calendar week ${calWeek}: on pace`;

  const chips = focusData
    ? h(
        'div',
        { class: 'chips' },
        patternProgress(focusData).map(pp => {
          const active = focusPattern === pp.pattern;
          return h('button', {
            class: `chip${active ? ' active' : ''}`,
            textContent: `${pp.pattern} ${pp.solved}/${pp.total}`,
            title: active ? 'Click to stop prioritising this pattern' : 'Start new problems from this pattern first',
            onclick: () => onFocusPattern(active ? '' : pp.pattern),
          });
        })
      )
    : null;

  return h(
    'div',
    {},
    h(
      'div',
      { class: 'cards' },
      stat(stats.solved, 'problems solved'),
      stat(stats.attempts, 'attempts logged'),
      stat(due.length, 'due for review'),
      stat(
        focus ? `Week ${focus}` : 'Plan complete',
        focusPlan && focusData ? `${focusPlan.phase} · ${focusData.solved}/${focusData.total} solved` : 'plan position',
        paceText ? h('span', { class: 'pace', textContent: paceText }) : null
      ),
      cal ? stat(`${cal.newCount} new · ${cal.reviewCount} review`, `this calendar week (week ${calWeek})`, null, true) : null
    ),

    h('h2', { textContent: `Today’s session (${nNew + nReviews})` }),
    rows.length === 0
      ? h('p', { class: 'muted', textContent: 'Nothing logged yet. Start with the new problems below; use the tracker widget on LeetCode to log them.' })
      : null,
    h(
      'div',
      { class: 'cols' },
      h(
        'div',
        {},
        h('h3', { textContent: `New (${newToday.length})` }),
        chips,
        newToday.length
          ? h('div', { class: 'card' }, h('ul', { class: 'queue' }, newToday.map(newItem)))
          : emptyCard('Every problem in the plan is solved 🎉')
      ),
      h(
        'div',
        {},
        h('h3', { textContent: `Review (${reviewsToday.length})` }),
        reviewsToday.length
          ? h('div', { class: 'card' }, h('ul', { class: 'queue' }, reviewsToday.map(reviewItem)))
          : emptyCard('Nothing due 🎉')
      )
    ),

    upNext.length
      ? [
          h('h2', { textContent: `Up next (${upNext.length})` }),
          h('div', { class: 'card' }, h('ul', { class: 'queue' }, upNext.map(newItem))),
        ]
      : null,

    backlog.length
      ? [
          h('h2', { textContent: `Review backlog (${backlog.length})` }),
          h('div', { class: 'card' }, h('ul', { class: 'queue' }, backlog.map(reviewItem))),
        ]
      : null,

    h(
      'div',
      { class: 'cols' },
      h('div', {}, h('h2', { textContent: 'By difficulty' }), h('div', { class: 'card' }, bars(stats.byDifficulty, ['Easy', 'Medium', 'Hard']))),
      h('div', {}, h('h2', { textContent: 'By pattern' }), h('div', { class: 'card' }, bars(stats.byPattern)))
    ),

    settingsPanel(ctx)
  );
}

/* ---------- Attempts ---------- */

const NUMERIC = new Set(['lc', 'approachMin', 'totalMin', 'quality', 'box', 'interval', 'daysUntil']);

const ATTEMPT_COLUMNS = [
  { id: 'date', label: 'Date' },
  { id: 'lc', label: 'LC #' },
  { id: 'name', label: 'Problem' },
  { id: 'pattern', label: 'Pattern' },
  { id: 'difficulty', label: 'Difficulty' },
  { id: 'source', label: 'Source' },
  { id: 'attemptType', label: 'Attempt' },
  { id: 'approachMin', label: '1st approach (min)' },
  { id: 'totalMin', label: 'Total (min)' },
  { id: 'hint', label: 'Hint?' },
  { id: 'status', label: 'Status' },
  { id: 'quality', label: 'Quality' },
  { id: 'box', label: 'Box' },
  { id: 'interval', label: 'Interval (d)' },
  { id: 'next', label: 'Next review' },
  { id: 'daysUntil', label: 'Days until due' },
  { id: 'flag', label: 'Review due?' },
];

const cellValue = (a, id) => (id in a ? a[id] : a.row[id]);

function attemptCell(a, id) {
  const v = cellValue(a, id);
  switch (id) {
    case 'name':
      return h('td', {}, link(v, a.row.url));
    case 'difficulty':
    case 'status':
      return h('td', {}, v ? badge(v, v) : '');
    case 'daysUntil':
      return h('td', { class: 'nowrap', textContent: a.live ? dueLabel(v) : '' });
    case 'flag':
      return h('td', {}, a.flag === 'DUE' ? badge('DUE', 'DUE') : a.flag === 'superseded' ? badge('superseded', 'superseded') : a.flag ? badge('-', 'ok') : '');
    case 'interval':
    case 'next':
      return h('td', { class: 'nowrap', textContent: a.live && v ? v : '' });
    default:
      return h('td', { class: id === 'date' ? 'nowrap' : '', textContent: v === null || v === undefined ? '' : v });
  }
}

const compare = (a, b, id) => {
  const x = cellValue(a, id);
  const y = cellValue(b, id);
  if (NUMERIC.has(id)) {
    const nx = x === null || x === '' || x === undefined ? -Infinity : Number(x);
    const ny = y === null || y === '' || y === undefined ? -Infinity : Number(y);
    return nx - ny;
  }
  return String(x || '').localeCompare(String(y || ''));
};

export function attemptsView(ctx) {
  const { rows, today, problems, filters, sort, onEdit, onImportFile } = ctx;
  const annotated = annotateAttempts(rows, today, problems);

  const tbody = h('tbody');
  const count = h('span', { class: 'muted' });
  const thead = h('tr');

  const visible = () => {
    const q = filters.q.trim().toLowerCase();
    const list = annotated.filter(a => {
      const r = a.row;
      if (filters.pattern && r.pattern !== filters.pattern) return false;
      if (filters.status && r.status !== filters.status) return false;
      if (filters.dueOnly && a.flag !== 'DUE') return false;
      if (q && ![r.name, r.pattern, r.notes, r.bugs, r.companies].some(t => (t || '').toLowerCase().includes(q))) return false;
      return true;
    });
    list.sort((a, b) => (sort.dir === 'asc' ? 1 : -1) * (compare(a, b, sort.id) || rows.indexOf(a.row) - rows.indexOf(b.row)));
    return list;
  };

  const renderBody = () => {
    const list = visible();
    tbody.replaceChildren(
      ...list.map(a =>
        h(
          'tr',
          { class: `clickable ${a.live ? '' : 'superseded'}`.trim(), onclick: e => e.target.tagName !== 'A' && onEdit(rows.indexOf(a.row)) },
          ATTEMPT_COLUMNS.map(c => attemptCell(a, c.id))
        )
      )
    );
    count.textContent = `${list.length} of ${annotated.length} attempts`;
  };

  const renderHead = () => {
    thead.replaceChildren(
      ...ATTEMPT_COLUMNS.map(c =>
        h('th', {
          class: 'sortable',
          textContent: c.label + (sort.id === c.id ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''),
          onclick: () => {
            sort.dir = sort.id === c.id && sort.dir === 'desc' ? 'asc' : 'desc';
            sort.id = c.id;
            renderHead();
            renderBody();
          },
        })
      )
    );
  };

  const bind = (props, key, event = 'oninput') => ({
    ...props,
    [event]: e => {
      filters[key] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
      renderBody();
    },
  });

  const option = (value, text) => h('option', { value, textContent: text });
  const filterSelect = (key, allLabel, values) => {
    const sel = h('select', bind({}, key, 'onchange'), option('', allLabel), values.map(v => option(v, v)));
    sel.value = filters[key]; // after the options exist
    return sel;
  };
  const fileInput = h('input', {
    type: 'file',
    accept: '.csv,text/csv',
    hidden: true,
    onchange: e => e.target.files[0] && onImportFile(e.target.files[0]),
  });

  renderHead();
  renderBody();

  return h(
    'div',
    {},
    ctx.importPreview ? importPanel(ctx) : null,
    h(
      'div',
      { class: 'row', style: 'margin-bottom:10px' },
      h('input', bind({ type: 'search', placeholder: 'Search…', value: filters.q }, 'q')),
      filterSelect('pattern', 'All patterns', OPTIONS.pattern),
      filterSelect('status', 'All statuses', OPTIONS.status),
      h('label', {}, h('input', bind({ type: 'checkbox', checked: filters.dueOnly }, 'dueOnly', 'onchange')), ' Due only'),
      count,
      h('span', { class: 'grow', style: 'flex:1' }),
      h('button', { textContent: 'Import CSV…', title: 'Import your workbook\'s Problem Tracker export', onclick: () => fileInput.click() }),
      fileInput
    ),
    rows.length === 0
      ? emptyCard('No attempts yet.')
      : h('div', { class: 'tablewrap' }, h('table', {}, h('thead', {}, thead), tbody)),
    h('p', {
      class: 'muted',
      textContent:
        'Review dates follow the workbook’s formulas, but only a problem’s latest attempt is live; older attempts show as superseded instead of staying due forever.',
    })
  );
}

function importPanel(ctx) {
  const { importPreview: p, onImportConfirm, onImportCancel } = ctx;
  const { rows, skipped } = p;
  return h(
    'div',
    { class: 'card', style: 'margin-bottom:12px' },
    h('b', { textContent: `Import ${rows.length} attempt${rows.length === 1 ? '' : 's'}?` }),
    h('p', {
      class: 'muted',
      textContent: `Skipping ${skipped.duplicate} duplicate${skipped.duplicate === 1 ? '' : 's'} and ${skipped.blank} row${skipped.blank === 1 ? '' : 's'} without a name or a usable date. This creates one commit in your repo.`,
    }),
    h(
      'div',
      { class: 'row' },
      h('button', { class: 'primary', textContent: 'Import', disabled: rows.length === 0, onclick: onImportConfirm }),
      h('button', { textContent: 'Cancel', onclick: onImportCancel })
    )
  );
}

/* ---------- Plan ---------- */

export function planView(ctx) {
  const { rows, today, planStart, keyOf, settings } = ctx;
  const groups = groupByProblem(rows, keyOf);
  const weeks = planProgress(planProblems, groups, keyOf);
  const focus = focusWeek(weeks, settings.advancePct / 100, settings.focusOverride);
  const calWeek = weekOf(today, planStart);
  const progressOf = week => weeks.find(w => w.week === week);
  const scheduleByKey = new Map(reviewSchedule(rows, ctx.problems).map(s => [s.key, s]));

  const weekRows = plan.map(p => {
    const prog = progressOf(p.week);
    const hasList = prog && prog.total > 0;
    return h(
      'tr',
      { class: p.week === focus ? 'week-now' : '' },
      h(
        'td',
        { class: 'nowrap' },
        String(p.week),
        p.week === focus ? [' ', badge('you are here', 'ok')] : null,
        p.week === calWeek && p.week !== focus ? [' ', badge('calendar', 'superseded')] : null
      ),
      h('td', { textContent: p.phase }),
      h('td', { textContent: p.patterns }),
      h('td', { class: 'nowrap', textContent: hasList ? `${prog.solved} / ${prog.total} solved` : `target ${p.newTarget}` }),
      h('td', { class: 'nowrap', textContent: `target ${p.reviewTarget}` }),
      h('td', { textContent: p.hours }),
      h('td', { textContent: p.notes })
    );
  });

  const weekSections = weeks
    .filter(w => w.total > 0)
    .map(w => {
      const items = w.items.map(({ problem: pr, solved }) => {
        const key = keyOf({ name: pr.name, url: pr.url, lc: '' });
        const sched = scheduleByKey.get(key);
        const overdue = sched && sched.next <= today;
        return h(
          'li',
          {},
          h('span', { class: 'tick', textContent: solved ? '✓' : '' }),
          h('span', { class: 'grow' }, link(pr.name, pr.url)),
          badge(pr.difficulty, pr.difficulty),
          h('span', { class: 'muted', textContent: pr.pattern }),
          sched ? badge(overdue ? 'DUE' : `next ${sched.next}`, overdue ? 'DUE' : '') : null
        );
      });
      return h(
        'details',
        { class: 'week', open: w.week === focus },
        h('summary', { textContent: `Week ${w.week} · ${w.solved} / ${w.total} solved` }),
        h('ul', {}, items)
      );
    });

  return h(
    'div',
    {},
    h('h2', { textContent: '8-week plan' }),
    table(['Week', 'Phase', 'Patterns', 'New problems', 'Reviews', 'Hours', 'Focus'], weekRows),
    h('p', {
      class: 'muted',
      textContent:
        '“You are here” follows your progress, not the calendar: it is the first week with less than the threshold solved (see Today → settings).',
    }),
    h('h2', { textContent: 'Problems by week' }),
    weekSections
  );
}

/* ---------- Problems (flat list, like the workbook's "Problem List (by Week)") ---------- */

const PROBLEM_STATUSES = ['Solved', 'Attempted', 'Not started'];

export function problemsView(ctx) {
  const { rows, today, keyOf, problemFilters: filters } = ctx;
  const groups = groupByProblem(rows, keyOf);
  const scheduleByKey = new Map(reviewSchedule(rows, ctx.problems).map(s => [s.key, s]));

  const items = planProblems
    .filter(p => p.url)
    .map(problem => {
      const key = keyOf({ name: problem.name, url: problem.url, lc: '' });
      const g = groups.get(key);
      return {
        problem,
        group: g,
        status: !g ? 'Not started' : g.everSolved ? 'Solved' : 'Attempted',
        sched: scheduleByKey.get(key),
      };
    });

  const tbody = h('tbody');
  const count = h('span', { class: 'muted' });

  const renderBody = () => {
    const q = filters.q.trim().toLowerCase();
    const list = items.filter(i => {
      const pr = i.problem;
      if (filters.week && String(pr.week) !== filters.week) return false;
      if (filters.pattern && pr.pattern !== filters.pattern) return false;
      if (filters.status && i.status !== filters.status) return false;
      if (q && ![pr.name, pr.pattern, pr.notes].some(t => (t || '').toLowerCase().includes(q))) return false;
      return true;
    });
    tbody.replaceChildren(
      ...list.map(i => {
        const pr = i.problem;
        const overdue = i.sched && i.sched.next <= today;
        return h(
          'tr',
          {},
          h('td', { textContent: pr.week }),
          h('td', { textContent: pr.pattern }),
          h('td', {}, link(pr.name, pr.url)),
          h('td', {}, badge(pr.difficulty, pr.difficulty)),
          h('td', { class: 'nowrap' }, link('Open →', pr.url)),
          h(
            'td',
            {},
            i.status === 'Solved'
              ? badge('Solved', 'Solved')
              : i.status === 'Attempted'
              ? badge(i.group.latest.status || 'Attempted', i.group.latest.status)
              : h('span', { class: 'muted', textContent: '—' })
          ),
          h('td', { textContent: i.group ? i.group.rows.length : '' }),
          h(
            'td',
            { class: 'nowrap' },
            i.sched ? (overdue ? badge('DUE', 'DUE') : h('span', { textContent: i.sched.next })) : ''
          ),
          h('td', { textContent: pr.notes })
        );
      })
    );
    const solved = items.filter(i => i.status === 'Solved').length;
    count.textContent = `${list.length} of ${items.length} shown · ${solved} solved`;
  };

  const bind = key => ({
    oninput: e => {
      filters[key] = e.target.value;
      renderBody();
    },
  });
  const select = (key, allLabel, values) => {
    const sel = h(
      'select',
      { onchange: bind(key).oninput },
      h('option', { value: '', textContent: allLabel }),
      values.map(v => h('option', { value: String(v), textContent: typeof v === 'number' ? `Week ${v}` : v }))
    );
    sel.value = filters[key];
    return sel;
  };
  const weeks = [...new Set(items.map(i => i.problem.week))];
  const patterns = [...new Set(items.map(i => i.problem.pattern))];

  renderBody();
  return h(
    'div',
    {},
    h(
      'div',
      { class: 'row', style: 'margin-bottom:10px' },
      h('input', { type: 'search', placeholder: 'Search…', value: filters.q, oninput: bind('q').oninput }),
      select('week', 'All weeks', weeks),
      select('pattern', 'All patterns', patterns),
      select('status', 'All statuses', PROBLEM_STATUSES),
      count
    ),
    h(
      'div',
      { class: 'tablewrap' },
      h(
        'table',
        {},
        h('thead', {}, h('tr', {}, ['Week', 'Pattern', 'Problem', 'Difficulty', 'LeetCode link', 'Status', 'Attempts', 'Next review', 'Notes'].map(t => h('th', { textContent: t })))),
        tbody
      )
    ),
    h('p', {
      class: 'muted',
      textContent: 'The plan’s problem list by week. Status comes from your logged attempts; Next review is when it is due again.',
    })
  );
}

/* ---------- Reference ---------- */

export function referenceView() {
  return h(
    'div',
    {},
    h('h2', { textContent: overview.title }),
    h('p', { class: 'muted', textContent: overview.subtitle }),
    h('div', { class: 'card' }, overview.rules.map(r => h('p', {}, h('b', { textContent: `${r.label}. ` }), r.text))),

    h('h2', { textContent: 'Pattern cheatsheet' }),
    table(
      ['Pattern', 'Framework', 'Signal / when to reach for it', 'Backup explainer'],
      cheatsheet.map(c =>
        h('tr', {}, h('td', { textContent: c.pattern }), h('td', { textContent: c.framework }), h('td', { textContent: c.signal }), h('td', { textContent: c.backup }))
      )
    ),

    h('h2', { textContent: 'Spaced repetition (Leitner boxes)' }),
    table(
      ['Box', 'Meaning', 'Days until next review'],
      guide.leitner.map(l => h('tr', {}, h('td', { textContent: l.box }), h('td', { textContent: l.meaning }), h('td', { textContent: INTERVAL_DAYS[l.box] ?? l.days })))
    ),
    h('p', { class: 'muted' }, guide.rule, ' ', link('Leitner system on Wikipedia ↗', 'https://en.wikipedia.org/wiki/Leitner_system')),

    h('h2', { textContent: 'New vs. review mix by week' }),
    table(
      ['Week', '% new', '% review', '% new from company repo', 'Rationale'],
      guide.mix.map(m =>
        h('tr', {}, h('td', { textContent: m.week }), h('td', { textContent: m.new }), h('td', { textContent: m.review }), h('td', { textContent: m.company }), h('td', { textContent: m.rationale }))
      )
    ),

    h('h2', { textContent: company.title }),
    h('p', { class: 'muted', textContent: company.intro }),
    table(
      ['When to use', 'How', 'Which companies', 'Time budget'],
      company.rows.map(c => h('tr', {}, h('td', { textContent: c.when }), h('td', { textContent: c.how }), h('td', { textContent: c.companies }), h('td', { textContent: c.budget })))
    )
  );
}

/* ---------- Edit dialog ---------- */

// key -> [options, allowBlank]
const SELECTS = {
  pattern: [OPTIONS.pattern, true],
  difficulty: [OPTIONS.difficulty, true],
  source: [OPTIONS.source, false],
  attemptType: [OPTIONS.attemptType, false],
  hint: [OPTIONS.yesNo, false],
  status: [OPTIONS.status, false],
  quality: [OPTIONS.oneToFive, true],
  optimal: [OPTIONS.yesNo, true],
  box: [OPTIONS.oneToFive, false],
};
const TEXTAREAS = new Set(['notes', 'bugs']);

function control(key, value) {
  if (SELECTS[key]) {
    const [options, blank] = SELECTS[key];
    // Keep values that aren't in the vocabulary (e.g. imported typos) instead of silently dropping them.
    const all = value && !options.includes(value) ? [...options, value] : options;
    const s = h('select', {}, blank ? h('option', { value: '', textContent: '—' }) : null, all.map(o => h('option', { value: o, textContent: o })));
    s.value = value || (blank ? '' : options[0]);
    return s;
  }
  if (TEXTAREAS.has(key)) return h('textarea', { value: value || '' });
  return h('input', { type: 'text', value: value || '' });
}

/** Content for the edit dialog. onSave(newRow) / onDelete() return promises; errors are shown inline. */
export function editDialog(row, { onSave, onDelete, onClose }) {
  const controls = {};
  const status = h('div', { class: 'muted', style: 'min-height:1.2em;margin-top:8px' });
  const save = h('button', { class: 'primary', textContent: 'Save' });
  const del = h('button', { class: 'danger left', textContent: 'Delete' });
  const cancel = h('button', { textContent: 'Cancel', onclick: onClose });

  const grid = h(
    'div',
    { class: 'formgrid' },
    COLUMNS.map(c => {
      controls[c.key] = control(c.key, row[c.key]);
      return h('div', { class: TEXTAREAS.has(c.key) || c.key === 'name' || c.key === 'url' ? 'full' : '' }, h('label', { textContent: c.header }), controls[c.key]);
    })
  );

  const run = async fn => {
    [save, del, cancel].forEach(b => (b.disabled = true));
    status.textContent = 'Saving to GitHub…';
    try {
      await fn();
    } catch (err) {
      status.textContent = `Failed: ${err.message}${err.detail ? ` (${err.detail})` : ''}`;
      [save, del, cancel].forEach(b => (b.disabled = false));
    }
  };

  save.addEventListener('click', () =>
    run(() => onSave(Object.fromEntries(COLUMNS.map(c => [c.key, controls[c.key].value.trim()]))))
  );
  let armed = false;
  del.addEventListener('click', () => {
    if (!armed) {
      armed = true;
      del.textContent = 'Click again to delete';
      return;
    }
    run(onDelete);
  });

  return [h('h3', { textContent: 'Edit attempt' }), grid, status, h('div', { class: 'actions' }, del, cancel, save)];
}
