/*
 * Pure helpers for the interview tracker: CSV encoding and the Leitner review schedule.
 * No DOM / network / storage here so it can be unit-tested and reused (e.g. reminders later).
 *
 * Column order mirrors the "Problem Tracker" tab of interview_prep_tracker.xlsx (A-P, then U),
 * skipping its formula columns (Q-T) so a paste can never overwrite them. `url` is an extra
 * trailing column the workbook doesn't have; it lets the popup link straight to the problem.
 */

const TRACKER_FILENAME = 'interview_tracker.csv';

const COLUMNS = [
  { key: 'date', header: 'Date Solved' },
  { key: 'lc', header: 'LC #' },
  { key: 'name', header: 'Problem Name' },
  { key: 'pattern', header: 'Pattern' },
  { key: 'difficulty', header: 'Difficulty' },
  { key: 'source', header: 'Source' },
  { key: 'companies', header: 'Company Tag(s)' },
  { key: 'attemptType', header: 'Attempt Type' },
  { key: 'approachMin', header: 'Time to First Approach (min)' },
  { key: 'totalMin', header: 'Total Time (min)' },
  { key: 'hint', header: 'Needed Framework/Hint?' },
  { key: 'status', header: 'Solved Status' },
  { key: 'quality', header: 'Approach Quality (1-5)' },
  { key: 'optimal', header: 'Optimal Complexity?' },
  { key: 'bugs', header: 'Bugs / Mistakes Made' },
  { key: 'box', header: 'Leitner Box (1-5)' },
  { key: 'notes', header: 'Notes / Takeaway' },
  { key: 'url', header: 'LeetCode Link' },
];

// Dropdown vocabularies copied from the workbook's data validations.
const OPTIONS = {
  pattern: [
    'Arrays & Hashing',
    'Two Pointers',
    'Sliding Window',
    'Binary Search',
    'Linked List',
    'Monotonic Stack',
    'Monotonic Queue',
    'Prefix Sum/Diff Array',
    'Binary Tree',
    'Binary Tree (Advanced)',
    'BFS',
    'Backtracking',
    'Dynamic Programming',
    'Greedy',
    'Union-Find',
    'Graph/Topo/Dijkstra',
    'Heap/Priority Queue',
  ],
  difficulty: ['Easy', 'Medium', 'Hard'],
  source: ['Pattern Drill', 'Company Tag', 'Review', 'Mock Set'],
  attemptType: ['Cold', 'Warm (read write-up first)', 'Watched video first', 'Redo after failing'],
  yesNo: ['Y', 'N'],
  status: ['Solved', 'Partial', 'Failed'],
  oneToFive: ['1', '2', '3', '4', '5'],
};

// LeetCode topic tag -> workbook pattern. Specific tags first; generic ones last so they only win by default.
const PATTERN_BY_LC_TAG = [
  ['Monotonic Stack', 'Monotonic Stack'],
  ['Monotonic Queue', 'Monotonic Queue'],
  ['Sliding Window', 'Sliding Window'],
  ['Two Pointers', 'Two Pointers'],
  ['Binary Search', 'Binary Search'],
  ['Linked List', 'Linked List'],
  ['Prefix Sum', 'Prefix Sum/Diff Array'],
  ['Union Find', 'Union-Find'],
  ['Backtracking', 'Backtracking'],
  ['Dynamic Programming', 'Dynamic Programming'],
  ['Breadth-First Search', 'BFS'],
  ['Heap (Priority Queue)', 'Heap/Priority Queue'],
  ['Topological Sort', 'Graph/Topo/Dijkstra'],
  ['Shortest Path', 'Graph/Topo/Dijkstra'],
  ['Greedy', 'Greedy'],
  ['Binary Tree', 'Binary Tree'],
  ['Tree', 'Binary Tree'],
  ['Graph', 'Graph/Topo/Dijkstra'],
  ['Hash Table', 'Arrays & Hashing'],
];

function guessPattern(tagNames) {
  const tags = new Set(tagNames || []);
  const hit = PATTERN_BY_LC_TAG.find(([tag]) => tags.has(tag));
  return hit ? hit[1] : '';
}

/* ---------- CSV (RFC 4180) ---------- */

function escapeCell(value) {
  const s = value === undefined || value === null ? '' : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function rowToLine(row) {
  return COLUMNS.map(c => escapeCell(row[c.key])).join(',');
}

const HEADER_LINE = COLUMNS.map(c => escapeCell(c.header)).join(',');

/** Returns the new file text after appending `row`; creates the header if there's no file yet. */
function appendRow(existingText, row) {
  const line = rowToLine(row);
  if (!existingText || existingText.trim() === '') {
    return `${HEADER_LINE}\n${line}\n`;
  }
  const base = existingText.endsWith('\n') ? existingText : `${existingText}\n`;
  return `${base}${line}\n`;
}

/** Serializes rows back to a full file (header + one line per row). Used by dashboard edits/imports. */
function toCsv(rows) {
  return `${[HEADER_LINE, ...rows.map(rowToLine)].join('\n')}\n`;
}

/** Parses CSV text into arrays of cells. Handles quoted cells with commas, quotes and newlines. */
function parseCsv(text) {
  text = text.replace(/^\uFEFF/, ''); // Excel's "CSV UTF-8" adds a BOM
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/** Parses the tracker CSV into row objects keyed by column key. Matches by header text, so column order can change. */
function parseRows(text) {
  if (!text) return [];
  const [header, ...body] = parseCsv(text).filter(r => r.some(cell => cell !== ''));
  if (!header) return [];
  const keyByHeader = Object.fromEntries(COLUMNS.map(c => [c.header, c.key]));
  return body.map(cells => {
    const row = {};
    header.forEach((h, i) => {
      if (keyByHeader[h]) row[keyByHeader[h]] = cells[i] === undefined ? '' : cells[i];
    });
    return row;
  });
}

/* ---------- Leitner schedule (mirrors the workbook's "Review Weighting Guide") ---------- */

const INTERVAL_DAYS = { 1: 2, 2: 4, 3: 8, 4: 16, 5: 30 };

/**
 * Suggested Leitner box for a new attempt. New problem -> box 1. Re-solve that is Solved, needed no
 * hint, and was Cold -> bump one box (max 5). Anything else -> back to box 1. Always user-editable.
 */
function suggestBox(history, lc, attempt) {
  const prior = history.filter(r => String(r.lc) === String(lc) && lc !== '').pop();
  if (!prior) return 1;
  const clean = attempt.status === 'Solved' && attempt.hint === 'N' && attempt.attemptType === 'Cold';
  return clean ? Math.min((Number(prior.box) || 1) + 1, 5) : 1;
}

const DAY_MS = 86400000;

const parseDay = s => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null;
};

const formatDay = ms => new Date(ms).toISOString().slice(0, 10);

/** 'YYYY-MM-DD' of the next review, or null if the date/box is invalid. */
function nextReview(dateStr, box) {
  const start = parseDay(dateStr);
  const days = INTERVAL_DAYS[Number(box)];
  return start === null || days === undefined ? null : formatDay(start + days * DAY_MS);
}

/* ---------- problem identity ---------- */

const slugFromUrl = url => {
  const m = /leetcode\.com\/problems\/([^/?#]+)/.exec(url || '');
  return m ? m[1] : '';
};

const normalizeName = s =>
  String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/**
 * Returns `row => key` giving every attempt of the same problem the same key, so the review schedule
 * treats them as one card. Preference: LeetCode slug (from the row's link, or learned from other rows
 * / the plan's problem list by LC # or name), then LC #, then normalized name. Names also match a
 * *unique* longer known name by prefix, so "two sum II" resolves to "Two Sum II - Input Array Is Sorted".
 * `problems` is an optional list of {name, url}.
 */
function makeKeyer(rows, problems = []) {
  const slugByLc = new Map();
  const slugByName = new Map();
  problems.forEach(p => {
    const slug = slugFromUrl(p.url);
    if (slug) slugByName.set(normalizeName(p.name), slug);
  });
  rows.forEach(r => {
    const slug = slugFromUrl(r.url);
    if (!slug) return;
    if (r.lc) slugByLc.set(String(r.lc), slug);
    slugByName.set(normalizeName(r.name), slug);
  });

  const slugForName = name => {
    const n = normalizeName(name);
    if (!n) return '';
    if (slugByName.has(n)) return slugByName.get(n);
    if (n.length < 3) return '';
    const hits = new Set();
    slugByName.forEach((slug, known) => {
      if (known.startsWith(`${n} `)) hits.add(slug);
    });
    return hits.size === 1 ? [...hits][0] : '';
  };

  return row => {
    const slug =
      slugFromUrl(row.url) || (row.lc && slugByLc.get(String(row.lc))) || slugForName(row.name);
    if (slug) return `slug:${slug}`;
    return row.lc ? `lc:${row.lc}` : `name:${normalizeName(row.name)}`;
  };
}

/* ---------- dates ---------- */

const EXCEL_EPOCH = Date.UTC(1899, 11, 30);

/** Accepts YYYY-MM-DD, M/D/YYYY and Excel serial numbers; returns 'YYYY-MM-DD' or '' if unusable. */
function normalizeDate(input) {
  const s = String(input === undefined || input === null ? '' : input).trim();
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  let ms = null;
  if (iso) ms = Date.UTC(+iso[1], +iso[2] - 1, +iso[3]);
  else if (us) ms = Date.UTC(+us[3], +us[1] - 1, +us[2]);
  else if (/^\d{4,6}(\.\d+)?$/.test(s) && +s > 20000 && +s < 80000) {
    ms = EXCEL_EPOCH + Math.floor(+s) * DAY_MS;
  }
  return ms === null || Number.isNaN(ms) ? '' : formatDay(ms);
}

/**
 * The local 'YYYY-MM-DD' your study day falls on. Late-night mode: with `dayStartHour` = 4, anything
 * before 4 AM still counts as the previous day, so a session past midnight neither pulls in tomorrow's
 * reviews nor starts a fresh batch of new problems. 0 = days change at midnight.
 */
function studyDay(now = new Date(), dayStartHour = 0) {
  const d = new Date(now.getTime());
  d.setHours(d.getHours() - (Number(dayStartHour) || 0));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 1-based plan week containing `today`, or null if `planStart` isn't a valid date. */
function weekOf(today, planStart) {
  const t = parseDay(today);
  const start = parseDay(planStart);
  if (t === null || start === null) return null;
  return Math.max(1, Math.floor((t - start) / (7 * DAY_MS)) + 1);
}

/* ---------- review schedule ---------- */

/** The "live" attempt of each problem: latest date, later row wins ties. Returns Map key -> row. */
function latestByProblem(rows, keyOf) {
  const latest = new Map();
  rows.forEach(r => {
    const key = keyOf(r);
    if (!key || key === 'name:') return;
    const prev = latest.get(key);
    if (!prev || r.date >= prev.date) latest.set(key, r);
  });
  return latest;
}

const daysBetween = (fromDay, toDay) => Math.round((parseDay(toDay) - parseDay(fromDay)) / DAY_MS);

/**
 * Review schedule: one entry per problem, from its latest attempt. Entries with an invalid date/box
 * are dropped. Sorted by next review date. The popup caches this and filters by today at render time.
 */
function reviewSchedule(rows, problems = []) {
  const keyOf = makeKeyer(rows, problems);
  return [...latestByProblem(rows, keyOf).entries()]
    .map(([key, r]) => ({
      key,
      lc: r.lc,
      name: r.name,
      url: r.url,
      box: Number(r.box) || null,
      next: nextReview(r.date, r.box),
    }))
    .filter(r => r.next !== null)
    .sort((a, b) => (a.next < b.next ? -1 : a.next > b.next ? 1 : 0));
}

/** Problems due on `today` ('YYYY-MM-DD'), most overdue first. */
const dueReviews = (rows, today, problems = []) =>
  reviewSchedule(rows, problems).filter(r => r.next <= today);

/** Splits due problems into today's quota and the rest. Input must already be sorted most overdue first. */
function splitQueue(due, dailyLimit) {
  return { today: due.slice(0, dailyLimit), backlog: due.slice(dailyLimit) };
}

/**
 * The workbook's four computed columns for every attempt row. Only a problem's latest attempt is "live";
 * older attempts are 'superseded' instead of showing DUE forever (the flaw of the per-row formulas).
 */
function annotateAttempts(rows, today, problems = []) {
  const keyOf = makeKeyer(rows, problems);
  const latest = latestByProblem(rows, keyOf);
  return rows.map(row => {
    const key = keyOf(row);
    const live = latest.get(key) === row;
    const interval = INTERVAL_DAYS[Number(row.box)] || null;
    const next = nextReview(row.date, row.box);
    const daysUntil = next ? daysBetween(today, next) : null;
    let flag = '';
    if (!live) flag = 'superseded';
    else if (next) flag = daysUntil <= 0 ? 'DUE' : '-';
    return { row, key, live, interval, next, daysUntil, flag };
  });
}

/* ---------- import (workbook Problem Tracker export) ---------- */

/**
 * Turns a CSV exported from the workbook's Problem Tracker tab into rows to append. Maps by header text
 * (its formula columns are ignored), normalizes dates, recovers missing links from the plan's problem
 * list, and skips blank rows and duplicates (same problem + date + status) of existing or earlier rows.
 */
function importRows(csvText, existingRows, problems = []) {
  const incoming = parseRows(csvText);
  const keyOf = makeKeyer([...existingRows, ...incoming], problems);
  const slugByKey = new Map();
  problems.forEach(p => {
    const slug = slugFromUrl(p.url);
    if (slug) slugByKey.set(`slug:${slug}`, p.url);
  });

  const seen = new Set(existingRows.map(r => `${keyOf(r)}|${r.date}|${r.status}`));
  const rows = [];
  const skipped = { blank: 0, duplicate: 0 };

  incoming.forEach(r => {
    const date = normalizeDate(r.date);
    if (!r.name || !r.name.trim() || !date) {
      skipped.blank++;
      return;
    }
    const row = { ...r, date, name: r.name.trim() };
    const key = keyOf(row);
    if (!row.url && slugByKey.has(key)) row.url = slugByKey.get(key);
    const id = `${key}|${row.date}|${row.status}`;
    if (seen.has(id)) {
      skipped.duplicate++;
      return;
    }
    seen.add(id);
    rows.push(row);
  });
  return { rows, skipped };
}

export {
  TRACKER_FILENAME,
  COLUMNS,
  OPTIONS,
  INTERVAL_DAYS,
  guessPattern,
  appendRow,
  toCsv,
  parseCsv,
  parseRows,
  suggestBox,
  slugFromUrl,
  normalizeName,
  makeKeyer,
  latestByProblem,
  parseDay,
  normalizeDate,
  studyDay,
  weekOf,
  nextReview,
  reviewSchedule,
  dueReviews,
  splitQueue,
  annotateAttempts,
  importRows,
};
