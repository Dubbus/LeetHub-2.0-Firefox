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
