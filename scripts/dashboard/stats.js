/*
 * Pure numbers for the dashboard (no DOM, no storage). Rows are objects from trackerCsv.parseRows;
 * `keyOf` comes from trackerCsv.makeKeyer so all attempts of a problem group together.
 */
import { weekOf } from '../leetcode/trackerCsv';

/** Map problemKey -> { key, rows (file order), first (earliest date), everSolved, latest (live attempt) } */
export function groupByProblem(rows, keyOf) {
  const groups = new Map();
  rows.forEach(row => {
    const key = keyOf(row);
    if (!key || key === 'name:') return;
    let g = groups.get(key);
    if (!g) {
      g = { key, rows: [], first: row.date, everSolved: false, latest: row };
      groups.set(key, g);
    }
    g.rows.push(row);
    if (row.date < g.first) g.first = row.date;
    if (row.date >= g.latest.date) g.latest = row; // later row wins ties, like the schedule
    if (row.status === 'Solved') g.everSolved = true;
  });
  return groups;
}

const count = (items, pick) =>
  items.reduce((acc, item) => {
    const k = pick(item) || 'Unspecified';
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});

/** Overall counts. A problem is "solved" once any attempt of it was Solved. */
export function overallStats(groups) {
  const solved = [...groups.values()].filter(g => g.everSolved);
  return {
    problems: groups.size,
    solved: solved.length,
    attempts: [...groups.values()].reduce((n, g) => n + g.rows.length, 0),
    byDifficulty: count(solved, g => g.latest.difficulty),
    byPattern: count(solved, g => g.latest.pattern),
  };
}

/**
 * Attempts in plan week `week`: "new" = a problem's first attempt, "review" = any later attempt.
 * `planStart` is 'YYYY-MM-DD'.
 */
export function weekProgress(groups, week, planStart) {
  let newCount = 0;
  let reviewCount = 0;
  groups.forEach(g => {
    const ordered = [...g.rows].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    ordered.forEach((row, i) => {
      if (weekOf(row.date, planStart) !== week) return;
      if (i === 0) newCount++;
      else reviewCount++;
    });
  });
  return { newCount, reviewCount };
}

/** "23" -> 23, "~3" -> 3, "0" -> 0, "" -> null */
export const targetNumber = s => {
  const m = /\d+/.exec(String(s || ''));
  return m ? Number(m[0]) : null;
};

export function earliestDate(rows) {
  return rows.reduce((min, r) => (r.date && (!min || r.date < min) ? r.date : min), '');
}

/* ---------- plan position & new-problem queue ---------- */

/** "85%" -> 0.85, "~15%" -> 0.15, "" -> 0 */
export const parsePct = s => {
  const m = /\d+/.exec(String(s || ''));
  return m ? Number(m[0]) / 100 : 0;
};

/**
 * Progress per plan week, from the plan's problem list rather than from dates:
 * [{ week, total, solved, ratio, items: [{ problem, solved, group }] }] in week order.
 * Only problems with a link count (some plan entries are free-text notes). A week with none has ratio 1.
 */
export function planProgress(problems, groups, keyOf) {
  const byWeek = new Map();
  problems.forEach(problem => {
    if (!byWeek.has(problem.week)) byWeek.set(problem.week, []);
    if (!problem.url) return;
    const group = groups.get(keyOf({ name: problem.name, url: problem.url, lc: '' })) || null;
    byWeek.get(problem.week).push({ problem, solved: Boolean(group && group.everSolved), group });
  });
  return [...byWeek.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([week, items]) => {
      const solved = items.filter(i => i.solved).length;
      return { week, items, total: items.length, solved, ratio: items.length ? solved / items.length : 1 };
    });
}

/**
 * The plan week you're working on: the first week with less than `threshold` (0-1) of its problems
 * solved, so being behind never skips material. `override` (a week number) wins. null = plan complete.
 */
export function focusWeek(weeks, threshold, override) {
  if (override) return Number(override);
  const w = weeks.find(week => week.ratio < threshold);
  return w ? w.week : null;
}

/** Pattern-level progress inside one plan week, in list order: [{ pattern, solved, total }] */
export function patternProgress(week) {
  const out = new Map();
  ((week && week.items) || []).forEach(({ problem, solved }) => {
    const p = out.get(problem.pattern) || { pattern: problem.pattern, solved: 0, total: 0 };
    p.total++;
    if (solved) p.solved++;
    out.set(problem.pattern, p);
  });
  return [...out.values()];
}

/**
 * The next problems you haven't started: the focus week first (optionally `focusPattern` first within it),
 * then leftovers from earlier weeks (catch-up), then later weeks (pull ahead). Items get a `week` field.
 */
export function nextNew(weeks, focus, count, focusPattern = '') {
  // Problems you've already attempted (even unsolved) come back through review, not as "new".
  const unsolved = w => w.items.filter(i => !i.solved && !i.group).map(i => ({ ...i, week: w.week }));
  const current = weeks.find(w => w.week === focus);
  let head = current ? unsolved(current) : [];
  if (focusPattern) {
    head = [
      ...head.filter(i => i.problem.pattern === focusPattern),
      ...head.filter(i => i.problem.pattern !== focusPattern),
    ];
  }
  const earlier = weeks.filter(w => focus && w.week < focus).flatMap(unsolved);
  const later = weeks.filter(w => !focus || w.week > focus).flatMap(unsolved);
  return [...head, ...earlier, ...later].slice(0, count);
}

/**
 * Splits a daily session between reviews and new problems using the plan week's review share
 * (from the workbook's weighting guide). Overdue reviews always get at least one slot so they never
 * starve, but reviews can't take over: everything else is new.
 */
export function sessionMix(size, reviewShare, dueCount) {
  if (dueCount === 0 || size <= 0) return { reviews: 0, news: Math.max(0, size) };
  const reviews = Math.min(dueCount, size, Math.max(1, Math.round(size * reviewShare)));
  return { reviews, news: size - reviews };
}
