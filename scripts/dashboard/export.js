/*
 * Plain-text progress report for pasting into an LLM ("grade my prep, what should I do next?").
 * Pure: takes the dashboard ctx, returns a string. Dense key: value lines rather than tables, since
 * models read those reliably and they survive any copy/paste.
 */
import { reviewSchedule, weekOf, INTERVAL_DAYS } from '../leetcode/trackerCsv';
import { groupByProblem, overallStats, planProgress, focusWeek } from './stats';
import plan from './data/plan.json';
import planProblems from './data/problems.json';

const PROMPT = `I'm preparing for coding interviews with an 8-week, pattern-based LeetCode plan and a
Leitner spaced-repetition schedule (box 1-5; higher box = longer until the next review). Below is my
full progress log. Please:
1. Grade my preparation (A-F) on consistency, pattern coverage, and solution quality, with reasons.
2. Name my weakest patterns, citing evidence (failures, hints needed, slow times, low quality scores).
3. Find recurring mistakes in my notes and suggest concrete fixes.
4. Tell me whether my pace is on track and what to prioritise over the next 7 days.
5. Point out anything in how I practise (warm vs cold attempts, hint use, review backlog) that I should change.`;

const num = v => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
};
const avg = values => {
  const ns = values.map(num).filter(n => n !== null);
  return ns.length ? Math.round((ns.reduce((a, b) => a + b, 0) / ns.length) * 10) / 10 : null;
};
const pct = (part, whole) => (whole ? `${Math.round((part / whole) * 100)}%` : '-');
const blank = t => !t || !String(t).trim() || /^none$/i.test(String(t).trim());
const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
const section = title => ['', title.toUpperCase(), '-'.repeat(title.length)];
const pairs = obj =>
  Object.entries(obj)
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ') || 'none';

function patternLines(rows, groups) {
  const byPattern = new Map();
  rows.forEach(r => {
    const p = r.pattern || 'Unspecified';
    if (!byPattern.has(p)) byPattern.set(p, []);
    byPattern.get(p).push(r);
  });
  return [...byPattern.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([pattern, list]) => {
      const problems = [...groups.values()].filter(
        g => (g.latest.pattern || 'Unspecified') === pattern
      );
      const solved = list.filter(r => r.status === 'Solved').length;
      const hints = list.filter(r => r.hint === 'Y').length;
      const cold = list.filter(r => r.attemptType === 'Cold');
      const coldSolved = cold.filter(r => r.status === 'Solved' && r.hint !== 'Y').length;
      const parts = [
        `${problems.length} problems`,
        `${list.length} attempts`,
        `solved ${pct(solved, list.length)}`,
        `hint needed ${pct(hints, list.length)}`,
        `clean cold solves ${coldSolved}/${cold.length}`,
        `avg first approach ${avg(list.map(r => r.approachMin)) ?? '-'} min`,
        `avg total ${avg(list.map(r => r.totalMin)) ?? '-'} min`,
        `avg quality ${avg(list.map(r => r.quality)) ?? '-'}/5`,
      ];
      return `- ${pattern}: ${parts.join(' | ')}`;
    });
}

function attemptLines(row) {
  const title = [
    row.date,
    row.lc ? `#${row.lc} ${row.name}` : row.name,
    row.pattern,
    row.difficulty,
  ]
    .filter(Boolean)
    .join(' · ');
  const facts = [
    ['Status', row.status],
    ['Attempt', row.attemptType],
    ['Source', row.source],
    ['Hint', row.hint],
    ['First approach', row.approachMin && `${row.approachMin} min`],
    ['Total', row.totalMin && `${row.totalMin} min`],
    ['Quality', row.quality && `${row.quality}/5`],
    ['Optimal', row.optimal],
    ['Box', row.box],
  ]
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}: ${v}`)
    .join(' | ');
  return [
    `* ${title}`,
    facts ? `  ${facts}` : null,
    blank(row.companies) ? null : `  Companies: ${row.companies}`,
    blank(row.bugs) ? null : `  Mistakes: ${row.bugs}`,
    blank(row.notes) ? null : `  Notes: ${row.notes}`,
  ].filter(Boolean);
}

/** The whole report. ctx needs rows, today, planStart, keyOf, settings, problems; generatedAt is a Date. */
export function progressReport({
  rows,
  today,
  planStart,
  keyOf,
  settings,
  problems,
  generatedAt = new Date(),
}) {
  const groups = groupByProblem(rows, keyOf);
  const stats = overallStats(groups);
  const weeks = planProgress(planProblems, groups, keyOf);
  const focus = focusWeek(weeks, settings.advancePct / 100, settings.focusOverride);
  const focusData = weeks.find(w => w.week === focus);
  const focusPlan = plan.find(p => p.week === focus);
  const calWeek = weekOf(today, planStart);
  const schedule = reviewSchedule(rows, problems);
  const due = schedule.filter(r => r.next <= today);
  const sorted = [...rows].sort(byDate);

  const perDay = sorted.reduce((acc, r) => {
    if (r.date) acc[r.date] = (acc[r.date] || 0) + 1;
    return acc;
  }, {});
  const boxes = schedule.reduce((acc, r) => {
    acc[`box ${r.box}`] = (acc[`box ${r.box}`] || 0) + 1;
    return acc;
  }, {});

  const pace =
    calWeek && focus
      ? calWeek > focus
        ? `${calWeek - focus} week(s) behind the calendar`
        : calWeek < focus
        ? `${focus - calWeek} week(s) ahead of the calendar`
        : 'on pace with the calendar'
      : 'n/a';

  const lines = [
    'GRITHUB INTERVIEW PREP - PROGRESS EXPORT',
    `Generated: ${generatedAt.toISOString()} | Study day: ${today} | Plan start: ${
      planStart || 'not set'
    }`,
    ...section('Suggested prompt (paste this file into an AI assistant)'),
    PROMPT,
    ...section('Summary'),
    `Problems attempted: ${stats.problems} | Solved at least once: ${stats.solved} | Attempts logged: ${stats.attempts}`,
    `Days practised: ${Object.keys(perDay).length} | First attempt: ${
      sorted[0]?.date || '-'
    } | Latest: ${sorted[sorted.length - 1]?.date || '-'}`,
    `Plan position: ${
      focus
        ? `week ${focus}${focusPlan ? ` (${focusPlan.phase})` : ''}, ${focusData?.solved ?? 0}/${
            focusData?.total ?? 0
          } solved`
        : 'plan complete'
    } | Calendar week: ${calWeek || '-'} | Pace: ${pace}`,
    `Reviews due now: ${due.length} | Leitner boxes: ${pairs(boxes)}`,
    `Solved by difficulty: ${pairs(stats.byDifficulty)}`,
    `Settings: ${settings.sessionSize} new problems/day, advance at ${
      settings.advancePct
    }% solved; review intervals: ${Object.entries(INTERVAL_DAYS)
      .map(([b, d]) => `box ${b}: ${d}d`)
      .join(', ')}`,
    ...section('Plan progress by week'),
    ...weeks.map(w => {
      const p = plan.find(x => x.week === w.week);
      return `- Week ${w.week}${p ? ` · ${p.phase} · ${p.patterns}` : ''}: ${w.solved}/${
        w.total
      } solved${w.week === focus ? '  <- current' : ''}`;
    }),
    ...section('Patterns (all attempts)'),
    ...(rows.length ? patternLines(rows, groups) : ['No attempts yet.']),
    ...section('Activity (attempts per day)'),
    ...(Object.keys(perDay).length
      ? Object.entries(perDay).map(([d, n]) => `- ${d}: ${n}`)
      : ['No attempts yet.']),
    ...section('Due for review'),
    ...(due.length
      ? due.map(r => `- ${r.lc ? `#${r.lc} ` : ''}${r.name} (box ${r.box}, due ${r.next})`)
      : ['Nothing due.']),
    ...section('Attempt log (oldest first)'),
    ...(sorted.length ? sorted.flatMap(attemptLines) : ['No attempts yet.']),
    '',
  ];
  return lines.join('\n');
}
