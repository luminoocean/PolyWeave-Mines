// dev-analytics.js
// Developer Analytics for Polyweave Mines
// Activate only when rows=6, columns=7, mines=67

(function globalDevAnalytics() {
  const STORAGE_KEY = 'polyweave_analytics_v1';
  const SECRET_ROWS = 6;
  const SECRET_COLS = 7;
  const SECRET_MINES = 67;
  const PANEL_ID = 'pw-dev-analytics-panel';

  // Utility
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
        events: [] // simple event log for diagnostics
      };
      safeSetStorage(initial);
      return initial;
    }
    return base;
  }

  // Check secret combo
  function isDevMode() {
    try {
      if (typeof gameSettings === 'undefined' || !gameSettings) return false;
      return gameSettings.rows === SECRET_ROWS &&
             gameSettings.columns === SECRET_COLS &&
             gameSettings.mines === SECRET_MINES;
    } catch (e) {
      return false;
    }
  }

  // Track visit + session
  let sessionInterval = null;
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

    // update duration periodically
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

  // Attach hooks into game lifecycle (best-effort, won't crash if functions absent)
  function attachHooks() {
    // Hook generateBoard
    try {
      const gName = 'generateBoard';
      const originalGen = window[gName] || null;
      if (typeof originalGen === 'function') {
        window[gName] = function wrappedGenerateBoard(...args) {
          try {
            const data = ensureStorage();
            const cfg = `${gameSettings.rows}x${gameSettings.columns}_${gameSettings.mines}mines`;
            data.gridConfigs[cfg] = (data.gridConfigs[cfg] || 0) + 1;
            data.events = data.events || [];
            data.events.push({ t: new Date().toISOString(), type: 'generateBoard', cfg });
            safeSetStorage(data);
          } catch (e) {
            console.error('[DevAnalytics] generateBoard hook error', e);
          }
          return originalGen.apply(this, args);
        };
      }
    } catch (e) {
      console.warn('[DevAnalytics] could not hook generateBoard', e);
    }

    // Hook game end events if present (win/lose)
    try {
      // common function names: onWin, onLose, endGame, revealAll
      const possibleWins = ['onWin', 'handleWin', 'playerWon'];
      const possibleLosses = ['onLose', 'handleLose', 'playerLost'];

      possibleWins.forEach(name => {
        if (typeof window[name] === 'function') {
          const orig = window[name];
          window[name] = function wrappedWin(...args) {
            try {
              const data = ensureStorage();
              data.gameStats.wins = (data.gameStats.wins || 0) + 1;
              data.events.push({ t: new Date().toISOString(), type: 'win', fn: name });
              safeSetStorage(data);
            } catch (e) {}
            return orig.apply(this, args);
          };
        }
      });

      possibleLosses.forEach(name => {
        if (typeof window[name] === 'function') {
          const orig = window[name];
          window[name] = function wrappedLose(...args) {
            try {
              const data = ensureStorage();
              data.gameStats.losses = (data.gameStats.losses || 0) + 1;
              data.events.push({ t: new Date().toISOString(), type: 'loss', fn: name });
              safeSetStorage(data);
            } catch (e) {}
            return orig.apply(this, args);
          };
        }
      });
    } catch (e) {
      console.warn('[DevAnalytics] could not attach win/lose hooks', e);
    }

    // Hook abandoned / nav away
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
  }

  // Developer Panel UI
  function createPanel() {
    // remove existing
    const old = document.getElementById(PANEL_ID);
    if (old) old.remove();

    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    const style = panel.style;
    style.position = 'fixed';
    style.top = '18px';
    style.right = '18px';
    style.background = 'rgba(12,12,12,0.95)';
    style.color = '#b7ffb7';
    style.fontFamily = 'ui-monospace, SFMono-Regular, Menlo, Monaco, "Roboto Mono", monospace';
    style.padding = '14px';
    style.borderRadius = '8px';
    style.border = '2px solid #1bff1b';
    style.zIndex = 999999;
    style.maxWidth = '420px';
    style.boxShadow = '0 6px 24px rgba(0,0,0,0.6)';
    style.fontSize = '13px';
    style.lineHeight = '1.4';

    // Content
    const data = safeGetStorage() || ensureStorage();
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

    document.getElementById(`${PANEL_ID}-close`).addEventListener('click', hidePanel);
    document.getElementById(`${PANEL_ID}-export`).addEventListener('click', () => {
      const payload = safeGetStorage();
      if (!payload) return;
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      // create temporary anchor to download
      const a = document.createElement('a');
      a.href = url;
      a.download = 'polyweave-analytics.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    });

    document.getElementById(`${PANEL_ID}-clear`).addEventListener('click', () => {
      if (!confirm('Clear all developer analytics data?')) return;
      safeSetStorage({
        totalVisits: 0,
        uniqueDays: [],
        sessions: [],
        gridConfigs: {},
        gameStats: { wins: 0, losses: 0, abandoned: 0 },
        events: []
      });
      // refresh panel
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

  // Public API (exposed on window for debugging)
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
    exportData: function() {
      const payload = safeGetStorage();
      return payload;
    },
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

  // Attach to window so your game code can call DevAnalytics.logEvent(...)
  window.DevAnalytics = DevAnalytics;

// Initialize lightweight hooks that check conditions dynamically
function setupDynamicChecks() {
  // Always listen for 'D' key - check conditions when pressed
  window.addEventListener('keydown', (e) => {
    if ((e.key === 'd' || e.key === 'D') && isDevMode()) {
      if (!document.getElementById(PANEL_ID)) {
        ensureStorage();
        if (!sessionInterval) startSession();
        attachHooks();
        showPanel();
        console.info('[DevAnalytics] activated (press D to toggle panel)');
      } else {
        hidePanel();
      }
    }
  });
}

// Always run lightweight setup
setupDynamicChecks();

// Make recheckAndInit actually start tracking when conditions are met
DevAnalytics.recheckAndInit = function() {
  if (isDevMode()) {
    ensureStorage();
    if (!sessionInterval) startSession();
    attachHooks();
    console.info('[DevAnalytics] tracking started via recheck');
  }
};

    // keyboard toggle: press D to toggle panel (only when secret is set)
    window.addEventListener('keydown', (e) => {
      if (e.key === 'd' || e.key === 'D') {
        if (document.getElementById(PANEL_ID)) hidePanel();
        else showPanel();
      }
    });

    console.info('[DevAnalytics] activated (press D to toggle panel)');
  }

  // Auto-init on DOMContentLoaded so gameSettings likely available
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(initIfSecret, 10);
  } else {
    document.addEventListener('DOMContentLoaded', initIfSecret);
  }

let analyticsInitialized = false;

DevAnalytics.recheckAndInit = function recheckAndInit() {
    if (isDevMode() && !analyticsInitialized) {
      initIfSecret();
      analyticsInitialized = true;
      console.info('[DevAnalytics] activated via recheck (press D to toggle panel)');
    }
  };

})();
