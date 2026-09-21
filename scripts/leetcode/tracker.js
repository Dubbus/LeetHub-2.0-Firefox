/*
 * Interview-prep tracker.
 *
 * 1. A floating timer widget on LeetCode problem pages:
 *      Start initial approach -> Stop (starts solving timer) -> [submit accepted]
 * 2. After an accepted submission (or "Log without solving"), a form whose contents are appended as a
 *    row to interview_tracker.csv in the user's LeetHub GitHub repo (columns mirror the workbook's
 *    Problem Tracker tab; see trackerCsv.js).
 * 3. A cache of the Leitner review schedule in storage.local for the popup's "Due for review" list.
 */
import {
  TRACKER_FILENAME,
  OPTIONS,
  guessPattern,
  parseRows,
  suggestBox,
  makeKeyer,
  dueReviews,
  nextReview,
  INTERVAL_DAYS,
} from './trackerCsv';
import {
  getAuth,
  readCsv,
  appendAttempt,
  refreshScheduleIfStale,
  PLAN_PROBLEMS,
} from './trackerStore';
import guide from '../dashboard/data/guide.json';

const HOST_ID = 'lh-tracker-host';
const TIMERS_KEY = 'tracker_timers';
const TICK_MS = 1000;

const PHASE = Object.freeze({ IDLE: 'idle', APPROACH: 'approach', SOLVING: 'solving' });

const LEITNER_WIKI = 'https://en.wikipedia.org/wiki/Leitner_system';

// While the form is open the widget shows this instant instead of the live clock.
let frozenAt = null;

// The GitHub upload of the solution (from leetcode.js). Saving a tracker row waits for it so the two
// commits can't race on the branch ref.
let pendingUpload = Promise.resolve();
export function trackUpload(promise) {
  pendingUpload = Promise.resolve(promise).catch(() => {});
}

const STYLE = `
  :host { all: initial; }
  * { box-sizing: border-box; font-family: -apple-system, 'Segoe UI', Roboto, sans-serif; }
  .widget {
    position: fixed; left: 16px; bottom: 16px; z-index: 2147483000;
    display: flex; align-items: center; gap: 10px;
    padding: 8px 12px; border-radius: 10px; font-size: 13px;
    background: #262626; color: #f5f5f5; box-shadow: 0 4px 14px rgba(0,0,0,.35);
  }
  .widget[hidden], .overlay[hidden], button[hidden] { display: none; }
  .label { min-width: 140px; }
  .time { font-variant-numeric: tabular-nums; font-weight: 600; }
  button {
    border: 0; border-radius: 6px; padding: 5px 10px; font-size: 12px; cursor: pointer;
    background: darkorange; color: #fff; font-weight: 600;
  }
  button.secondary { background: transparent; color: #bbb; border: 1px solid #555; }
  button:disabled { opacity: .6; cursor: default; }
  .overlay {
    position: fixed; inset: 0; z-index: 2147483001; display: flex;
    align-items: center; justify-content: center; background: rgba(0,0,0,.55);
  }
  .modal {
    width: min(560px, 94vw); max-height: 92vh; overflow: auto; padding: 18px;
    border-radius: 12px; background: #262626; color: #f5f5f5; font-size: 13px;
  }
  .modal h2 { margin: 0 0 4px; font-size: 16px; }
  .meta { color: #aaa; margin-bottom: 8px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 12px; }
  .field.full { grid-column: 1 / -1; }
  .modal label { display: block; margin: 10px 0 4px; color: #ccc; }
  .modal textarea, .modal input, .modal select {
    width: 100%; padding: 7px 8px; border-radius: 6px; font-size: 13px;
    border: 1px solid #555; background: #1a1a1a; color: #f5f5f5;
  }
  .modal textarea { min-height: 90px; resize: vertical; }
  .actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
  .status { margin-top: 10px; min-height: 16px; }
  .status.error { color: #ff7b72; }
  .status.ok { color: #7ee787; }
  .help { margin-top: 4px; color: #ccc; }
  .help summary { cursor: pointer; color: #9ad; }
  .help ul { margin: 6px 0; padding-left: 18px; }
  .help p { margin: 6px 0; color: #aaa; }
  .help a { color: #6cc4cc; }
`;

const api = () => BrowserUtil.instance;

const getSlug = () => {
  const match = window.location.pathname.match(/^\/problems\/([^/]+)/);
  return match ? match[1] : null;
};

const slugToTitle = slug =>
  slug
    .split('-')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

const formatClock = ms => {
  const total = Math.max(0, Math.floor(ms / 1000));
  const mm = String(Math.floor(total / 60)).padStart(2, '0');
  const ss = String(total % 60).padStart(2, '0');
  return `${mm}:${ss}`;
};

const toMinutes = ms => (ms == null ? '' : String(Math.round((ms / 60000) * 10) / 10));

const localDay = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(
    2,
    '0'
  )}`;

/* ---------- timer persistence (per problem slug, survives reloads) ---------- */

async function loadTimers() {
  const data = await api().storage.local.get(TIMERS_KEY);
  return data[TIMERS_KEY] || {};
}

async function saveTimer(slug, timer) {
  const timers = await loadTimers();
  if (timer) {
    timers[slug] = timer;
  } else {
    delete timers[slug];
  }
  await api().storage.local.set({ [TIMERS_KEY]: timers });
}

const approachElapsed = (t, now) =>
  t.phase === PHASE.APPROACH ? now - t.approachStartedAt : t.approachEndedAt - t.approachStartedAt;

const solveElapsed = (t, now) => (t.phase === PHASE.SOLVING ? now - t.solveStartedAt : null);

/** Timings for the CSV: time to first approach, and total (approach + solving) up to `now`. */
function timings(timer, now) {
  if (timer.phase === PHASE.IDLE) return { approachMs: null, totalMs: null };
  return { approachMs: approachElapsed(timer, now), totalMs: now - timer.approachStartedAt };
}

/* ---------- DOM ---------- */

let ui = null;

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  Object.assign(node, props);
  children.forEach(c => node.append(c));
  return node;
}

function ensureUi() {
  if (ui && ui.host.isConnected) {
    return ui;
  }
  const host = el('div', { id: HOST_ID });
  const root = host.attachShadow({ mode: 'open' });
  root.append(el('style', { textContent: STYLE }));

  const label = el('span', { className: 'label' });
  const time = el('span', { className: 'time' });
  const action = el('button');
  const logBtn = el('button', {
    className: 'secondary',
    textContent: 'Log attempt',
    title: 'Open the form: use it for a Failed/Partial attempt, or if it did not open after Accepted',
  });
  const reset = el('button', { className: 'secondary', textContent: 'Reset', title: 'Reset timer' });
  const widget = el('div', { className: 'widget', hidden: true }, label, time, action, logBtn, reset);
  const overlay = el('div', { className: 'overlay', hidden: true });

  root.append(widget, overlay);
  document.body.append(host);

  ui = { host, widget, label, time, action, logBtn, reset, overlay };
  action.addEventListener('click', onActionClick);
  logBtn.addEventListener('click', onLogClick);
  reset.addEventListener('click', onResetClick);
  return ui;
}

/* ---------- timer widget ---------- */

async function onActionClick() {
  const slug = getSlug();
  if (!slug) return;
  const now = Date.now();
  const timer = (await loadTimers())[slug] || { phase: PHASE.IDLE };

  if (timer.phase === PHASE.IDLE) {
    await saveTimer(slug, { phase: PHASE.APPROACH, approachStartedAt: now });
  } else if (timer.phase === PHASE.APPROACH) {
    await saveTimer(slug, {
      ...timer,
      phase: PHASE.SOLVING,
      approachEndedAt: now,
      solveStartedAt: now,
    });
  }
  tick();
}

async function onResetClick() {
  const slug = getSlug();
  if (!slug) return;
  await saveTimer(slug, null);
  tick();
}

async function onLogClick() {
  const slug = getSlug();
  if (!slug) return;
  const now = Date.now();
  const timer = (await loadTimers())[slug] || { phase: PHASE.IDLE };
  const info = await getProblemInfo(slug, null);
  // If the page is showing an Accepted result, treat it like the automatic prompt.
  const result = document.querySelector('[data-e2e-locator="submission-result"]');
  const accepted = /accepted/i.test((result && result.textContent) || '');
  showForm(slug, info, timings(timer, now), {
    status: accepted ? 'Solved' : 'Failed',
    manual: !accepted,
    freezeAt: now,
  });
}

async function tick() {
  const slug = getSlug();
  const { widget, label, time, action, logBtn, reset } = ensureUi();
  if (!slug || !(await getAuth())) {
    widget.hidden = true;
    return;
  }
  widget.hidden = false;

  const timer = (await loadTimers())[slug] || { phase: PHASE.IDLE };
  const now = frozenAt === null ? Date.now() : frozenAt;
  const idle = timer.phase === PHASE.IDLE;
  reset.hidden = idle;

  if (idle) {
    label.textContent = 'Interview tracker';
    time.textContent = '';
    action.textContent = '▶ Start initial approach';
    action.hidden = false;
  } else if (timer.phase === PHASE.APPROACH) {
    label.textContent = 'Initial approach';
    time.textContent = formatClock(approachElapsed(timer, now));
    action.textContent = '⏹ Stop & start solving';
    action.hidden = false;
  } else {
    label.textContent = `Solving (approach ${formatClock(approachElapsed(timer, now))})`;
    time.textContent = formatClock(solveElapsed(timer, now));
    action.hidden = true;
  }
}

export function initTrackerWidget() {
  ensureUi();
  tick();
  setInterval(tick, TICK_MS);
  refreshScheduleIfStale();
}

/* ---------- problem info ---------- */

/** Problem metadata via LeetCode's own GraphQL endpoint (same origin), or null if unavailable. */
async function fetchQuestion(slug) {
  try {
    const res = await fetch('https://leetcode.com/graphql/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query:
          'query q($s: String!) { question(titleSlug: $s) { questionFrontendId title difficulty topicTags { name } } }',
        variables: { s: slug },
      }),
    });
    const q = (await res.json()).data.question;
    return q
      ? {
          lc: q.questionFrontendId,
          name: q.title,
          difficulty: q.difficulty,
          pattern: guessPattern(q.topicTags.map(t => t.name)),
        }
      : null;
  } catch (err) {
    return null;
  }
}

async function getProblemInfo(slug, leetCode) {
  const url = `https://leetcode.com/problems/${slug}/`;
  const fetched = await fetchQuestion(slug);
  if (fetched) return { ...fetched, url };

  // Fallback: what LeetHub already parsed from the submission, then just the slug.
  const q = leetCode && leetCode.submissionData && leetCode.submissionData.question;
  return {
    lc: q ? q.questionId : '',
    name: q ? q.title : slugToTitle(slug),
    difficulty: q ? q.difficulty : '',
    pattern: q ? guessPattern((q.topicTags || []).map(t => t.name)) : '',
    url,
  };
}

/**
 * Show the form for an accepted submission.
 * `acceptedAt` is when acceptance was detected, so upload latency doesn't inflate the times.
 * Silent no-op if not authenticated / disabled, or for manual re-syncs of old submissions.
 */
export async function promptTrackerNotes(leetCode, { acceptedAt = Date.now(), manual = false } = {}) {
  try {
    const slug = getSlug();
    if (!slug || manual || !(await getAuth())) return;

    const timer = (await loadTimers())[slug] || { phase: PHASE.IDLE };
    showForm(slug, await getProblemInfo(slug, leetCode), timings(timer, acceptedAt), {
      status: 'Solved',
      freezeAt: acceptedAt,
    });
  } catch (err) {
    console.error('LeetHub tracker: could not open the form', err);
  }
}

/* ---------- form ---------- */

function selectEl(options, value, { blank = false } = {}) {
  const s = el('select');
  if (blank) s.append(el('option', { value: '', textContent: '—' }));
  options.forEach(o => s.append(el('option', { value: o, textContent: o })));
  s.value = value || '';
  return s;
}

const inputEl = (value = '', placeholder = '') =>
  el('input', { type: 'text', value: String(value), placeholder });

const field = (label, control, full = false) =>
  el('div', { className: full ? 'field full' : 'field' }, el('label', { textContent: label }), control);

function showForm(slug, info, { approachMs, totalMs }, { status: initialStatus, manual = false, freezeAt = null }) {
  const { overlay } = ensureUi();
  if (!overlay.hidden) return; // already open
  frozenAt = freezeAt; // stop the widget's clock while the form is open

  const date = inputEl(localDay());
  const lc = inputEl(info.lc);
  const name = inputEl(info.name);
  const pattern = selectEl(OPTIONS.pattern, info.pattern, { blank: true });
  const difficulty = selectEl(OPTIONS.difficulty, info.difficulty, { blank: true });
  const source = selectEl(OPTIONS.source, 'Pattern Drill');
  const companies = inputEl('', 'e.g. Google, Meta');
  const attemptType = selectEl(OPTIONS.attemptType, 'Cold');
  const approachMin = inputEl(toMinutes(approachMs));
  const totalMin = inputEl(toMinutes(totalMs));
  const hint = selectEl(OPTIONS.yesNo, 'N');
  const status = selectEl(OPTIONS.status, initialStatus);
  const quality = selectEl(OPTIONS.oneToFive, '', { blank: true });
  const optimal = selectEl(OPTIONS.yesNo, '', { blank: true });
  const bugs = inputEl('', 'Mistakes you made');
  const box = selectEl(OPTIONS.oneToFive, '1');
  const notes = el('textarea', { placeholder: 'Key insight / takeaway' });
  const statusLine = el('div', { className: 'status' });
  const dueNote = el('div', {
    className: 'meta',
    textContent: 'Due for review. Saving logs it as a Review; skipping leaves it due.',
    hidden: true,
  });
  const save = el('button', { textContent: 'Save' });
  const cancel = el('button', { className: 'secondary', textContent: manual ? 'Cancel' : 'Skip' });

  // Leitner box: suggested from the CSV history until the user picks one themselves.
  let history = [];
  let boxTouched = false;
  const recomputeBox = () => {
    if (boxTouched) return;
    box.value = String(
      suggestBox(history, lc.value.trim(), {
        status: status.value,
        hint: hint.value,
        attemptType: attemptType.value,
      })
    );
    updateBoxHint();
  };
  const boxHint = el('div', { className: 'meta' });
  const updateBoxHint = () => {
    const b = Number(box.value);
    const info = guide.leitner.find(l => l.box === b);
    const due = nextReview(date.value.trim(), b);
    boxHint.textContent = info
      ? `Box ${b}: ${info.meaning}. Next review in ${INTERVAL_DAYS[b]} days${due ? ` (${due})` : ''}.`
      : '';
  };
  const boxHelp = el(
    'details',
    { className: 'help' },
    el('summary', { textContent: 'How do Leitner boxes work?' }),
    el(
      'ul',
      {},
      ...guide.leitner.map(l =>
        el('li', { textContent: `Box ${l.box} · review in ${INTERVAL_DAYS[l.box]} days · ${l.meaning}` })
      )
    ),
    el('p', { textContent: guide.rule }),
    el('a', { href: LEITNER_WIKI, target: '_blank', rel: 'noopener', textContent: 'Leitner system on Wikipedia ↗' })
  );
  box.addEventListener('change', () => {
    boxTouched = true;
    updateBoxHint();
  });
  date.addEventListener('input', updateBoxHint);
  updateBoxHint();
  [status, hint, attemptType].forEach(c => c.addEventListener('change', recomputeBox));
  lc.addEventListener('input', recomputeBox);
  // If this problem is due for review, log it as a Review by default (one click to save).
  let sourceTouched = false;
  source.addEventListener('change', () => (sourceTouched = true));
  getAuth()
    .then(auth => auth && readCsv(auth))
    .then(text => {
      history = parseRows(text || '');
      recomputeBox();
      const key = makeKeyer(history, PLAN_PROBLEMS)({ lc: lc.value.trim(), name: name.value, url: info.url });
      if (dueReviews(history, date.value, PLAN_PROBLEMS).some(d => d.key === key)) {
        if (!sourceTouched) source.value = 'Review';
        dueNote.hidden = false;
      }
    })
    .catch(() => {}); // suggestions are best effort

  const close = async () => {
    // Skipping an accepted submission (or finishing a save) ends that problem's timer.
    if (!manual || save.dataset.saved) await saveTimer(slug, null);
    frozenAt = null;
    overlay.hidden = true;
    overlay.replaceChildren();
    tick();
  };

  save.addEventListener('click', async () => {
    statusLine.className = 'status';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date.value.trim()) || !name.value.trim()) {
      statusLine.className = 'status error';
      statusLine.textContent = 'Need a date (YYYY-MM-DD) and a problem name.';
      return;
    }
    save.disabled = cancel.disabled = true;
    statusLine.textContent = 'Saving to GitHub…';

    const row = {
      date: date.value.trim(),
      lc: lc.value.trim(),
      name: name.value.trim(),
      pattern: pattern.value,
      difficulty: difficulty.value,
      source: source.value,
      companies: companies.value.trim(),
      attemptType: attemptType.value,
      approachMin: approachMin.value.trim(),
      totalMin: totalMin.value.trim(),
      hint: hint.value,
      status: status.value,
      quality: quality.value,
      optimal: optimal.value,
      bugs: bugs.value.trim(),
      box: box.value,
      notes: notes.value.trim(),
      url: info.url,
    };

    try {
      const auth = await getAuth();
      if (!auth) throw new Error('Not signed in to GitHub through LeetHub');
      await pendingUpload; // let LeetHub finish committing the solution first
      await appendAttempt(auth, row);
      save.dataset.saved = '1';
      statusLine.className = 'status ok';
      statusLine.textContent = `Saved to ${TRACKER_FILENAME} ✓`;
      setTimeout(close, 800);
    } catch (err) {
      // Keep the form open so nothing typed is lost.
      statusLine.className = 'status error';
      statusLine.textContent = `Failed: ${err.message}${err.detail ? ` (${err.detail})` : ''}${
        err.request ? ` at ${err.request}` : ''
      }`;
      console.error('LeetHub tracker: save failed', err);
      save.disabled = cancel.disabled = false;
    }
  });
  cancel.addEventListener('click', close);

  const timing = [
    approachMs != null ? `first approach ${formatClock(approachMs)}` : null,
    totalMs != null ? `total ${formatClock(totalMs)}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  overlay.append(
    el(
      'div',
      { className: 'modal' },
      el('h2', { textContent: manual ? 'Log attempt' : 'Accepted ✓' }),
      el('div', { className: 'meta', textContent: timing || 'No timer was running for this problem.' }),
      dueNote,
      el(
        'div',
        { className: 'grid' },
        field('Date solved', date),
        field('LC #', lc),
        field('Problem name', name, true),
        field('Pattern', pattern),
        field('Difficulty', difficulty),
        field('Source', source),
        field('Company tag(s)', companies),
        field('Attempt type', attemptType),
        field('Solved status', status),
        field('Time to first approach (min)', approachMin),
        field('Total time (min)', totalMin),
        field('Needed framework/hint?', hint),
        field('Approach quality (1-5)', quality),
        field('Optimal complexity?', optimal),
        field('Leitner box (1-5)', box),
        el('div', { className: 'field full' }, boxHint, boxHelp),
        field('Bugs / mistakes made', bugs, true),
        field('Notes / takeaway', notes, true)
      ),
      statusLine,
      el('div', { className: 'actions' }, cancel, save)
    )
  );
  overlay.hidden = false;
  notes.focus();
}
