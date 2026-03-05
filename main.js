const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const AgentManager = require('./agentManager');
const SessionScanner = require('./sessionScanner');  // Task 3A-4
const { adaptAgentToDashboard } = require('./dashboardAdapter');
const errorHandler = require('./errorHandler');
const Ajv = require('ajv');
const { getWindowSizeForAgents, checkSessionActive } = require('./utils');

// =====================================================
// Claude CLI 훅 자동 등록
// =====================================================
const HOOK_SERVER_PORT = 47821;

/**
 * Claude CLI 설정 파일 경로 가져오기
 */
function getClaudeConfigPath() {
  return path.join(os.homedir(), '.claude', 'settings.json');
}

/**
 * Claude CLI 설정 파일 읽기
 */
function readClaudeConfig() {
  try {
    const configPath = getClaudeConfigPath();
    if (fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, 'utf-8');
      return JSON.parse(content);
    }
  } catch (error) {
    debugLog(`[Hook] Claude 설정 읽기 실패: ${error.message}`);
  }
  return {};
}

/**
 * Claude CLI 설정 파일 쓰기
 */
function writeClaudeConfig(config) {
  try {
    const configPath = getClaudeConfigPath();
    const dir = path.dirname(configPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
    debugLog('[Hook] Claude 설정 파일 업데이트 완료');
    return true;
  } catch (error) {
    debugLog(`[Hook] Claude 설정 쓰기 실패: ${error.message}`);
    return false;
  }
}

/**
 * hook.js 절대 경로 가져오기
 */
function getHookScriptPath() {
  return path.join(__dirname, 'hook.js').replace(/\\/g, '/');
}

/**
 * 훅이 이미 등록되어 있는지 확인
 */
function isHookRegistered() {
  const config = readClaudeConfig();
  const HTTP_HOOK_URL = `http://localhost:${HOOK_SERVER_PORT}/hook`;

  if (!config.hooks) {
    return false;
  }

  // HTTP 훅이 올바르게 등록되어 있는지 확인
  const hookEvents = ['SessionStart', 'PreToolUse', 'PostToolUse'];
  for (const event of hookEvents) {
    if (config.hooks[event]) {
      if (!Array.isArray(config.hooks[event])) return false;
      const hookStr = JSON.stringify(config.hooks[event]);
      // HTTP 훅 URL이 포함되어 있고, type이 http인지 확인
      if (hookStr.includes(HTTP_HOOK_URL) && hookStr.includes('"type":"http"')) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Claude CLI 훅 자동 등록
 */
function registerClaudeHooks() {
  debugLog('[Hook] Claude CLI 훅 등록 상태 확인...');

  if (isHookRegistered()) {
    debugLog('[Hook] ✓ 훅이 이미 등록되어 있습니다.');
    return true;
  }

  debugLog('[Hook] 훅 등록 시작...');

  const hookPath = getHookScriptPath();
  const config = readClaudeConfig();

  config.hooks = config.hooks || {};

  // HTTP 훅: Node 프로세스 스폰 없이 Claude가 직접 HTTP POST
  const HTTP_HOOK_URL = `http://localhost:${HOOK_SERVER_PORT}/hook`;
  const hookEvents = [
    'SessionStart', 'SessionEnd', 'UserPromptSubmit',
    'PreToolUse', 'PostToolUse', 'PostToolUseFailure',
    'Stop', 'TaskCompleted', 'PermissionRequest', 'Notification',
    'SubagentStart', 'SubagentStop', 'TeammateIdle',
    'ConfigChange', 'WorktreeCreate', 'WorktreeRemove',
    'PreCompact'
  ];

  for (const event of hookEvents) {
    config.hooks[event] = [
      {
        matcher: "*",
        hooks: [
          {
            type: "http",
            url: HTTP_HOOK_URL
          }
        ]
      }
    ];
  }

  // 이전 버전에서 등록되었을 수 있는 유효하지 않은 훅 제거
  if (config.hooks['InstructionsLoaded']) {
    delete config.hooks['InstructionsLoaded'];
  }

  if (writeClaudeConfig(config)) {
    debugLog('[Hook] ✅ Claude CLI 훅 등록 완료!');
    console.log('\n✅ Claude CLI 훅이 자동 등록되었습니다.');
    console.log('이제 Claude Code를 사용하면 자동으로 연결됩니다.\n');
    return true;
  }

  debugLog('[Hook] ❌ 훅 등록 실패');
  return false;
}

/**
 * 대시보드 서버 시작
 */
function startDashboardServer() {
  if (dashboardServer) {
    debugLog('[Dashboard] 서버가 이미 실행 중입니다.');
    return;
  }

  debugLog('[Dashboard] 서버 시작 중...');

  try {
    const serverModule = require('./dashboard-server.js');

    // AgentManager와 SessionScanner 연결
    if (agentManager) {
      serverModule.setAgentManager(agentManager);
    }
    if (sessionScanner) {
      serverModule.setSessionScanner(sessionScanner);
    }

    // 서버 시작
    dashboardServer = serverModule.startServer();

    debugLog('[Dashboard] ✅ 서버 시작 완료 (port 3000)');
    console.log('\n✅ 대시보드 서버가 시작되었습니다.');
    console.log('📊 http://localhost:3000 에서 접속 가능합니다.\n');
  } catch (error) {
    debugLog(`[Dashboard] ❌ 시작 실패: ${error.message}`);
  }
}

/**
 * 대시보드 서버 정리
 */
function stopDashboardServer() {
  if (dashboardServer) {
    debugLog('[Dashboard] 서버 정리 중...');
    try {
      dashboardServer.close(() => {
        debugLog('[Dashboard] 서버 정리 완료');
      });
    } catch (error) {
      debugLog(`[Dashboard] 정리 중 오류: ${error.message}`);
    }
    dashboardServer = null;
  }
}

// 에러 로그 파일로 저장
const errorLogPath = path.join(__dirname, 'startup-error.log');
const originalConsoleError = console.error;
console.error = (...args) => {
  const message = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)).join(' ');
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}\n`;

  // 파일에 저장
  try {
    fs.appendFileSync(errorLogPath, logMessage);
  } catch (e) { }

  // 원래 console.error도 호출
  originalConsoleError.apply(console, args);
};

// 전역 에러 핸들러
process.on('uncaughtException', (error) => {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] UNCAUGHT EXCEPTION: ${error.message}\n${error.stack}\n`;
  try {
    fs.appendFileSync(errorLogPath, logMessage);
  } catch (e) { }
});

process.on('unhandledRejection', (reason, promise) => {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] UNHANDLED REJECTION: ${reason}\n`;
  try {
    fs.appendFileSync(errorLogPath, logMessage);
  } catch (e) { }
});

// Dashboard WebSocket broadcast (사용하지 않음 - 별도 서버 불필요)
function broadcastUpdate(type, data) {
  // 현재는 사용하지 않음. 필요시 구현
}

// Debug logging to file
const debugLog = (msg) => {
  const timestamp = new Date().toISOString();
  const logMsg = `[${timestamp}] ${msg}\n`;
  fs.appendFileSync(path.join(__dirname, 'debug.log'), logMsg);
  console.log(msg);
};

let mainWindow;
let agentManager = null;
let sessionScanner = null;  // Task 3A-4
let keepAliveInterval = null;
let dashboardServer = null;  // Dashboard 서버 인스턴스

function resizeWindowForAgents(agentsOrCount) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const { width } = getWindowSizeForAgents(agentsOrCount);
  const bounds = mainWindow.getBounds();
  // Only adjust width here, height is managed by DOM observer
  if (width !== bounds.width) {
    mainWindow.setBounds({ ...bounds, width: width });
  }
  const info = Array.isArray(agentsOrCount) ? agentsOrCount.length : agentsOrCount;
  console.log(`[Main] Window width → ${width} (${info} agents based layout)`);
}

// =====================================================
// 윈도우 생성
// =====================================================
ipcMain.on('resize-window', (e, size) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    const { width, height, y } = mainWindow.getBounds();

    // 렌더러에서 보내온 실측 사이즈 반영 (가로/세로 모두)
    // 약간의 안전 여백(Padding) 부여 및 최소 사이즈 보장
    const newWidth = Math.max(220, Math.ceil(size.width ? size.width + 30 : width));
    const newHeight = Math.max(300, Math.ceil(size.height ? size.height + 40 : height));

    if (newWidth === width && newHeight === height) return;

    // Bottom-anchor logic: calculate Y position change
    const diffHeight = newHeight - height;
    const newY = Math.max(0, y - diffHeight);

    mainWindow.setBounds({
      width: newWidth,
      height: newHeight,
      y: newY
    });

    debugLog(`[Main] IPC Resize → ${newWidth}x${newHeight} (y: ${newY})`);
  }
});

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
    resizable: true, // programmatic setBounds works better when true
    movable: true,
    focusable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  mainWindow.loadFile('index.html');

  // errorHandler에 mainWindow 등록
  errorHandler.setMainWindow(mainWindow);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.setAlwaysOnTop(true, 'screen-saver');
    // 개발자 도구 열기 (디버깅용)
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  });

  // 작업표시줄 복구 폴링 (250ms)
  startKeepAlive();
}

function startKeepAlive() {
  if (keepAliveInterval) return; // 이미 실행 중이면 중복 생성 방지
  keepAliveInterval = setInterval(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setAlwaysOnTop(true, 'screen-saver');
    }
  }, 250);
  debugLog('[Main] Keep-alive interval started');
}

function stopKeepAlive() {
  if (keepAliveInterval) {
    clearInterval(keepAliveInterval);
    keepAliveInterval = null;
    debugLog('[Main] Keep-alive interval stopped');
  }
}

// =====================================================
// Dashboard Dashboard Window Management
// =====================================================
let dashboardWindow = null;
let dashboardAuthToken = null;

function generateAuthToken() {
  const crypto = require('crypto');
  return crypto.randomBytes(32).toString('hex');
}

function createDashboardWindow() {
  if (dashboardWindow && !dashboardWindow.isDestroyed()) {
    debugLog('[MissionControl] Window already open, focusing existing window');
    dashboardWindow.focus();
    return { success: true, alreadyOpen: true };
  }

  try {
    // Get display dimensions for positioning
    const { width, height } = screen.getPrimaryDisplay().workAreaSize;

    // Create window with secure settings
    dashboardWindow = new BrowserWindow({
      width: Math.floor(width * 0.8),
      height: Math.floor(height * 0.8),
      x: Math.floor(width * 0.1),
      y: Math.floor(height * 0.1),
      title: '픽셀 에이전트 데스크',
      backgroundColor: '#ffffff',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false,
        preload: path.join(__dirname, 'dashboardPreload.js')
      }
    });

    // Load the HTML file directly (no HTTP server needed)
    dashboardWindow.loadFile('dashboard.html');

    // Log when window is ready
    dashboardWindow.webContents.on('did-finish-load', () => {
      debugLog('[MissionControl] Window loaded successfully');

      // Send initial agent data
      if (agentManager) {
        const agents = agentManager.getAllAgents();
        const adaptedAgents = agents.map(agent => adaptAgentToDashboard(agent));
        debugLog(`[MissionControl] Sending ${adaptedAgents.length} agents to dashboard`);
        dashboardWindow.webContents.send('dashboard-initial-data', adaptedAgents);
      }
    });

    // Handle navigation errors
    dashboardWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
      debugLog(`[MissionControl] Failed to load: ${errorCode} - ${errorDescription}`);
      dashboardWindow.destroy();
      dashboardWindow = null;
      dashboardAuthToken = null;
    });

    // Clean up when window is closed
    dashboardWindow.on('closed', () => {
      debugLog('[MissionControl] Window closed');
      dashboardWindow = null;
      dashboardAuthToken = null;
    });

    debugLog('[MissionControl] Window created');

    return { success: true };

  } catch (error) {
    debugLog(`[MissionControl] Failed to create window: ${error.message}`);
    dashboardWindow = null;
    dashboardAuthToken = null;
    return { success: false, error: error.message };
  }
}

function closeMissionControlWindow() {
  if (dashboardWindow && !dashboardWindow.isDestroyed()) {
    dashboardWindow.close();
    debugLog('[MissionControl] Window closed by request');
  }
  dashboardWindow = null;
  dashboardAuthToken = null;
}


// =====================================================
// 앱 설정
// ============================================================
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('high-dpi-support', '1');
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.commandLine.appendSwitch('disable-logging');
app.commandLine.appendSwitch('log-level', '3');
process.env.ELECTRON_DISABLE_LOGGING = '1';
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-software-rasterizer');

// =====================================================
// Claude CLI 훅 자동 등록 & 프로세스 PID 모니터링
// =====================================================

// =====================================================
// HTTP 훅 서버 — Claude CLI가 SessionStart/End를 POST로 알려줌
// =====================================================
// agentManager 준비 전에 도착한 SessionStart를 임시 보관
const pendingSessionStarts = [];
// 세션별 첫 PreToolUse 여부 추적 (초기화 탐색 무시용)
const firstPreToolUseDone = new Map(); // sessionId → boolean
// PostToolUse 이후 Done 전환용 타이머 (TaskCompleted 훅이 안 오는 경우 대비)
// PostToolUse idle 타이머 삭제됨 — Stop 훅이 도구 체이닝 이후에만 발생하므로 불필요


function processHookEvent(data) {
  const event = data.hook_event_name;
  const sessionId = data.session_id || data.sessionId;
  if (!sessionId) return;

  debugLog(`[Hook] ${event} session=${sessionId.slice(0, 8)}`);

  // SessionStart가 누락되어도 첫 이벤트에서 즉시 에이전트 생성 (범용 fallback)
  if (agentManager && event !== 'SessionStart' && event !== 'SessionEnd') {
    const existing = agentManager.getAgent(sessionId);
    if (!existing) {
      debugLog(`[Hook] Auto-create from ${event}: ${sessionId.slice(0, 8)}`);
      handleSessionStart(sessionId, data.cwd || '', 0, false, false, 'Waiting', null, {
        jsonlPath: data.transcript_path || null,
        model: data.model || null,
        permissionMode: data.permission_mode || null,
      });
    }
  }

  switch (event) {
    case 'SessionStart': {
      const sessionSource = data.source || 'startup';
      const sessionMeta = {
        jsonlPath: data.transcript_path || null,
        model: data.model || null,
        permissionMode: data.permission_mode || null,
        source: sessionSource,
        agentType: data.agent_type || null,
      };

      // compact/resume/clear: 기존 에이전트가 있으면 업데이트만 (중복 생성 방지)
      if (sessionSource !== 'startup' && agentManager) {
        const existing = agentManager.getAgent(sessionId);
        if (existing) {
          agentManager.updateAgent({
            ...existing, sessionId, state: 'Waiting',
            jsonlPath: sessionMeta.jsonlPath || existing.jsonlPath,
            model: sessionMeta.model || existing.model,
            source: sessionSource,
          }, 'hook');
          debugLog(`[Hook] SessionStart (${sessionSource}) → updated existing agent ${sessionId.slice(0, 8)}`);
          break;
        }
      }

      handleSessionStart(sessionId, data.cwd || '', data._pid || 0, false, false, 'Waiting', null, sessionMeta);
      break;
    }

    case 'SessionEnd':
      // reason 필드 로깅 (종료 사유 추적)
      if (data.reason) {
        debugLog(`[Hook] SessionEnd reason: ${data.reason} for ${sessionId.slice(0, 8)}`);
      }
      handleSessionEnd(sessionId);
      break;

    case 'UserPromptSubmit':
      // 사용자가 메시지 제출 → Thinking (범용 fallback이 이미 에이전트 생성 보장)
      firstPreToolUseDone.delete(sessionId);
      if (agentManager) {
        const agent = agentManager.getAgent(sessionId);
        if (agent) {
          agentManager.updateAgent({ ...agent, sessionId, state: 'Thinking' }, 'hook');
        }
      }
      break;

    case 'Stop':
    case 'TaskCompleted': {
      // Claude 응답 완료 → 즉시 Done (도구 체이닝 중에는 Stop이 오지 않음)

      firstPreToolUseDone.delete(sessionId);
      if (event === 'TaskCompleted' && data.task_id) {
        debugLog(`[Hook] TaskCompleted: task=${data.task_id} subject="${data.task_subject || ''}" by ${data.teammate_name || sessionId.slice(0, 8)}`);
      }
      if (agentManager) {
        const agent = agentManager.getAgent(sessionId);
        const lastMsg = data.last_assistant_message || null;
        if (agent) {
          agentManager.updateAgent({ ...agent, sessionId, state: 'Done', currentTool: null, lastMessage: lastMsg }, 'hook');
        }
      }
      break;
    }

    case 'PreToolUse': {
      // 첫 PreToolUse: 세션 초기화 탐색 → 무시
      if (!firstPreToolUseDone.has(sessionId)) {
        firstPreToolUseDone.set(sessionId, true);
        debugLog(`[Hook] PreToolUse ignored (first = session init)`);
      } else if (agentManager) {
        const agent = agentManager.getAgent(sessionId);
        if (agent) {
          agentManager.updateAgent({ ...agent, sessionId, state: 'Working', currentTool: data.tool_name || null }, 'hook');
        }
      }
      break;
    }

    case 'PostToolUse': {
      if (agentManager && firstPreToolUseDone.has(sessionId)) {
        const agent = agentManager.getAgent(sessionId);
        if (agent) {
          // Task 3A-3: tool_response.token_usage 추출
          const tokenUsage = data.tool_response && data.tool_response.token_usage;
          if (tokenUsage) {
            const cur = agent.tokenUsage || { inputTokens: 0, outputTokens: 0, estimatedCost: 0 };
            const inputTokens = cur.inputTokens + (tokenUsage.input_tokens || 0);
            const outputTokens = cur.outputTokens + (tokenUsage.output_tokens || 0);
            const MODEL_PRICING = {
              'claude-opus-4-5': { input: 15 / 1_000_000, output: 75 / 1_000_000 },
              'claude-sonnet-4-5': { input: 3 / 1_000_000, output: 15 / 1_000_000 },
              'claude-haiku-4-5': { input: 0.8 / 1_000_000, output: 4 / 1_000_000 },
              'claude-opus-4-6': { input: 15 / 1_000_000, output: 75 / 1_000_000 },
              'claude-sonnet-4-6': { input: 3 / 1_000_000, output: 15 / 1_000_000 },
              'claude-haiku-4-6': { input: 0.8 / 1_000_000, output: 4 / 1_000_000 },
            };
            const DEFAULT_PRICING = { input: 3 / 1_000_000, output: 15 / 1_000_000 };
            const pricing = MODEL_PRICING[agent.model] || DEFAULT_PRICING;
            const estimatedCost = inputTokens * pricing.input + outputTokens * pricing.output;
            agentManager.updateAgent({
              ...agent, sessionId, state: 'Thinking', currentTool: null,
              tokenUsage: { inputTokens, outputTokens, estimatedCost: Math.round(estimatedCost * 10000) / 10000 }
            }, 'hook');
          } else {
            agentManager.updateAgent({ ...agent, sessionId, state: 'Thinking', currentTool: null }, 'hook');
          }
        }
      }
      break;
    }

    case 'PostToolUseFailure':
      // 도구 실패 → Help (에러 정보 포함)

      if (agentManager) {
        const agent = agentManager.getAgent(sessionId);
        if (agent) agentManager.updateAgent({ ...agent, sessionId, state: 'Help', currentTool: data.tool_name || null }, 'hook');
      }
      break;

    case 'PermissionRequest':
      // 권한 요청 → Help

      if (agentManager) {
        const agent = agentManager.getAgent(sessionId);
        if (agent) agentManager.updateAgent({ ...agent, sessionId, state: 'Help', currentTool: data.tool_name || null }, 'hook');
      }
      break;

    case 'Notification': {
      // notification_type에 따라 상태 구분
      const notifType = data.notification_type;
      let notifState = 'Waiting'; // 기본: 일반 알림은 대기 상태 유지
      if (notifType === 'permission_prompt' || notifType === 'elicitation_dialog') {
        notifState = 'Help'; // 사용자 개입 필요
      }

      if (agentManager) {
        const agent = agentManager.getAgent(sessionId);
        if (agent) agentManager.updateAgent({ ...agent, sessionId, state: notifState }, 'hook');
      }
      break;
    }

    case 'SubagentStart': {
      // agent_id가 공식 필드, subagent_session_id는 폴백
      const subId = data.agent_id || data.subagent_session_id;
      if (subId) {
        handleSessionStart(subId, data.cwd || '', 0, false, true, 'Working', sessionId, {
          jsonlPath: data.agent_transcript_path || data.transcript_path || null,
          agentType: data.agent_type || null,
        });
        debugLog(`[Hook] SubagentStart: ${subId.slice(0, 8)} type=${data.agent_type || 'unknown'} parent=${sessionId.slice(0, 8)}`);
      }
      break;
    }

    case 'SubagentStop': {
      const subId = data.agent_id || data.subagent_session_id;
      if (subId) {
        // last_assistant_message 저장 후 제거
        if (data.last_assistant_message && agentManager) {
          const subAgent = agentManager.getAgent(subId);
          if (subAgent) {
            agentManager.updateAgent({ ...subAgent, lastMessage: data.last_assistant_message, state: 'Done' }, 'hook');
          }
        }
        handleSessionEnd(subId);
      }
      break;
    }

    case 'TeammateIdle': {
      // 에이전트 팀 멤버가 작업을 멈추고 기다리는 중 -> Waiting
      const teammateName = data.teammate_name || null;
      const teamName = data.team_name || null;
      if (agentManager) {
        const agent = agentManager.getAgent(sessionId);
        if (agent) {
          agentManager.updateAgent({
            ...agent, state: 'Waiting', isTeammate: true,
            teammateName, teamName, currentTool: null
          }, 'hook');
        } else {
          // 신규 팀원 감지 시
          handleSessionStart(sessionId, data.cwd || '', 0, true, false, 'Waiting', null, {
            jsonlPath: data.transcript_path || null,
            teammateName, teamName,
          });
        }
      }
      debugLog(`[Hook] TeammateIdle: ${sessionId.slice(0, 8)} name=${teammateName} team=${teamName}`);
      break;
    }

    case 'PreCompact': {
      // 컨텍스트 압축 감지 — trigger: "manual" | "auto"
      const trigger = data.trigger || 'unknown';
      debugLog(`[Hook] PreCompact (${trigger}) for ${sessionId.slice(0, 8)}`);
      // auto compact는 컨텍스트 윈도우가 꽉 찼다는 신호
      if (agentManager) {
        const agent = agentManager.getAgent(sessionId);
        if (agent) {
          agentManager.updateAgent({ ...agent, sessionId, state: 'Thinking' }, 'hook');
        }
      }
      break;
    }

    case 'ConfigChange':
    case 'WorktreeCreate':
    case 'WorktreeRemove':
      debugLog(`[Hook] Meta info: ${event} for ${sessionId.slice(0, 8)}`);
      break;

    default:
      debugLog(`[Hook] Unknown: ${event} — ${JSON.stringify(data).slice(0, 150)}`);
  }
}

function startHookServer() {
  const http = require('http');

  // P1-3: JSON Schema for hook validation (Task 3A-1: 실제 Claude 훅 필드 기반으로 수정)
  const hookSchema = {
    type: 'object',
    required: ['hook_event_name'],
    properties: {
      hook_event_name: {
        type: 'string',
        enum: [
          'SessionStart', 'SessionEnd', 'UserPromptSubmit',
          'PreToolUse', 'PostToolUse', 'PostToolUseFailure',
          'Stop', 'TaskCompleted', 'PermissionRequest', 'Notification',
          'SubagentStart', 'SubagentStop', 'TeammateIdle',
          'ConfigChange', 'WorktreeCreate', 'WorktreeRemove', 'PreCompact',
          'InstructionsLoaded'  // 새 이벤트
        ]
      },
      session_id: { type: 'string' },
      transcript_path: { type: 'string' },  // ★ 실제 Claude 훅 필드 (jsonlPath 소스)
      cwd: { type: 'string' },
      permission_mode: { type: 'string' },  // ★ 권한 모드
      tool_name: { type: 'string' },  // ★ 'tool' → 'tool_name' (실제 필드명)
      tool_input: { type: 'object' },
      tool_response: { type: 'object' },  // ★ token_usage 포함
      source: { type: 'string' },  // ★ startup/resume/clear/compact
      model: { type: 'string' },  // ★ 사용 모델
      agent_type: { type: 'string' },  // ★ --agent 타입
      agent_id: { type: 'string' },
      notification_type: { type: 'string' },  // ★ Notification: permission_prompt/idle_prompt/auth_success/elicitation_dialog
      last_assistant_message: { type: 'string' },  // ★ Stop/SubagentStop: 마지막 응답 메시지
      reason: { type: 'string' },  // ★ SessionEnd: 종료 사유
      teammate_name: { type: 'string' },  // ★ TeammateIdle/TaskCompleted: 팀원 이름
      team_name: { type: 'string' },  // ★ TeammateIdle/TaskCompleted: 팀 이름
      task_id: { type: 'string' },  // ★ TaskCompleted: 작업 ID
      task_subject: { type: 'string' },  // ★ TaskCompleted: 작업 제목
      trigger: { type: 'string' },  // ★ PreCompact: manual/auto
      agent_transcript_path: { type: 'string' },  // ★ SubagentStop: 서브에이전트 트랜스크립트
      _pid: { type: 'number' },
      _timestamp: { type: 'number' }
    },
    additionalProperties: true  // Claude가 새 필드 추가할 수 있으므로 유지
  };

  const ajv = new Ajv();
  const validateHook = ajv.compile(hookSchema);

  const server = http.createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/hook') {
      res.writeHead(404); res.end(); return;
    }

    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));

      try {
        const data = JSON.parse(body);
        debugLog(`[Hook] ← ${data.hook_event_name || '?'} session=${(data.session_id || '').slice(0, 8) || '?'}`);

        // P1-3: Validate JSON schema
        const isValid = validateHook(data);
        if (!isValid) {
          errorHandler.capture(new Error('Invalid hook data'), {
            code: 'E010',
            category: 'VALIDATION',
            severity: 'WARNING',
            details: validateHook.errors
          });
          debugLog(`[Hook] Validation FAILED for ${data.hook_event_name}: ${JSON.stringify(validateHook.errors)}`);
          return;
        }

        processHookEvent(data);
      } catch (e) {
        errorHandler.capture(e, {
          code: 'E010',
          category: 'PARSE',
          severity: 'WARNING'
        });
        debugLog(`[Hook] Parse error: ${e.message}`);
      }
    });
  });

  server.on('error', (e) => debugLog(`[Hook] Server error: ${e.message}`));
  server.listen(HOOK_SERVER_PORT, '127.0.0.1', () => {
    debugLog(`[Hook] HTTP hook server listening on port ${HOOK_SERVER_PORT}`);
  });
}
// =====================================================
// 앱 재시작 시 활성 세션 복구 및 PID 매칭 (영구 저장소 활용)
// =====================================================
function getPersistedStatePath() {
  return path.join(os.homedir(), '.pixel-agent-desk', 'state.json');
}

function savePersistedState() {
  if (!agentManager) return;
  const statePath = getPersistedStatePath();
  const dir = path.dirname(statePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const agents = agentManager.getAllAgents();
  const state = {
    agents: agents,
    pids: Array.from(sessionPids.entries())
  };
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf-8');
}

function recoverExistingSessions() {
  if (!agentManager) return;
  const statePath = getPersistedStatePath();

  if (!fs.existsSync(statePath)) {
    debugLog('[Recover] No persisted state found.');
    return;
  }

  try {
    const raw = fs.readFileSync(statePath, 'utf-8');
    const state = JSON.parse(raw);
    const savedAgents = state.agents || [];
    const savedPids = new Map((state.pids || []));

    let recoveredCount = 0;
    for (const agent of savedAgents) {
      const pid = savedPids.get(agent.id);

      // 1단계: 기본 PID 존재 확인
      let isAlive = false;
      if (pid) {
        try {
          process.kill(pid, 0);
          isAlive = true;
        } catch (e) {
          isAlive = false;
        }
      }

      if (!isAlive) {
        debugLog(`[Recover] Skipped dead agent (pid gone): ${agent.id.slice(0, 8)}`);
        continue;
      }

      // 2단계: PID 재사용 방지 — transcript_path가 있으면 그 파일이 실제 열려있는지 확인
      // (비동기이므로 일단 복구 후 liveness checker가 2초 내 재검증)
      // Windows에서는 process.kill(pid, 0)만으로는 PID 재사용 문제 해결 불가
      // → transcript_path 기반 재검증을 liveness checker에 위임
      sessionPids.set(agent.id, pid);
      firstPreToolUseDone.set(agent.id, true);

      agentManager.updateAgent({
        sessionId: agent.id,
        projectPath: agent.projectPath,
        displayName: agent.displayName,
        state: agent.state,
        jsonlPath: agent.jsonlPath,
        isTeammate: agent.isTeammate,
        isSubagent: agent.isSubagent,
        parentId: agent.parentId
      }, 'recover');

      recoveredCount++;
      debugLog(`[Recover] Restored: ${agent.id.slice(0, 8)} (${agent.displayName}) state=${agent.state} pid=${pid} (will re-verify via liveness)`);
    }

    debugLog(`[Recover] Done — ${recoveredCount} session(s) restored from state.json`);
  } catch (e) {
    errorHandler.capture(e, {
      code: 'E009',
      category: 'FILE_IO',
      severity: 'WARNING'
    });
    debugLog(`[Recover] Error reading or parsing state.json: ${e.message}`);
  }

  // hooks.jsonl 리플레이는 더 이상 불필요 (HTTP 훅 전환으로 hook.js가 기록하지 않음)
  // 이전 버전에서 남은 hooks.jsonl 파일 정리
  const hooksPath = path.join(os.homedir(), '.pixel-agent-desk', 'hooks.jsonl');
  if (fs.existsSync(hooksPath)) {
    try {
      fs.writeFileSync(hooksPath, '');
      debugLog('[Recover] Cleared legacy hooks.jsonl');
    } catch (e) { }
  }

  // 복구된 에이전트 state.json 초기화 (재시작 시 이전 상태가 누적되지 않도록)
  try {
    fs.writeFileSync(statePath, JSON.stringify({ agents: [], pids: [] }, null, 2), 'utf-8');
    debugLog('[Recover] state.json reset after recovery');
  } catch (e) { }
}

// =====================================================
// 생사 확인: Multi-Tier Liveness Checker with Auto-Recovery
// =====================================================
const sessionPids = new Map(); // sessionId → 실제 claude 프로세스 PID

/**
 * Tier 1: Basic process existence check using process.kill(pid, 0)
 */
async function checkLivenessTier1(agentId, pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return false;
  }
}

// Tier 2/3/Recovery 삭제 — transcript 기반 즉시 판정으로 대체

/**
 * transcript_path로 해당 세션의 Claude PID를 정확히 찾는 함수
 * Linux/macOS: lsof -t <path> → 파일을 열고 있는 프로세스 PID
 * Windows: Get-CimInstance로 claude 프로세스 목록 (transcript 기반 매칭 불가)
 * @param {string|null} jsonlPath - transcript_path
 * @param {(pid: number|null) => void} callback
 */
function detectClaudePidByTranscript(jsonlPath, callback) {
  const { execFile } = require('child_process');

  if (!jsonlPath) {
    detectClaudePidsFallback(callback);
    return;
  }

  const resolved = jsonlPath.startsWith('~')
    ? path.join(os.homedir(), jsonlPath.slice(1))
    : jsonlPath;

  if (process.platform === 'win32') {
    // Windows: Restart Manager API로 transcript 파일을 잠근 프로세스 PID 정확 탐지
    const psScript = `
$f = '${resolved.replace(/\\/g, '\\\\').replace(/'/g, "''")}'
if (-not (Test-Path $f)) { exit }
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices; using System.Runtime.InteropServices.ComTypes;
public static class RM {
  [StructLayout(LayoutKind.Sequential)] public struct UP { public uint pid; public FILETIME st; }
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public struct PI {
    public UP Process; [MarshalAs(UnmanagedType.ByValTStr,SizeConst=256)] public string App;
    [MarshalAs(UnmanagedType.ByValTStr,SizeConst=64)] public string Svc;
    public uint AT; public uint AS; public uint TS; [MarshalAs(UnmanagedType.Bool)] public bool R;
  }
  [DllImport("rstrtmgr.dll",CharSet=CharSet.Unicode)] public static extern int RmStartSession(out uint h,int f,string k);
  [DllImport("rstrtmgr.dll")] public static extern int RmEndSession(uint h);
  [DllImport("rstrtmgr.dll",CharSet=CharSet.Unicode)] public static extern int RmRegisterResources(uint h,uint nF,string[] fs,uint nA,IntPtr a,uint nS,IntPtr s);
  [DllImport("rstrtmgr.dll")] public static extern int RmGetList(uint h,out uint need,ref uint cnt,[In,Out] PI[] info,out uint reasons);
}
'@ -ErrorAction SilentlyContinue
$h=[uint32]0; [void][RM]::RmStartSession([ref]$h,0,[Guid]::NewGuid().ToString())
[void][RM]::RmRegisterResources($h,1,@($f),0,[IntPtr]::Zero,0,[IntPtr]::Zero)
$n=[uint32]0; $c=[uint32]0; $r=[uint32]0
[void][RM]::RmGetList($h,[ref]$n,[ref]$c,$null,[ref]$r)
if($n -gt 0){ $c=$n; $i=New-Object RM+PI[] $c; [void][RM]::RmGetList($h,[ref]$n,[ref]$c,$i,[ref]$r); $i|ForEach-Object{$_.Process.pid} }
[void][RM]::RmEndSession($h)
`;
    execFile('powershell.exe', ['-NoProfile', '-Command', psScript], { timeout: 5000 }, (err, stdout) => {
      if (!err && stdout) {
        const pids = stdout.trim().split('\n').map(p => parseInt(p.trim(), 10)).filter(p => !isNaN(p) && p > 0);
        if (pids.length > 0) {
          debugLog(`[PID] Windows RM: transcript ${path.basename(resolved)} → pid=${pids[0]}`);
          return callback(pids[0]);
        }
      }
      // Restart Manager 실패 시 기존 폴백
      detectClaudePidsFallback(callback);
    });
  } else {
    // Linux/macOS: lsof로 파일 핸들 기반 탐지
    execFile('lsof', ['-t', resolved], { timeout: 3000 }, (err, stdout) => {
      if (!err && stdout) {
        const pids = stdout.trim().split('\n').map(p => parseInt(p.trim(), 10)).filter(p => !isNaN(p) && p > 0);
        if (pids.length > 0) {
          return callback(pids[0]);
        }
      }
      detectClaudePidsFallback(callback);
    });
  }
}

/**
 * 폴백: 프로세스 이름/커맨드라인으로 Claude PID 탐지 (다중 세션 시 부정확할 수 있음)
 */
function detectClaudePidsFallback(callback) {
  const { execFile } = require('child_process');
  if (process.platform === 'win32') {
    const psCmd = `Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like '*claude*' -and ($_.Name -eq 'node.exe' -or $_.Name -eq 'claude.exe') } | Select-Object -ExpandProperty ProcessId`;
    execFile('powershell.exe', ['-NoProfile', '-Command', psCmd], { timeout: 6000 }, (err, stdout) => {
      if (err || !stdout) return callback(null);
      const pids = stdout.trim().split('\n').map(p => parseInt(p.trim(), 10)).filter(p => !isNaN(p) && p > 0);
      callback(pids.length > 0 ? pids : null);
    });
  } else {
    execFile('pgrep', ['-f', 'claude'], { timeout: 3000 }, (err, stdout) => {
      if (err || !stdout) return callback(null);
      const pids = stdout.trim().split('\n').map(p => parseInt(p.trim(), 10)).filter(p => !isNaN(p) && p > 0);
      callback(pids.length > 0 ? pids : null);
    });
  }
}

// PID 미등록 에이전트 재탐지 (중복 실행 방지)
const _pidRetryRunning = new Set();
function retryPidDetection(sessionId) {
  if (_pidRetryRunning.has(sessionId) || sessionPids.has(sessionId)) return;
  _pidRetryRunning.add(sessionId);

  // transcript_path가 있으면 정확한 1:1 매칭, 없으면 폴백
  const agent = agentManager ? agentManager.getAgent(sessionId) : null;
  const jsonlPath = agent ? agent.jsonlPath : null;

  detectClaudePidByTranscript(jsonlPath, (result) => {
    _pidRetryRunning.delete(sessionId);
    if (!result) return;

    // 단일 PID(lsof) 또는 PID 배열(폴백)
    if (typeof result === 'number') {
      sessionPids.set(sessionId, result);
      debugLog(`[Live] PID assigned via transcript: ${sessionId.slice(0, 8)} → pid=${result}`);
    } else if (Array.isArray(result)) {
      const registeredPids = new Set(sessionPids.values());
      const newPid = result.find(p => !registeredPids.has(p));
      if (newPid) {
        sessionPids.set(sessionId, newPid);
        debugLog(`[Live] PID assigned via fallback: ${sessionId.slice(0, 8)} → pid=${newPid}`);
      }
    }
  });
}

function startLivenessChecker() {
  const INTERVAL = 2000;   // 2초
  const GRACE_MS = 10000;  // 등록 후 10초 유예 (PID 탐지 완료 대기)

  setInterval(async () => {
    if (!agentManager) return;
    for (const agent of agentManager.getAllAgents()) {
      // Grace 기간 내 스킵
      if (agent.firstSeen && Date.now() - agent.firstSeen < GRACE_MS) continue;

      const pid = sessionPids.get(agent.id);
      if (!pid) {
        retryPidDetection(agent.id);
        // PID 없이 Grace 기간도 지난 에이전트 → 일정 시간 경과 시 제거
        const noPidAge = Date.now() - (agent.firstSeen || 0);
        if (noPidAge > GRACE_MS + 10000) { // Grace + 10초 추가 대기
          debugLog(`[Live] ${agent.id.slice(0, 8)} no PID for ${Math.round(noPidAge/1000)}s → removing`);
          agentManager.removeAgent(agent.id);
        }
        continue;
      }

      // 1차: process.kill(pid, 0)으로 즉시 확인
      const alive = await checkLivenessTier1(agent.id, pid);
      if (alive) {
        if (agent.state === 'Offline') {
          agentManager.updateAgent({ ...agent, state: 'Waiting' }, 'live');
        }
        continue;
      }

      // 2차: PID 실패 → transcript_path로 즉시 재확인
      // PID가 바뀌었을 수 있음 (재시작 등) — lsof로 현재 PID 재탐지
      debugLog(`[Live] ${agent.id.slice(0, 8)} pid=${pid} dead → re-checking via transcript`);
      const newPid = await new Promise((resolve) => {
        detectClaudePidByTranscript(agent.jsonlPath, (result) => {
          if (typeof result === 'number') resolve(result);
          else if (Array.isArray(result)) {
            const registeredPids = new Set(sessionPids.values());
            resolve(result.find(p => !registeredPids.has(p) && p !== pid) || null);
          } else resolve(null);
        });
      });

      if (newPid) {
        // PID 갱신 → 살림
        sessionPids.set(agent.id, newPid);
        debugLog(`[Live] ${agent.id.slice(0, 8)} PID renewed: ${pid} → ${newPid}`);
        if (agent.state === 'Offline') {
          agentManager.updateAgent({ ...agent, state: 'Waiting' }, 'live');
        }
      } else {
        // transcript에서도 못 찾음 → 진짜 죽음 → 즉시 제거
        debugLog(`[Live] ${agent.id.slice(0, 8)} confirmed dead → removing`);
        sessionPids.delete(agent.id);
        agentManager.removeAgent(agent.id);
      }
    }
  }, INTERVAL);
}


function handleSessionStart(sessionId, cwd, pid = 0, isTeammate = false, isSubagent = false, initialState = 'Waiting', parentId = null, meta = {}) {
  if (!agentManager) {
    pendingSessionStarts.push({ sessionId, cwd, ts: Date.now(), isTeammate, isSubagent, initialState, parentId, meta });
    debugLog(`[Hook] SessionStart queued: ${sessionId.slice(0, 8)}`);
    return;
  }
  const displayName = cwd ? path.basename(cwd) : 'Agent';
  // Task 3A-2: transcript_path, model, permissionMode, source, agentType 저장
  agentManager.updateAgent({
    sessionId, projectPath: cwd, displayName, state: initialState,
    jsonlPath: meta.jsonlPath || null,
    model: meta.model || null,
    permissionMode: meta.permissionMode || null,
    source: meta.source || null,
    agentType: meta.agentType || null,
    teammateName: meta.teammateName || null,
    teamName: meta.teamName || null,
    isTeammate, isSubagent, parentId
  }, 'http');
  debugLog(`[Hook] SessionStart → agent: ${sessionId.slice(0, 8)} (${displayName}) ${isTeammate ? '[Team]' : ''} ${isSubagent ? '[Sub]' : ''} (Parent: ${parentId ? parentId.slice(0, 8) : 'none'})`);

  if (pid > 0) {
    sessionPids.set(sessionId, pid);
    return;
  }
  detectClaudePidByTranscript(meta.jsonlPath || null, (result) => {
    if (!result) return;
    if (typeof result === 'number') {
      sessionPids.set(sessionId, result);
      debugLog(`[Hook] SessionStart PID via transcript: ${sessionId.slice(0, 8)} → pid=${result}`);
    } else if (Array.isArray(result)) {
      const registeredPids = new Set(sessionPids.values());
      const newPid = result.find(p => !registeredPids.has(p));
      if (newPid) {
        sessionPids.set(sessionId, newPid);
        debugLog(`[Hook] SessionStart PID via fallback: ${sessionId.slice(0, 8)} → pid=${newPid}`);
      }
    }
  });
}

function cleanupAgentResources(sessionId) {
  firstPreToolUseDone.delete(sessionId);
  sessionPids.delete(sessionId);
  debugLog(`[Cleanup] Resources cleared for ${sessionId.slice(0, 8)}`);
}

function handleSessionEnd(sessionId) {
  cleanupAgentResources(sessionId);  // 통합 리소스 정리

  if (!agentManager) return;
  const agent = agentManager.getAgent(sessionId);
  if (agent) {
    debugLog(`[Hook] SessionEnd → removing agent ${sessionId.slice(0, 8)}`);
    // SessionEnd JSONL 기록은 sessionend_hook.js가 담당 (이중 기록 방지)
    agentManager.removeAgent(sessionId);
  } else {
    debugLog(`[Hook] SessionEnd for unknown agent ${sessionId.slice(0, 8)}`);
  }
}



app.whenReady().then(() => {
  debugLog('========== Pixel Agent Desk started ==========');

  // 0. Claude CLI 훅 자동 등록 (npm install 누락 대비)
  registerClaudeHooks();

  // 1. 에이전트 매니저 즉시 시작 (UI 뜨기 전부터 데이터 수집)
  agentManager = new AgentManager();
  agentManager.start();

  // Task 3A-4: 세션 스캐너 시작 (60초마다 JSONL → 토큰/비용 보완)
  sessionScanner = new SessionScanner(agentManager, debugLog);
  sessionScanner.start(60_000);

  // 2. 백그라운드 서비스 시작
  startHookServer();       // HTTP 훅 서버 (47821 포트)
  startDashboardServer();  // 대시보드 웹 서버 (3000 포트)
  startLivenessChecker();  // 프로세스 생사 확인

  // 3. 앱 재시작 시 기존 활성 세션 복구 시작
  recoverExistingSessions();

  // 4. 테스트용 에이전트 (Main, Sub, Team 골고루)
  const ENABLE_TEST_AGENTS = false; // 테스트 에이전트 온/오프 체크 옵션
  if (ENABLE_TEST_AGENTS) {
    const testSubagents = [
      { sessionId: 'test-main-1', projectPath: 'E:/projects/core-engine', displayName: 'Main Service', state: 'Working', isSubagent: false, isTeammate: false },
      { sessionId: 'test-sub-1', projectPath: 'E:/projects/core-engine', displayName: 'Refactor Helper', state: 'Working', isSubagent: true, isTeammate: false },
      { sessionId: 'test-team-1', projectPath: 'E:/projects/web-ui', displayName: 'UI Architect', state: 'Waiting', isSubagent: false, isTeammate: true },
      { sessionId: 'test-team-2', projectPath: 'E:/projects/web-ui', displayName: 'CSS Specialist', state: 'Working', isSubagent: false, isTeammate: true }
    ];
    testSubagents.forEach(agent => agentManager.updateAgent(agent, 'test'));
  }

  // 5. UI 생성
  createWindow();

  // Renderer가 준비되면 현재 상태 전송
  ipcMain.once('renderer-ready', () => {
    debugLog('[Main] renderer-ready event received!');

    // 에이전트 매니저 이벤트 연결 (이미 생성된 상태이므로 여기서 연결)
    agentManager.on('agent-added', (agent) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('agent-added', agent);
        resizeWindowForAgents(agentManager.getAllAgents());
      }
      // Forward to Dashboard window
      if (dashboardWindow && !dashboardWindow.isDestroyed()) {
        const adaptedAgent = adaptAgentToDashboard(agent);
        dashboardWindow.webContents.send('dashboard-agent-added', adaptedAgent);
      }
      savePersistedState();
    });

    agentManager.on('agent-updated', (agent) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('agent-updated', agent);
        // 상태 변화로 Sub/Team이 생기면 창 크기가 달라질 수 있으므로 업데이트
        resizeWindowForAgents(agentManager.getAllAgents());
      }
      // Forward to Dashboard window
      if (dashboardWindow && !dashboardWindow.isDestroyed()) {
        const adaptedAgent = adaptAgentToDashboard(agent);
        dashboardWindow.webContents.send('dashboard-agent-updated', adaptedAgent);
      }
      savePersistedState();
    });

    agentManager.on('agent-removed', (data) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('agent-removed', data);
        resizeWindowForAgents(agentManager.getAllAgents());
      }
      // Forward to Dashboard window
      if (dashboardWindow && !dashboardWindow.isDestroyed()) {
        dashboardWindow.webContents.send('dashboard-agent-removed', data);
      }
      savePersistedState();
    });

    agentManager.on('agents-cleaned', (data) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('agents-cleaned', data);
        resizeWindowForAgents(agentManager.getAllAgents());
      }
      // Forward to Dashboard window
      if (dashboardWindow && !dashboardWindow.isDestroyed()) {
        dashboardWindow.webContents.send('dashboard-agent-removed', { type: 'batch', ...data });
      }
      savePersistedState();
    });

    // 준비 전에 도착했던 세션 및 복구된 데이터 전송
    const allAgents = agentManager.getAllAgents();
    if (allAgents.length > 0) {
      debugLog(`[Main] Sending ${allAgents.length} agents to newly ready renderer`);
      allAgents.forEach(agent => {
        mainWindow.webContents.send('agent-added', agent);
      });
      resizeWindowForAgents(allAgents);
    }

    while (pendingSessionStarts.length > 0) {
      const { sessionId, cwd, isTeammate, isSubagent, initialState, parentId, meta } = pendingSessionStarts.shift();
      handleSessionStart(sessionId, cwd, 0, isTeammate, isSubagent, initialState || 'Waiting', parentId, meta || {});
    }
  });

  // 에이전트 정리는 liveness checker(3초 PID 체크)가 전담
  // 별도 타이머 기반 정리 불필요 — PID가 살아있으면 절대 안 죽임

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (agentManager) agentManager.stop();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (agentManager) agentManager.stop();
  stopDashboardServer(); // 대시보드 서버 정리
  stopKeepAlive(); // 앱 종료 시 interval 정리

  // 모든 Map 리소스 정리
  firstPreToolUseDone.clear();
  sessionPids.clear();
  pendingSessionStarts.length = 0;

  debugLog('[Main] All Map resources cleaned up');
});

// =====================================================
// IPC 핸들러
// =====================================================

ipcMain.on('get-work-area', (event) => {
  event.reply('work-area-response', screen.getPrimaryDisplay().workArea);
});

ipcMain.on('get-avatars', (event) => {
  try {
    const charsDir = path.join(__dirname, 'public', 'characters');
    if (fs.existsSync(charsDir)) {
      const files = fs.readdirSync(charsDir);
      event.reply('avatars-response', files);
    } else {
      event.reply('avatars-response', []);
    }
  } catch (e) {
    errorHandler.capture(e, {
      code: 'E003',
      category: 'FILE_IO',
      severity: 'WARNING'
    });
    debugLog(`[Main] get-avatars error: ${e.message}`);
    event.reply('avatars-response', []);
  }
});

ipcMain.on('constrain-window', (event, bounds) => {
  const wa = screen.getPrimaryDisplay().workArea;
  const { width, height } = mainWindow.getBounds();
  mainWindow.setPosition(
    Math.max(wa.x, Math.min(bounds.x, wa.x + wa.width - width)),
    Math.max(wa.y, Math.min(bounds.y, wa.y + wa.height - height))
  );
});

ipcMain.on('get-all-agents', (event) => event.reply('all-agents-response', agentManager?.getAllAgents() ?? []));
ipcMain.on('get-agent-stats', (event) => event.reply('agent-stats-response', agentManager?.getStats() ?? {}));

// 에이전트 수동 퇴근 IPC 핸들러
ipcMain.on('dismiss-agent', (event, agentId) => {
  if (agentManager) agentManager.dismissAgent(agentId);
});

// 터미널 포커스 공용 함수 — PID에서 부모 체인을 5단계까지 올라가 터미널 창 탐색
function focusTerminalByPid(pid, label = 'Main') {
  const { execFile } = require('child_process');
  // execFile: 쉘을 거치지 않으므로 인용부호 이스케이프 불필요
  const psScript = `
$memberDef = '[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);' +
  '[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);' +
  '[DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);'
Add-Type -MemberDefinition $memberDef -Name W -Namespace FocusUtil -ErrorAction SilentlyContinue
$tpid = ${pid}
$hwnd = [IntPtr]::Zero
for ($i = 0; $i -lt 5; $i++) {
  $p = Get-Process -Id $tpid -ErrorAction SilentlyContinue
  if ($p -and $p.MainWindowHandle -ne [IntPtr]::Zero) {
    $hwnd = $p.MainWindowHandle
    break
  }
  $pp = (Get-CimInstance Win32_Process -Filter "ProcessId = $tpid" -ErrorAction SilentlyContinue).ParentProcessId
  if (-not $pp -or $pp -eq 0 -or $pp -eq $tpid) { break }
  $tpid = $pp
}
if ($hwnd -ne [IntPtr]::Zero) {
  if ([FocusUtil.W]::IsIconic($hwnd)) { [FocusUtil.W]::ShowWindow($hwnd, 9) | Out-Null }
  [FocusUtil.W]::SetForegroundWindow($hwnd) | Out-Null
}
`;
  execFile('powershell.exe', ['-NoProfile', '-Command', psScript], { timeout: 5000 }, (err) => {
    if (err) debugLog(`[${label}] Focus error: ${err.message}`);
  });
}

// 터미널 포커스 IPC 핸들러 (실제 PID 활용)
ipcMain.on('focus-terminal', (event, agentId) => {
  const pid = sessionPids.get(agentId);
  if (!pid) {
    debugLog(`[Main] Focus: no PID for agent=${agentId.slice(0, 8)}`);
    return;
  }
  debugLog(`[Main] Focus requested for agent=${agentId.slice(0, 8)} pid=${pid}`);
  focusTerminalByPid(pid, 'Main');
});

// =====================================================
// Dashboard IPC Handlers
// =====================================================

// Open Dashboard dashboard
ipcMain.handle('open-web-dashboard', async (event) => {
  try {
    const result = createDashboardWindow();
    return result;
  } catch (error) {
    debugLog(`[MissionControl] Error opening dashboard: ${error.message}`);
    return { success: false, error: error.message };
  }
});

// Close Dashboard dashboard
ipcMain.handle('close-web-dashboard', async (event) => {
  try {
    closeMissionControlWindow();
    return { success: true };
  } catch (error) {
    debugLog(`[MissionControl] Error closing dashboard: ${error.message}`);
    return { success: false, error: error.message };
  }
});

// Check if Dashboard dashboard is open
ipcMain.handle('is-web-dashboard-open', async (event) => {
  return {
    isOpen: dashboardWindow !== null && !dashboardWindow.isDestroyed()
  };
});

// Get error logs (P0-3: Error Recovery)
ipcMain.handle('get-error-logs', async () => {
  try {
    const logs = errorHandler.readRecentLogs(100);
    return { success: true, logs };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Execute recovery action (P0-3: Error Recovery)
ipcMain.handle('execute-recovery-action', async (event, errorId, action) => {
  try {
    debugLog(`[ErrorRecovery] Executing action: ${action} for error: ${errorId}`);

    // TODO: 각 액션별 구현 필요
    switch (action) {
      case 'retry':
        // 재시도 로직
        break;
      case 'reset':
        // 초기화 로직
        break;
      case 'view_logs':
        // 로그 뷰어 열기
        break;
      default:
        break;
    }

    return { success: true };
  } catch (error) {
    errorHandler.capture(error, {
      code: 'E000',
      category: 'UNKNOWN',
      severity: 'ERROR'
    });
    return { success: false, error: error.message };
  }
});

// Handle focus-agent command from Dashboard
ipcMain.on('dashboard-focus-agent', (event, agentId) => {
  const pid = sessionPids.get(agentId);
  if (!pid) {
    debugLog(`[Dashboard] Focus: no PID for agent=${agentId.slice(0, 8)}`);
    return;
  }
  debugLog(`[Dashboard] Focus requested for agent=${agentId.slice(0, 8)} pid=${pid}`);
  focusTerminalByPid(pid, 'Dashboard');
});

// Handle dismiss-agent command from Dashboard
ipcMain.on('dashboard-dismiss-agent', (event, agentId) => {
  debugLog(`[MissionControl] Dismiss requested for agent: ${agentId.slice(0, 8)}`);
  if (agentManager) {
    agentManager.dismissAgent(agentId);
  }
});

// Get current agents for Dashboard
ipcMain.on('get-dashboard-agents', (event) => {
  if (agentManager) {
    const agents = agentManager.getAllAgents();
    const adaptedAgents = agents.map(agent => adaptAgentToDashboard(agent));
    event.reply('dashboard-agents-response', adaptedAgents);
  } else {
    event.reply('dashboard-agents-response', []);
  }
});

// Task 3A-4: 앱 종료 시 SessionScanner 정리
app.on('before-quit', () => {
  if (sessionScanner) {
    sessionScanner.stop();
    debugLog('[Main] SessionScanner stopped');
  }
  if (agentManager) {
    agentManager.stop();
  }
});
