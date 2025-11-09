// dev-analytics.js
// Developer Analytics for Polyweave Mines (single-file, robust, no syntax errors)

// Config
const STORAGE_KEY = 'polyweave_analytics_v1';
const SECRET_ROWS = 6;
const SECRET_COLS = 7;
const SECRET_MINES = 67;
const PANEL_ID = 'pw-dev-analytics-panel';

// Internal state
let sessionInterval = null;
let analyticsInitialized = false;

// Utilities
function safeGetStorage() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null') || null;
  } catch (e) {
    console.error('[DevAnalytics] storage parse error', e);
    return null;
  }
}
function safeSetStorage(obj) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
  } catch (e) {
    console.error('[DevAnalytics] storage set error', e);
  }
}
function ensureStorage() {
  const base = safeGetStorage();
  if (!base) {
    const initial = {
      totalVisits: 0,
      uniqueDays: [],
      sessions: [],
      gridConfigs: {},
      gameStats: { wins: 0, losses: 0, abandoned: 0 },
      events: []
    };
    safeSetStorage(initial);
    return initial;
  }
  return base;
}

// Check secret combo based on gameSettings if present, otherwise derive from DOM
function isDevMode() {
  try {
    // Prefer window.gameSettings if available
    if (typeof window.gameSettings === 'object' && window.gameSettings !== null) {
      return window.gameSettings.rows === SECRET_ROWS &&
             window.gameSettings.columns === SECRET_COLS &&
             window.gameSettings.mines === SECRET_MINES;
    }
    // Fallback to DOM inputs
    const rEl = document.getElementById('msRows');
    const cEl = document.getElementById('msCols');
    const mEl = document.getElementById('msMines');
    if (!rEl || !cEl || !mEl) return false;
    const r = Number(rEl.value);
    const c = Number(cEl.value);
    const m = Number(mEl.value);
    return r === SECRET_ROWS && c === SECRET_COLS && m === SECRET_MINES;
  } catch (e) {
    return false;
  }
}

// Session management
function startSession() {
  const data = ensureStorage();
  const today = new Date().toDateString();
  data.totalVisits = (data.totalVisits || 0) + 1;
  if (!data.uniqueDays.includes(today)) data.uniqueDays.push(today);
  const session = {
    id: `s_${Date.now()}`,
    timestamp: new Date().toISOString(),
    startTime: Date.now(),
    duration: 0,
    events: []
  };
  data.sessions = data.sessions || [];
  data.sessions.push(session);
  safeSetStorage(data);

  if (sessionInterval) clearInterval(sessionInterval);
  sessionInterval = setInterval(() => {
    const cur = safeGetStorage();
    if (!cur || !cur.sessions || cur.sessions.length === 0) return;
    const last = cur.sessions[cur.sessions.length - 1];
    last.duration = Math.floor((Date.now() - new Date(last.timestamp).getTime()) / 1000);
    safeSetStorage(cur);
  }, 30000);
}

function endSession() {
  const data = safeGetStorage();
  if (!data || !data.sessions || data.sessions.length === 0) return;
  const last = data.sessions[data.sessions.length - 1];
  last.duration = Math.floor((Date.now() - new Date(last.timestamp).getTime()) / 1000);
  safeSetStorage(data);
  if (sessionInterval) clearInterval(sessionInterval);
  sessionInterval = null;
}

// Attach hooks to existing game functions (best-effort)
function attachHooks() {
  try {
    const gName = 'generateBoard';
    const originalGen = window[gName] || null;
    if (typeof originalGen === 'function' && !originalGen.__dev_hooked) {
      const wrapped = function(...args) {
        try {
          const data = ensureStorage();
          // prefer gameSettings if available
          const cfgRows = (window.gameSettings && window.gameSettings.rows) || Number((document.getElementById('msRows')||{}).value) || 0;
          const cfgCols = (window.gameSettings && window.gameSettings.columns) || Number((document.getElementById('msCols')||{}).value) || 0;
          const cfgMines = (window.gameSettings && window.gameSettings.mines) || Number((document.getElementById('msMines')||{}).value) || 0;
          const cfg = `${cfgRows}x${cfgCols}_${cfgMines}mines`;
          data.gridConfigs[cfg] = (data.gridConfigs[cfg] || 0) + 1;
          data.events = data.events || [];
          data.events.push({ t: new Date().toISOString(), type: 'generateBoard', cfg });
          safeSetStorage(data);
        } catch (e) {
          console.error('[DevAnalytics] generateBoard hook error', e);
        }
        return originalGen.apply(this, args);
      };
      wrapped.__dev_hooked = true;
      window[gName] = wrapped;
    }
  } catch (e) {
    console.warn('[DevAnalytics] could not hook generateBoard', e);
  }

  // Hook common win/lose handlers (best-effort)
  try {
    const wins = ['onWin', 'handleWin', 'playerWon'];
    const losses = ['onLose', 'handleLose', 'playerLost'];
    wins.forEach(name => {
      if (typeof window[name] === 'function' && !window[name].__dev_hooked) {
        const orig = window[name];
        const wrapped = function(...args) {
          try {
            const data = ensureStorage();
            data.gameStats.wins = (data.gameStats.wins || 0) + 1;
            data.events = data.events || [];
            data.events.push({ t: new Date().toISOString(), type: 'win', fn: name });
            safeSetStorage(data);
          } catch (e) { console.error('[DevAnalytics] win hook error', e); }
          return orig.apply(this, args);
        };
        wrapped.__dev_hooked = true;
        window[name] = wrapped;
      }
    });
    losses.forEach(name => {
      if (typeof window[name] === 'function' && !window[name].__dev_hooked) {
        const orig = window[name];
        const wrapped = function(...args) {
          try {
            const data = ensureStorage();
            data.gameStats.losses = (data.gameStats.losses || 0) + 1;
            data.events = data.events || [];
            data.events.push({ t: new Date().toISOString(), type: 'loss', fn: name });
            safeSetStorage(data);
          } catch (e) { console.error('[DevAnalytics] loss hook error', e); }
          return orig.apply(this, args);
        };
        wrapped.__dev_hooked = true;
        window[name] = wrapped;
      }
    });
  } catch (e) {
    console.warn('[DevAnalytics] could not attach win/lose hooks', e);
  }

  // beforeunload to finalize session and record event
  if (!attachHooks._beforeUnloadAttached) {
    window.addEventListener('beforeunload', () => {
      try {
        endSession();
        const data = safeGetStorage();
        if (data) {
          data.events = data.events || [];
          data.events.push({ t: new Date().toISOString(), type: 'beforeunload' });
          safeSetStorage(data);
        }
      } catch (e) {}
    });
    attachHooks._beforeUnloadAttached = true;
  }
}

// Panel UI
function createPanel() {
  const old = document.getElementById(PANEL_ID);
  if (old) old.remove();

  const data = safeGetStorage() || ensureStorage();

  const panel = document.createElement('div');
  panel.id = PANEL_ID;
  panel.style.position = 'fixed';
  panel.style.top = '18px';
  panel.style.right = '18px';
  panel.style.background = 'rgba(10,10,12,0.96)';
  panel.style.color = '#b7ffb7';
  panel.style.fontFamily = 'ui-monospace, SFMono-Regular, Menlo, Monaco, "Roboto Mono", monospace';
  panel.style.padding = '12px';
  panel.style.borderRadius = '8px';
  panel.style.border = '2px solid #1bff1b';
  panel.style.zIndex = 999999;
  panel.style.maxWidth = '420px';
  panel.style.fontSize = '13px';
  panel.style.lineHeight = '1.4';
  panel.style.boxShadow = '0 6px 24px rgba(0,0,0,0.6)';

  const recentSessions = (data.sessions || []).slice(-6).reverse().map(s => {
    const t = new Date(s.timestamp).toLocaleString();
    const d = s.duration || 0;
    return `${t} — ${d}s`;
  }).join('<br>') || 'No sessions';

  const gridTop = Object.entries(data.gridConfigs || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([k, v]) => `${k}: ${v} plays`)
    .join('<br>') || 'No data yet';

  panel.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
      <div style="font-weight:700">Developer Analytics</div>
      <button id="${PANEL_ID}-close" title="close" style="background:#1bff1b;border:none;color:#000;padding:4px 8px;border-radius:4px;cursor:pointer">Close</button>
    </div>
    <div style="margin-bottom:8px">
      <strong>Total Visits:</strong> ${data.totalVisits || 0}<br>
      <strong>Unique Days:</strong> ${((data.uniqueDays || []).length)}<br>
      <strong>Total Sessions:</strong> ${((data.sessions || []).length)}
    </div>
    <div style="margin-bottom:8px">
      <strong>Game Stats:</strong><br>
      Wins: ${data.gameStats.wins || 0}  Losses: ${data.gameStats.losses || 0}  Abandoned: ${data.gameStats.abandoned || 0}
    </div>
    <div style="margin-bottom:8px">
      <strong>Popular Configs:</strong><br>
      ${gridTop}
    </div>
    <div style="margin-bottom:8px">
      <strong>Recent Sessions:</strong><br>
      ${recentSessions}
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button id="${PANEL_ID}-export" style="background:#222;border:1px solid #1bff1b;color:#1bff1b;padding:6px 8px;border-radius:4px;cursor:pointer">Export JSON</button>
      <button id="${PANEL_ID}-clear" style="background:#8b0000;border:none;color:#fff;padding:6px 8px;border-radius:4px;cursor:pointer">Clear Data</button>
    </div>
  `;

  document.body.appendChild(panel);

  const closeBtn = document.getElementById(`${PANEL_ID}-close`);
  if (closeBtn) closeBtn.addEventListener('click', hidePanel);

  const exportBtn = document.getElementById(`${PANEL_ID}-export`);
  if (exportBtn) exportBtn.addEventListener('click', () => {
    const payload = safeGetStorage();
    if (!payload) return;
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'polyweave-analytics.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });

  const clearBtn = document.getElementById(`${PANEL_ID}-clear`);
  if (clearBtn) clearBtn.addEventListener('click', () => {
    if (!confirm('Clear all developer analytics data?')) return;
    safeSetStorage({
      totalVisits: 0,
      uniqueDays: [],
      sessions: [],
      gridConfigs: {},
      gameStats: { wins: 0, losses: 0, abandoned: 0 },
      events: []
    });
    createPanel();
  });
}

function showPanel() {
  if (!isDevMode()) {
    console.warn('[DevAnalytics] secret config not active; panel blocked');
    return;
  }
  if (!document.getElementById(PANEL_ID)) createPanel();
}
function hidePanel() {
  const el = document.getElementById(PANEL_ID);
  if (el) el.remove();
}

// Public API exposed on window
const DevAnalytics = {
  isDevMode,
  startSession,
  endSession,
  showPanel,
  hidePanel,
  ensureStorage,
  logEvent: function(type, detail) {
    try {
      const data = ensureStorage();
      data.events = data.events || [];
      data.events.push({ t: new Date().toISOString(), type, detail });
      safeSetStorage(data);
    } catch (e) {
      console.error('[DevAnalytics] logEvent error', e);
    }
  },
  exportData: function() { return safeGetStorage(); },
  clearData: function() {
    safeSetStorage({
      totalVisits: 0,
      uniqueDays: [],
      sessions: [],
      gridConfigs: {},
      gameStats: { wins: 0, losses: 0, abandoned: 0 },
      events: []
    });
    hidePanel();
  }
};
window.DevAnalytics = DevAnalytics;

// Lightweight dynamic listener that's always active
function setupDynamicChecks() {
  // Always listen for 'D' - toggle panel only when secret is met
  window.addEventListener('keydown', (e) => {
    if ((e.key === 'd' || e.key === 'D')) {
      if (!isDevMode()) {
        console.info('[DevAnalytics] secret combo not met');
        return;
      }
      // If not initialized, initialize tracking hooks and session
      if (!analyticsInitialized) {
        ensureStorage();
        startSession();
        attachHooks();
        analyticsInitialized = true;
        console.info('[DevAnalytics] activated (press D to toggle panel)');
      }
      // Toggle panel
      if (document.getElementById(PANEL_ID)) hidePanel();
      else showPanel();
    }
  });

  // Optionally watch for changes to the DOM fields and auto-start when combo becomes active
  // (low-frequency observer to avoid heavy work)
  let lastCheck = 0;
  function periodicCheck() {
    const now = Date.now();
    if (now - lastCheck < 1000) return;
    lastCheck = now;
    if (isDevMode() && !analyticsInitialized) {
      ensureStorage();
      startSession();
      attachHooks();
      analyticsInitialized = true;
      console.info('[DevAnalytics] activated via periodic check');
    }
  }
  // run periodic check on interval
  const periodicTimer = setInterval(periodicCheck, 1500);
  // stop interval if page is unloaded
  window.addEventListener('beforeunload', () => clearInterval(periodicTimer));
}

// recheckAndInit exposed for callers (app can call after newGame)
DevAnalytics.recheckAndInit = function recheckAndInit() {
  if (isDevMode() && !analyticsInitialized) {
    ensureStorage();
    startSession();
    attachHooks();
    analyticsInitialized = true;
    console.info('[DevAnalytics] tracking started via recheck (press D to toggle panel)');
  } else if (!isDevMode()) {
    console.info('[DevAnalytics] recheck: secret combo not met');
  } else {
    console.info('[DevAnalytics] recheck: already initialized');
  }
};

// Auto-setup lightweight listeners immediately
try {
  setupDynamicChecks();
  // small friendly console hint
  console.info('[DevAnalytics] loaded (press D to check secret combo)');
} catch (e) {
  console.error('[DevAnalytics] setup failed', e);
}
