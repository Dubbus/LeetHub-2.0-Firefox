/*
 * Interview dashboard page (dashboard.html). Loads interview_tracker.csv from the user's LeetHub repo
 * and renders Today / Attempts / Plan / Reference. `?demo` uses a bundled sample CSV, in-memory only,
 * so the page can be previewed without signing in or writing anything.
 */
import { TRACKER_FILENAME, parseRows, toCsv, makeKeyer, importRows } from '../leetcode/trackerCsv';
import { getAuth, readCsv, writeCsv, PLAN_PROBLEMS } from '../leetcode/trackerStore';
import { earliestDate } from './stats';
import { h, todayView, attemptsView, planView, referenceView, editDialog } from './views';

const DEFAULT_DAILY_REVIEWS = 5;
const TABS = { today: todayView, attempts: attemptsView, plan: planView, reference: referenceView };

const demo = new URLSearchParams(window.location.search).has('demo');

const localDay = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/* ---------- data source & settings ---------- */

function demoBackend() {
  let text = '';
  return {
    label: 'Demo data (not saved)',
    load: async () => {
      if (!text) text = await (await fetch('scripts/dashboard/fixtures/sample.csv')).text();
      return text;
    },
    save: async next => {
      text = next;
    },
    getSettings: async () => JSON.parse(localStorage.getItem('demo_settings') || '{}'),
    setSetting: async (k, v) =>
      localStorage.setItem('demo_settings', JSON.stringify({ ...JSON.parse(localStorage.getItem('demo_settings') || '{}'), [k]: v })),
  };
}

async function githubBackend() {
  const auth = await getAuth({ requireEnabled: false });
  if (!auth) throw new Error('Not signed in. Authenticate with GitHub and link a repo in the LeetHub popup first.');
  const storage = BrowserUtil.instance.storage.local;
  return {
    label: `${auth.hook}/${TRACKER_FILENAME}`,
    load: () => readCsv(auth),
    save: (text, message) => writeCsv(auth, text, message),
    getSettings: () => storage.get(['tracker_plan_start', 'tracker_daily_reviews']),
    setSetting: (k, v) => storage.set({ [k]: v }),
  };
}

/* ---------- state ---------- */

const state = {
  rows: [],
  planStart: '',
  dailyLimit: DEFAULT_DAILY_REVIEWS,
  filters: { q: '', pattern: '', status: '', dueOnly: false },
  sort: { id: 'date', dir: 'desc' },
  importPreview: null,
};
let backend;

const $ = id => document.getElementById(id);

function banner(message, isError = false) {
  const el = $('banner');
  el.hidden = !message;
  el.className = isError ? 'error' : '';
  el.textContent = message || '';
}

function currentTab() {
  const name = window.location.hash.replace('#', '');
  return TABS[name] ? name : 'today';
}

function render() {
  const tab = currentTab();
  document.querySelectorAll('#tabs a').forEach(a => a.classList.toggle('active', a.dataset.tab === tab));

  const ctx = {
    ...state,
    today: localDay(),
    problems: PLAN_PROBLEMS,
    keyOf: makeKeyer(state.rows, PLAN_PROBLEMS),
    onSetting,
    onEdit,
    onImportFile,
    onImportConfirm,
    onImportCancel: () => {
      state.importPreview = null;
      render();
    },
  };
  $('view').className = tab; // lets CSS widen the Attempts table
  $('view').replaceChildren(TABS[tab](ctx));
}

/* ---------- actions ---------- */

async function onSetting(key, value) {
  await backend.setSetting(key, value);
  if (key === 'tracker_plan_start') state.planStart = value;
  render();
}

async function commit(rows, message) {
  await backend.save(toCsv(rows), message);
  state.rows = rows;
  if (!state.planStart) state.planStart = earliestDate(rows);
}

function onEdit(index) {
  const dialog = $('dialog');
  const close = () => {
    dialog.close();
    dialog.replaceChildren();
  };
  const row = state.rows[index];
  dialog.replaceChildren(
    ...editDialog(row, {
      onClose: close,
      onSave: async next => {
        const rows = state.rows.map((r, i) => (i === index ? next : r));
        await commit(rows, `Edit ${next.name} attempt - LeetHub`);
        close();
        render();
      },
      onDelete: async () => {
        await commit(state.rows.filter((_, i) => i !== index), `Delete ${row.name} attempt - LeetHub`);
        close();
        render();
      },
    })
  );
  dialog.showModal();
}

async function onImportFile(file) {
  try {
    state.importPreview = importRows(await file.text(), state.rows, PLAN_PROBLEMS);
    banner('');
  } catch (err) {
    banner(`Could not read that file: ${err.message}`, true);
  }
  render();
}

async function onImportConfirm() {
  const { rows } = state.importPreview;
  try {
    await commit([...state.rows, ...rows], `Import ${rows.length} attempts from workbook - LeetHub`);
    state.importPreview = null;
    banner(`Imported ${rows.length} attempts.`);
  } catch (err) {
    banner(`Import failed: ${err.message}${err.detail ? ` (${err.detail})` : ''}`, true);
  }
  render();
}

/* ---------- boot ---------- */

async function boot() {
  window.addEventListener('hashchange', render);
  try {
    backend = demo ? demoBackend() : await githubBackend();
    $('source').textContent = backend.label;
    const [text, settings] = await Promise.all([backend.load(), backend.getSettings()]);
    state.rows = parseRows(text);
    state.planStart = settings.tracker_plan_start || earliestDate(state.rows);
    state.dailyLimit = Number(settings.tracker_daily_reviews) || DEFAULT_DAILY_REVIEWS;
    if (demo) banner('Demo mode: showing sample data. Nothing is saved.');
  } catch (err) {
    banner(err.message, true);
  }
  render();
}

boot();
