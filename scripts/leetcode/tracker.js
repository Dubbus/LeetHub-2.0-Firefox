/*
 * Interview-prep tracker.
 *
 * 1. A floating timer widget on LeetCode problem pages:
 *      Start initial approach -> Stop (starts solving timer) -> [submit accepted]
 * 2. After an accepted submission, a notes form whose contents (plus the
 *    timings) are appended as a row to a Google Sheet via an Apps Script web app
 *    (see apps-script/Code.gs). The actual POST happens in background.js.
 */

const HOST_ID = 'lh-tracker-host';
const TIMERS_KEY = 'tracker_timers';
const TICK_MS = 1000;

const PHASE = Object.freeze({ IDLE: 'idle', APPROACH: 'approach', SOLVING: 'solving' });

const STYLE = `
  :host { all: initial; }
  * { box-sizing: border-box; font-family: -apple-system, 'Segoe UI', Roboto, sans-serif; }
  .widget {
    position: fixed; left: 16px; bottom: 16px; z-index: 2147483000;
    display: flex; align-items: center; gap: 10px;
    padding: 8px 12px; border-radius: 10px; font-size: 13px;
    background: #262626; color: #f5f5f5; box-shadow: 0 4px 14px rgba(0,0,0,.35);
  }
  .widget[hidden], .overlay[hidden] { display: none; }
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
    width: min(460px, 92vw); max-height: 90vh; overflow: auto; padding: 18px;
    border-radius: 12px; background: #262626; color: #f5f5f5; font-size: 13px;
  }
  .modal h2 { margin: 0 0 4px; font-size: 16px; }
  .meta { color: #aaa; margin-bottom: 12px; }
  .modal label { display: block; margin: 10px 0 4px; color: #ccc; }
  .modal textarea, .modal input[type=text], .modal select {
    width: 100%; padding: 7px 8px; border-radius: 6px; font-size: 13px;
    border: 1px solid #555; background: #1a1a1a; color: #f5f5f5;
  }
  .modal textarea { min-height: 110px; resize: vertical; }
  .modal .check { display: flex; align-items: center; gap: 6px; margin-top: 10px; }
  .actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
  .status { margin-top: 10px; min-height: 16px; }
  .status.error { color: #ff7b72; }
  .status.ok { color: #7ee787; }
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

const toMinutes = ms => (ms == null ? '' : Math.round((ms / 60000) * 10) / 10);

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
  const reset = el('button', { className: 'secondary', textContent: 'Reset', title: 'Reset timer' });
  const widget = el('div', { className: 'widget', hidden: true }, label, time, action, reset);
  const overlay = el('div', { className: 'overlay', hidden: true });

  root.append(widget, overlay);
  document.body.append(host);

  ui = { host, widget, label, time, action, reset, overlay };
  action.addEventListener('click', onActionClick);
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

async function tick() {
  const slug = getSlug();
  const { widget, label, time, action, reset } = ensureUi();
  if (!slug) {
    widget.hidden = true;
    return;
  }
  widget.hidden = false;

  const timer = (await loadTimers())[slug] || { phase: PHASE.IDLE };
  const now = Date.now();

  if (timer.phase === PHASE.IDLE) {
    label.textContent = 'Interview tracker';
    time.textContent = '';
    action.textContent = '▶ Start initial approach';
    reset.hidden = true;
  } else if (timer.phase === PHASE.APPROACH) {
    label.textContent = 'Initial approach';
    time.textContent = formatClock(approachElapsed(timer, now));
    action.textContent = '⏹ Stop & start solving';
    reset.hidden = false;
  } else {
    label.textContent = `Solving (approach ${formatClock(approachElapsed(timer, now))})`;
    time.textContent = formatClock(solveElapsed(timer, now));
    action.hidden = true;
    reset.hidden = false;
    return;
  }
  action.hidden = false;
}

export function initTrackerWidget() {
  ensureUi();
  tick();
  setInterval(tick, TICK_MS);
}

/* ---------- notes form ---------- */

function collectProblemInfo(leetCode, slug) {
  const data = leetCode.submissionData;
  const question = data && data.question;
  return {
    problem: question ? `${question.questionId}. ${question.title}` : slugToTitle(slug),
    difficulty: question ? question.difficulty : '',
    topics: question && question.topicTags ? question.topicTags.map(t => t.name).join(', ') : '',
    language: data && data.lang ? data.lang.verboseName : '',
    runtime: data ? data.runtimeDisplay : '',
    memory: data ? data.memoryDisplay : '',
    url: `https://leetcode.com/problems/${slug}/`,
  };
}

async function isTrackerConfigured() {
  const { tracker_url } = await api().storage.local.get('tracker_url');
  return Boolean(tracker_url);
}

/**
 * Show the notes form for an accepted submission.
 * `acceptedAt` is when acceptance was detected, so upload latency doesn't inflate solve time.
 * Silent no-op if the tracker isn't configured, or for manual re-syncs of old submissions.
 */
export async function promptTrackerNotes(leetCode, { acceptedAt = Date.now(), manual = false } = {}) {
  try {
    const slug = getSlug();
    if (!slug || manual || !(await isTrackerConfigured())) return;

    const timer = (await loadTimers())[slug] || { phase: PHASE.IDLE };
    const approachMs =
      timer.phase === PHASE.IDLE
        ? null
        : timer.phase === PHASE.APPROACH
        ? acceptedAt - timer.approachStartedAt
        : timer.approachEndedAt - timer.approachStartedAt;
    const solveMs = timer.phase === PHASE.SOLVING ? acceptedAt - timer.solveStartedAt : null;

    showForm(slug, collectProblemInfo(leetCode, slug), approachMs, solveMs);
  } catch (err) {
    console.error('LeetHub tracker: could not open notes form', err);
  }
}

function showForm(slug, info, approachMs, solveMs) {
  const { overlay } = ensureUi();
  if (!overlay.hidden) return; // already open

  const notes = el('textarea', { placeholder: 'What was the key insight? What tripped you up?' });
  const pattern = el('input', { type: 'text', placeholder: 'e.g. two pointers, sliding window' });
  const confidence = el('select');
  [
    ['', '—'],
    ['1', '1 – lost'],
    ['2', '2 – shaky'],
    ['3', '3 – ok'],
    ['4', '4 – solid'],
    ['5', '5 – could teach it'],
  ].forEach(([value, text]) => confidence.append(el('option', { value, textContent: text })));
  const revisit = el('input', { type: 'checkbox' });
  const status = el('div', { className: 'status' });
  const save = el('button', { textContent: 'Save to sheet' });
  const skip = el('button', { className: 'secondary', textContent: 'Skip' });

  const timing = [
    approachMs != null ? `approach ${formatClock(approachMs)}` : null,
    solveMs != null ? `solving ${formatClock(solveMs)}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const close = async () => {
    await saveTimer(slug, null);
    overlay.hidden = true;
    overlay.replaceChildren();
    tick();
  };

  save.addEventListener('click', async () => {
    save.disabled = skip.disabled = true;
    status.className = 'status';
    status.textContent = 'Saving…';

    const now = new Date();
    const payload = {
      date: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
        now.getDate()
      ).padStart(2, '0')}`,
      timestamp: now.toISOString(),
      ...info,
      pattern: pattern.value.trim(),
      confidence: confidence.value,
      revisit: revisit.checked ? 'Yes' : 'No',
      notes: notes.value.trim(),
      approachMinutes: toMinutes(approachMs),
      solveMinutes: toMinutes(solveMs),
      totalMinutes: approachMs == null && solveMs == null ? '' : toMinutes(approachMs + solveMs),
    };

    try {
      const res = await api().runtime.sendMessage({ type: 'TRACKER_APPEND', payload });
      if (!res || !res.ok) {
        throw new Error((res && res.error) || 'No response from background script');
      }
      status.className = 'status ok';
      status.textContent = 'Saved ✓';
      setTimeout(close, 700);
    } catch (err) {
      // Keep the form open so the notes aren't lost.
      status.className = 'status error';
      status.textContent = `Failed: ${err.message}`;
      save.disabled = skip.disabled = false;
    }
  });
  skip.addEventListener('click', close);

  const modal = el(
    'div',
    { className: 'modal' },
    el('h2', { textContent: `Accepted: ${info.problem}` }),
    el('div', { className: 'meta', textContent: [info.difficulty, timing].filter(Boolean).join(' · ') }),
    el('label', { textContent: 'Notes' }),
    notes,
    el('label', { textContent: 'Pattern / technique' }),
    pattern,
    el('label', { textContent: 'Confidence' }),
    confidence,
    el('label', { className: 'check' }, revisit, 'Revisit later'),
    status,
    el('div', { className: 'actions' }, skip, save)
  );
  overlay.append(modal);
  overlay.hidden = false;
  notes.focus();
}
