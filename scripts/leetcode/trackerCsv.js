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

/** Parses CSV text into arrays of cells. Handles quoted cells with commas, quotes and newlines. */
function parseCsv(text) {
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

/**
 * Review schedule: one entry per problem, from its latest attempt. Entries with an invalid date/box
 * are dropped. Sorted by next review date. The popup caches this and filters by today at render time.
 */
function reviewSchedule(rows) {
  const latest = new Map();
  rows.forEach(r => {
    const id = r.lc || r.name;
    if (!id) return;
    const prev = latest.get(id);
    if (!prev || r.date >= prev.date) latest.set(id, r);
  });

  return [...latest.values()]
    .map(r => ({
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
const dueReviews = (rows, today) => reviewSchedule(rows).filter(r => r.next <= today);

export {
  TRACKER_FILENAME,
  COLUMNS,
  OPTIONS,
  INTERVAL_DAYS,
  guessPattern,
  appendRow,
  parseCsv,
  parseRows,
  suggestBox,
  nextReview,
  reviewSchedule,
  dueReviews,
};
