const { contextBridge, ipcRenderer } = require('electron');

// P1-5: 리스너 누적 방지 — 등록 전 기존 핸들러 제거
function safeOn(channel, callback) {
  ipcRenderer.removeAllListeners(channel);
  ipcRenderer.on(channel, (event, data) => callback(data));
}

contextBridge.exposeInMainWorld('electronAPI', {
  getWorkArea: () => {
    ipcRenderer.send('get-work-area');
    return new Promise(resolve => ipcRenderer.once('work-area-response', (_, d) => resolve(d)));
  },
  constrainWindow: (bounds) => ipcRenderer.send('constrain-window', bounds),
  rendererReady: () => ipcRenderer.send('renderer-ready'),

  // 에이전트 이벤트
  onAgentAdded: (cb) => safeOn('agent-added', cb),
  onAgentUpdated: (cb) => safeOn('agent-updated', cb),
  onAgentRemoved: (cb) => safeOn('agent-removed', cb),
  onAgentsCleaned: (cb) => safeOn('agents-cleaned', cb),

  // 에이전트 조회
  getAllAgents: () => {
    ipcRenderer.send('get-all-agents');
    return new Promise(resolve => ipcRenderer.once('all-agents-response', (_, d) => resolve(d)));
  },
  getAgentStats: () => {
    ipcRenderer.send('get-agent-stats');
    return new Promise(resolve => ipcRenderer.once('agent-stats-response', (_, d) => resolve(d)));
  },

  // 터미널 포커스 (에이전트 클릭 시)
  focusTerminal: (projectPath) => ipcRenderer.send('focus-terminal', projectPath),

  // 에이전트 수동 퇴근 (X 버튼 클릭 시)
  dismissAgent: (agentId) => ipcRenderer.send('dismiss-agent', agentId)
});
