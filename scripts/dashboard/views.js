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
  splitQueue,
  weekOf,
  parseDay,
} from '../leetcode/trackerCsv';
import { groupByProblem, overallStats, weekProgress, targetNumber } from './stats';
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

export function todayView(ctx) {
  const { rows, today, planStart, dailyLimit, keyOf } = ctx;
  if (rows.length === 0) {
    return h(
      'div',
      {},
      emptyCard(
        'No attempts logged yet. Solve a problem with the tracker widget on LeetCode, or import your workbook history from the Attempts tab.'
      )
    );
  }

  const groups = groupByProblem(rows, keyOf);
  const stats = overallStats(groups);
  const due = reviewSchedule(rows, ctx.problems).filter(r => r.next <= today);
  const { today: doToday, backlog } = splitQueue(due, dailyLimit);
  const week = weekOf(today, planStart);
  const weekPlan = plan.find(p => p.week === week);
  const progress = week ? weekProgress(groups, week, planStart) : null;

  const queueItem = r =>
    h(
      'li',
      {},
      h('span', { class: 'grow' }, link(r.lc ? `${r.lc}. ${r.name}` : r.name, r.url)),
      badge(`box ${r.box}`),
      h('span', { class: 'muted', textContent: dueLabel(daysBetween(today, r.next)) })
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

  const target = (label, done, planned) =>
    h(
      'div',
      { class: 'stat' },
      h('b', { textContent: `${done}${planned === null || planned === undefined ? '' : ` / ${planned}`}` }),
      h('span', { textContent: label })
    );

  return h(
    'div',
    {},
    h(
      'div',
      { class: 'cards' },
      h('div', { class: 'card stat' }, h('b', { textContent: stats.solved }), h('span', { textContent: 'problems solved' })),
      h('div', { class: 'card stat' }, h('b', { textContent: stats.attempts }), h('span', { textContent: 'attempts logged' })),
      h('div', { class: 'card stat' }, h('b', { textContent: due.length }), h('span', { textContent: 'due for review' })),
      h(
        'div',
        { class: 'card' },
        progress
          ? h(
              'div',
              { class: 'row' },
              target(`new · week ${week}`, progress.newCount, weekPlan ? targetNumber(weekPlan.newTarget) : null),
              target('reviews', progress.reviewCount, weekPlan ? targetNumber(weekPlan.reviewTarget) : null)
            )
          : h('div', { class: 'muted', textContent: 'Set a plan start date (top right) to track weekly targets.' })
      )
    ),

    h('h2', { textContent: `Do today (${doToday.length})` }),
    doToday.length
      ? h('div', { class: 'card' }, h('ul', { class: 'queue' }, doToday.map(queueItem)))
      : emptyCard('Nothing due 🎉'),

    backlog.length
      ? [
          h('h2', { textContent: `Backlog (${backlog.length})` }),
          h('div', { class: 'card' }, h('ul', { class: 'queue' }, backlog.map(queueItem))),
        ]
      : null,

    h(
      'div',
      { class: 'cols' },
      h('div', {}, h('h2', { textContent: 'By difficulty' }), h('div', { class: 'card' }, bars(stats.byDifficulty, ['Easy', 'Medium', 'Hard']))),
      h('div', {}, h('h2', { textContent: 'By pattern' }), h('div', { class: 'card' }, bars(stats.byPattern)))
    )
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
  const { rows, today, planStart, keyOf } = ctx;
  const groups = groupByProblem(rows, keyOf);
  const currentWeek = weekOf(today, planStart);

  const scheduleByKey = new Map(reviewSchedule(rows, ctx.problems).map(s => [s.key, s]));

  const weekRows = plan.map(p => {
    const prog = planStart ? weekProgress(groups, p.week, planStart) : null;
    return h(
      'tr',
      { class: p.week === currentWeek ? 'week-now' : '' },
      h('td', { textContent: p.week }),
      h('td', { textContent: p.phase }),
      h('td', { textContent: p.patterns }),
      h('td', { class: 'nowrap', textContent: prog ? `${prog.newCount} / ${p.newTarget}` : p.newTarget }),
      h('td', { class: 'nowrap', textContent: prog ? `${prog.reviewCount} / ${p.reviewTarget}` : p.reviewTarget }),
      h('td', { textContent: p.hours }),
      h('td', { textContent: p.notes })
    );
  });

  const problemsByWeek = new Map();
  planProblems.forEach(pr => {
    if (!problemsByWeek.has(pr.week)) problemsByWeek.set(pr.week, []);
    problemsByWeek.get(pr.week).push(pr);
  });

  const weekSections = [...problemsByWeek.entries()].map(([week, list]) => {
    const named = list.filter(pr => pr.url);
    const solved = named.filter(pr => {
      const g = groups.get(keyOf({ name: pr.name, url: pr.url, lc: '' }));
      return g && g.everSolved;
    }).length;

    const items = list.map(pr => {
      if (!pr.url) return h('li', {}, h('span', { class: 'muted', textContent: pr.name }));
      const key = keyOf({ name: pr.name, url: pr.url, lc: '' });
      const g = groups.get(key);
      const sched = scheduleByKey.get(key);
      const overdue = sched && sched.next <= today;
      return h(
        'li',
        {},
        h('span', { class: 'tick', textContent: g && g.everSolved ? '✓' : '' }),
        h('span', { class: 'grow' }, link(pr.name, pr.url)),
        badge(pr.difficulty, pr.difficulty),
        h('span', { class: 'muted', textContent: pr.pattern }),
        sched ? badge(overdue ? 'DUE' : `next ${sched.next}`, overdue ? 'DUE' : '') : null
      );
    });

    return h(
      'details',
      { class: 'week', open: week === currentWeek },
      h('summary', { textContent: `Week ${week} · ${solved} / ${named.length} solved` }),
      h('ul', {}, items)
    );
  });

  return h(
    'div',
    {},
    h('h2', { textContent: '8-week plan' }),
    table(['Week', 'Phase', 'Patterns', 'New (done / target)', 'Reviews (done / target)', 'Hours', 'Focus'], weekRows),
    !planStart ? h('p', { class: 'muted', textContent: 'Set a plan start date (top right) to see weekly progress.' }) : null,
    h('h2', { textContent: 'Problems by week' }),
    weekSections
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
    h('p', { class: 'muted', textContent: guide.rule }),

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
