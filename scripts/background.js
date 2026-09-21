let api = isChrome() ? chrome : isStandardBrowser() ? browser : undefined;

api.runtime.onInstalled.addListener(details => {
  if (details.reason === 'install') {
    // Allow persistent stats to sync on repo link
    api.storage.local.set({ sync_stats: true });
  }
});

api.runtime.onMessage.addListener(handleMessage);

function handleMessage(request, sender, sendResponse) {
  if (request && request.closeWebPage === true && request.isSuccess === true) {
    /* Set username */
    api.storage.local.set({ leethub_username: request.username });

    /* Set token */
    api.storage.local.set({ leethub_token: request.token });

    /* Close pipe */
    api.storage.local.set({ pipe_leethub: false }, () => {
      console.log('Closed pipe.');
    });

    api.tabs.query({ active: true, lastFocusedWindow: true }, function (tabs) {
      var tab = tabs[0];
      api.tabs.remove(tab.id);
    });

    /* Go to onboarding for UX */
    const urlOnboarding = api.runtime.getURL('welcome.html');
    api.tabs.create({ url: urlOnboarding, active: true }); // creates new tab
  } else if (request && request.closeWebPage === true && request.isSuccess === false) {
    alert('Something went wrong while trying to authenticate your profile!');
    api.tabs.query({ active: true, lastFocusedWindow: true }, function (tabs) {
      var tab = tabs[0];
      api.tabs.remove(tab.id);
    });
  } else if (request.type === 'LEETCODE_SUBMISSION') {
    api.webNavigation.onHistoryStateUpdated.addListener(
      (e = function (details) {
        const submissionId = details.url.match(/\/submissions\/(\d+)\//)[1];
        sendResponse({ submissionId });
        api.webNavigation.onHistoryStateUpdated.removeListener(e);
      }),
      { url: [{ hostSuffix: 'leetcode.com' }, { pathContains: 'submissions' }] }
    );
  } else if (request.type === 'TRACKER_APPEND') {
    appendToTracker(request.payload).then(sendResponse);
  }
  return true;
}

/* Append a row to the interview-prep Google Sheet via the user's Apps Script web app. */
async function appendToTracker(payload) {
  try {
    const { tracker_url, tracker_secret } = await api.storage.local.get([
      'tracker_url',
      'tracker_secret',
    ]);
    if (!tracker_url) {
      return { ok: false, error: 'Tracker URL not set. Add it in the LeetHub popup.' };
    }
    // text/plain avoids a CORS preflight, which Apps Script web apps don't answer.
    const res = await fetch(tracker_url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ secret: tracker_secret || '', row: payload }),
    });
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}` };
    }
    const body = await res.json();
    return body.ok ? body : { ok: false, error: body.error || 'Unknown sheet error' };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function isChrome() {
  return typeof chrome !== 'undefined' && typeof chrome.runtime !== 'undefined';
}

function isStandardBrowser() {
  return typeof browser !== 'undefined' && typeof browser.runtime !== 'undefined';
}
