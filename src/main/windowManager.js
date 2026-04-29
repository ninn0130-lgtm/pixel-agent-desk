/**
 * Window Manager
 * Main window, dashboard window, keep-alive, resize, dashboard server management
 */

const { BrowserWindow, screen, shell } = require('electron');
const path = require('path');

function createWindowManager({ agentManager, sessionScanner, heatmapScanner, debugLog, adaptAgentToDashboard, errorHandler, getWindowSizeForAgents }) {
  let mainWindow = null;
  let dashboardWindow = null;
  let pipWindow = null;
  let keepAliveInterval = null;
  let dashboardServer = null;

  function resizeWindowForAgents(agentsOrCount) {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const { width, height } = getWindowSizeForAgents(agentsOrCount);
    const bounds = mainWindow.getBounds();
    if (width === bounds.width && height === bounds.height) return;
    const wa = screen.getDisplayMatching(bounds).bounds;
    const dh = height - bounds.height;
    const newY = Math.max(wa.y, Math.min(bounds.y - dh, wa.y + wa.height - height));
    const newX = Math.max(wa.x, Math.min(bounds.x, wa.x + wa.width - width));
    mainWindow.setBounds({ x: newX, y: newY, width, height });
    const info = Array.isArray(agentsOrCount) ? agentsOrCount.length : agentsOrCount;
    debugLog(`[Main] Window → ${width}x${height} (${info} agents)`);
  }

  function createWindow() {
    const { width, height } = screen.getPrimaryDisplay().workAreaSize;
    const winSize = getWindowSizeForAgents(0);

    mainWindow = new BrowserWindow({
      width: winSize.width,
      height: winSize.height,
      x: Math.round((width - winSize.width) / 2),
      y: Math.round((height - winSize.height) / 2),
      transparent: true,
      frame: false,
      hasShadow: false,
      backgroundColor: '#00000000',
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      movable: true,
      focusable: false,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload.js'),
        nodeIntegration: false,
        contextIsolation: true
      }
    });

    mainWindow.loadFile(path.join(__dirname, '..', '..', 'index.html'));

    errorHandler.setMainWindow(mainWindow);

    // Constrain window to display bounds after drag (multi-monitor aware)
    let constraining = false;
    mainWindow.on('moved', () => {
      if (constraining || mainWindow.isDestroyed()) return;
      const b = mainWindow.getBounds();
      const wa = screen.getDisplayMatching(b).bounds;
      const cx = Math.max(wa.x, Math.min(b.x, wa.x + wa.width - b.width));
      const cy = Math.max(wa.y, Math.min(b.y, wa.y + wa.height - b.height));
      if (cx !== b.x || cy !== b.y) {
        constraining = true;
        mainWindow.setPosition(cx, cy);
        constraining = false;
      }
    });

    mainWindow.once('ready-to-show', () => {
      mainWindow.show();
      mainWindow.setAlwaysOnTop(true, 'screen-saver');
      // DevTools: only when --dev argument or npm run dev
      if (process.argv.includes('--dev')) {
        mainWindow.webContents.openDevTools({ mode: 'detach' });
      }
    });

    // Main window (avatar) closed -> close dashboard and quit app
    mainWindow.on('closed', () => {
      mainWindow = null;
      closeDashboardWindow();
      const { app } = require('electron');
      app.quit();
    });

    startKeepAlive();
  }

  function startKeepAlive() {
    if (keepAliveInterval) return;
    keepAliveInterval = setInterval(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setAlwaysOnTop(true, 'screen-saver');
      }
    }, 5000);
    debugLog('[Main] Keep-alive interval started');
  }

  function stopKeepAlive() {
    if (keepAliveInterval) {
      clearInterval(keepAliveInterval);
      keepAliveInterval = null;
      debugLog('[Main] Keep-alive interval stopped');
    }
  }

  function createDashboardWindow() {
    if (dashboardWindow && !dashboardWindow.isDestroyed()) {
      debugLog('[MissionControl] Window already open, focusing existing window');
      if (dashboardWindow.isMinimized()) {
        dashboardWindow.restore();
      }
      dashboardWindow.focus();
      return { success: true, alreadyOpen: true };
    }

    try {
      const { width, height } = screen.getPrimaryDisplay().workAreaSize;

      // Map(864) + sidebar(240) + padding = 1104+, height: generous for pixel art
      const minDashW = 1280;
      const minDashH = 980;
      const dashW = Math.min(Math.max(minDashW, Math.floor(width * 0.9)), width - 20);
      const dashH = Math.min(Math.max(minDashH, Math.floor(height * 0.95)), height - 10);

      dashboardWindow = new BrowserWindow({
        width: dashW,
        height: dashH,
        x: Math.floor((width - dashW) / 2),
        y: Math.floor((height - dashH) / 2),
        title: 'Pixel Agent Desk',
        backgroundColor: '#ffffff',
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: false,
          preload: path.join(__dirname, '..', 'dashboardPreload.js')
        }
      });

      // Load via HTTP server (instead of file://) — needed for serving office module static files
      dashboardWindow.loadURL('http://localhost:3000/');

      dashboardWindow.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url);
        return { action: 'deny' };
      });

      dashboardWindow.webContents.on('did-finish-load', () => {
        debugLog('[MissionControl] Window loaded successfully');

        if (agentManager) {
          const agents = agentManager.getAllAgents();
          const adaptedAgents = agents.map(agent => adaptAgentToDashboard(agent));
          debugLog(`[MissionControl] Sending ${adaptedAgents.length} agents to dashboard`);
          dashboardWindow.webContents.send('dashboard-initial-data', adaptedAgents);
        }
      });

      dashboardWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
        debugLog(`[MissionControl] Failed to load: ${errorCode} - ${errorDescription}`);
        dashboardWindow.destroy();
        dashboardWindow = null;
      });

      dashboardWindow.on('closed', () => {
        debugLog('[MissionControl] Window closed');
        dashboardWindow = null;
        closePipWindow();
      });

      debugLog('[MissionControl] Window created');
      return { success: true };

    } catch (error) {
      debugLog(`[MissionControl] Failed to create window: ${error.message}`);
      dashboardWindow = null;
        return { success: false, error: error.message };
    }
  }

  function notifyDashboardPipState(isOpen) {
    if (dashboardWindow && !dashboardWindow.isDestroyed()) {
      dashboardWindow.webContents.send('pip-state-changed', isOpen);
    }
  }

  // ─── PiP Window ───
  function createPipWindow() {
    debugLog('[PIP-DBG] createPipWindow ENTRY');
    if (pipWindow && !pipWindow.isDestroyed()) {
      pipWindow.focus();
      debugLog('[PIP-DBG] createPipWindow re-focus existing');
      return;
    }

    const { width, height } = screen.getPrimaryDisplay().workAreaSize;
    const pipW = 480;
    const pipH = 450;

    pipWindow = new BrowserWindow({
      width: pipW,
      height: pipH,
      x: width - pipW - 20,
      y: height - pipH - 20,
      frame: true,
      resizable: true,
      maximizable: false,
      title: 'Office PiP',
      backgroundColor: '#050709',
      autoHideMenuBar: true,
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false,
        devTools: true,
        preload: path.join(__dirname, '..', 'pipPreload.js')
      }
    });

    // Office map is 864x800 → aspect ratio 1.08
    pipWindow.setAspectRatio(864 / 800);

    // PiP runs with autoHideMenuBar:true, which removes Electron's default
    // F12 / Ctrl+Shift+I menu accelerators. Bind them explicitly via
    // before-input-event so DevTools can still be toggled for diagnostics.
    // [PIP-DBG TEMPORARY] Every keyDown is logged so we can see whether the
    // event reaches the webContents at all when the user presses F12 — to be
    // removed together with the auto-openDevTools below once root cause is
    // confirmed.
    pipWindow.webContents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return;
      debugLog(`[PIP-DBG] before-input-event keyDown key=${input.key} code=${input.code} ctrl=${input.control} meta=${input.meta} shift=${input.shift} alt=${input.alt}`);
      const isF12 = input.key === 'F12';
      const isCtrlShiftI = (input.control || input.meta) && input.shift &&
        (input.key === 'I' || input.key === 'i');
      if (isF12 || isCtrlShiftI) {
        if (pipWindow && !pipWindow.isDestroyed()) {
          pipWindow.webContents.toggleDevTools();
        }
        event.preventDefault();
      }
    });

    // [PIP-DBG TEMPORARY] DevTools auto-open with multiple redundant hooks.
    // cf5aa2b registered only `did-finish-load`, but the user reports zero
    // [PIP-DBG] markers in the main-process log — meaning that hook never
    // fired (or fired before the listener attached, or the renderer crashed
    // before reaching load completion). This block tries every reasonable
    // hook and falls back to a 3s safety timer so something will succeed.
    // REVERT this block (and the keyDown debugLog) once the bubble-label
    // diagnostic is complete.
    let _pipDevToolsOpened = false;
    function openPipDevToolsOnce(via) {
      if (_pipDevToolsOpened) return;
      if (!pipWindow || pipWindow.isDestroyed()) return;
      try {
        pipWindow.webContents.openDevTools({ mode: 'detach' });
        _pipDevToolsOpened = true;
        debugLog(`[PIP-DBG] Auto-opened DevTools (detach) via ${via}`);
      } catch (e) {
        debugLog(`[PIP-DBG] openDevTools failed via ${via}: ${e && e.message}`);
      }
    }

    pipWindow.once('ready-to-show', () => {
      if (!pipWindow || pipWindow.isDestroyed()) return;
      pipWindow.show();
      pipWindow.setAlwaysOnTop(true, 'floating');
      notifyDashboardPipState(true);
      debugLog('[PiP] Window shown');
      openPipDevToolsOnce('ready-to-show');
    });

    pipWindow.webContents.once('dom-ready', () => {
      debugLog('[PIP-DBG] webContents dom-ready');
      openPipDevToolsOnce('dom-ready');
    });

    pipWindow.webContents.once('did-finish-load', () => {
      debugLog('[PIP-DBG] webContents did-finish-load');
      openPipDevToolsOnce('did-finish-load');
    });

    // Safety net: if no other hook fired within 3s of window creation,
    // force-open DevTools so the user has SOMETHING to diagnose with.
    setTimeout(() => openPipDevToolsOnce('safety-timer-3s'), 3000);

    pipWindow.loadURL('http://localhost:3000/pip');

    pipWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
      debugLog(`[PiP] Failed to load: ${errorCode} - ${errorDescription}`);
      if (pipWindow && !pipWindow.isDestroyed()) pipWindow.destroy();
      pipWindow = null;
    });

    pipWindow.webContents.on('render-process-gone', (event, details) => {
      debugLog(`[PIP-DBG] render-process-gone reason=${details && details.reason} exitCode=${details && details.exitCode}`);
    });

    pipWindow.webContents.on('unresponsive', () => {
      debugLog('[PIP-DBG] webContents unresponsive');
    });

    pipWindow.on('closed', () => {
      pipWindow = null;
      notifyDashboardPipState(false);
      debugLog('[PiP] Window closed');
    });

    debugLog('[PiP] Window created');
  }

  function closePipWindow() {
    if (pipWindow && !pipWindow.isDestroyed()) {
      pipWindow.close();
    }
    pipWindow = null;
  }

  function focusDashboardWindow() {
    if (dashboardWindow && !dashboardWindow.isDestroyed()) {
      if (dashboardWindow.isMinimized()) dashboardWindow.restore();
      dashboardWindow.focus();
    }
  }

  function closeDashboardWindow() {
    closePipWindow();
    if (dashboardWindow && !dashboardWindow.isDestroyed()) {
      dashboardWindow.close();
      debugLog('[MissionControl] Window closed by request');
    }
    dashboardWindow = null;
  }

  function startDashboardServer() {
    if (dashboardServer) {
      debugLog('[Dashboard] Server is already running.');
      return;
    }

    debugLog('[Dashboard] Starting server...');

    try {
      const serverModule = require('../dashboard-server.js');

      if (agentManager) {
        serverModule.setAgentManager(agentManager);
      }
      if (sessionScanner) {
        serverModule.setSessionScanner(sessionScanner);
      }
      if (heatmapScanner) {
        serverModule.setHeatmapScanner(heatmapScanner);
      }

      dashboardServer = serverModule.startServer();

      debugLog('[Dashboard] Server started (port 3000)');
    } catch (error) {
      debugLog(`[Dashboard] Failed to start: ${error.message}`);
    }
  }

  function stopDashboardServer() {
    if (dashboardServer) {
      debugLog('[Dashboard] Shutting down server...');
      try {
        dashboardServer.close(() => {
          debugLog('[Dashboard] Server shutdown complete');
        });
      } catch (error) {
        debugLog(`[Dashboard] Error during shutdown: ${error.message}`);
      }
      dashboardServer = null;
    }
  }

  return {
    get mainWindow() { return mainWindow; },
    get dashboardWindow() { return dashboardWindow; },
    get pipWindow() { return pipWindow; },
    createWindow,
    startKeepAlive,
    stopKeepAlive,
    createDashboardWindow,
    closeDashboardWindow,
    createPipWindow,
    closePipWindow,
    focusDashboardWindow,
    startDashboardServer,
    stopDashboardServer,
    resizeWindowForAgents,
  };
}

module.exports = { createWindowManager };
