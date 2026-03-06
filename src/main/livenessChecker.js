/**
 * Liveness Checker
 * PID 탐지, transcript 기반 재확인, 2초 주기 프로세스 생사 체크
 */

const path = require('path');
const os = require('os');

const sessionPids = new Map(); // sessionId → 실제 claude 프로세스 PID

async function checkLivenessTier1(agentId, pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * transcript_path로 해당 세션의 Claude PID를 정확히 찾는 함수
 * Linux/macOS: lsof -t <path>
 * Windows: Restart Manager API (find-file-owner.ps1)
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
    const scriptPath = path.join(__dirname, '..', 'find-file-owner.ps1');
    execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-FilePath', resolved],
      { timeout: 5000 }, (err, stdout) => {
      if (!err && stdout) {
        const pids = stdout.trim().split('\n').map(p => parseInt(p.trim(), 10)).filter(p => !isNaN(p) && p > 0);
        if (pids.length > 0) {
          return callback(pids[0]);
        }
      }
      detectClaudePidsFallback(callback);
    });
  } else {
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
const MAX_PID_RETRY_ENTRIES = 200;
function retryPidDetection(sessionId, agentManager, debugLog) {
  if (_pidRetryRunning.has(sessionId) || sessionPids.has(sessionId)) return;
  // 무한 증가 방지
  if (_pidRetryRunning.size >= MAX_PID_RETRY_ENTRIES) {
    _pidRetryRunning.clear();
  }
  _pidRetryRunning.add(sessionId);

  const agent = agentManager ? agentManager.getAgent(sessionId) : null;
  const jsonlPath = agent ? agent.jsonlPath : null;

  detectClaudePidByTranscript(jsonlPath, (result) => {
    _pidRetryRunning.delete(sessionId);
    if (!result) return;

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

function startLivenessChecker({ agentManager, debugLog }) {
  const INTERVAL = 2000;   // 2초
  const GRACE_MS = 10000;  // 등록 후 10초 유예
  let isScanning = false;

  setInterval(async () => {
    if (!agentManager || isScanning) return;
    isScanning = true;
    try {
    for (const agent of agentManager.getAllAgents()) {
      if (agent.firstSeen && Date.now() - agent.firstSeen < GRACE_MS) continue;

      const pid = sessionPids.get(agent.id);
      if (!pid) {
        retryPidDetection(agent.id, agentManager, debugLog);
        const noPidAge = Date.now() - (agent.firstSeen || 0);
        if (noPidAge > GRACE_MS + 10000) {
          debugLog(`[Live] ${agent.id.slice(0, 8)} no PID for ${Math.round(noPidAge/1000)}s → removing`);
          agentManager.removeAgent(agent.id);
        }
        continue;
      }

      const alive = await checkLivenessTier1(agent.id, pid);
      if (alive) {
        if (agent.state === 'Offline') {
          agentManager.updateAgent({ ...agent, state: 'Waiting' }, 'live');
        }
        continue;
      }

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
        sessionPids.set(agent.id, newPid);
        debugLog(`[Live] ${agent.id.slice(0, 8)} PID renewed: ${pid} → ${newPid}`);
        if (agent.state === 'Offline') {
          agentManager.updateAgent({ ...agent, state: 'Waiting' }, 'live');
        }
      } else {
        debugLog(`[Live] ${agent.id.slice(0, 8)} confirmed dead → removing`);
        sessionPids.delete(agent.id);
        agentManager.removeAgent(agent.id);
      }
    }
    } catch (e) {
      debugLog(`[Live] Scan error: ${e.message}`);
    } finally {
      isScanning = false;
    }
  }, INTERVAL);
}

module.exports = { sessionPids, startLivenessChecker, detectClaudePidByTranscript };
