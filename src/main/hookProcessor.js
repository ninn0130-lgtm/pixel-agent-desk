/**
 * Hook Event Processor
 * processHookEvent() switch statement + handleSessionStart/End + cleanupAgentResources
 */

const path = require('path');
const { MODEL_PRICING, DEFAULT_PRICING, roundCost, getContextWindowSize } = require('../pricing');

/**
 * Calculate updated token usage from a PostToolUse tool_response.
 * @returns {object|null} Updated tokenUsage object, or null if no usage data.
 */
function computeTokenUsage(agent, tokenUsage) {
  if (!tokenUsage) return null;
  const cur = agent.tokenUsage || { inputTokens: 0, outputTokens: 0, estimatedCost: 0 };
  const inputTokens = cur.inputTokens + (tokenUsage.input_tokens || 0);
  const outputTokens = cur.outputTokens + (tokenUsage.output_tokens || 0);
  const pricing = MODEL_PRICING[agent.model] || DEFAULT_PRICING;
  const estimatedCost = inputTokens * pricing.input + outputTokens * pricing.output;
  const ctxWindow = getContextWindowSize(agent.model);
  const latestInput = tokenUsage.input_tokens || 0;
  const contextPercent = ctxWindow > 0 ? Math.min(100, Math.round((latestInput / ctxWindow) * 100)) : 0;
  return { inputTokens, outputTokens, estimatedCost: roundCost(estimatedCost), contextPercent };
}

/**
 * Extract a short, human-readable target descriptor from a tool_input payload.
 * Returns { target: string|null, raw: string|null } — `target` fits in a label,
 * `raw` is the untruncated value for future hover display (capped at 500 chars).
 */
function extractToolTarget(toolName, toolInput) {
  if (!toolInput || typeof toolInput !== 'object') return { target: null, raw: null };

  const clean = (s) => {
    if (s == null) return '';
    const str = String(s);
    // eslint-disable-next-line no-control-regex
    const ansi = /\x1B\[[0-?]*[ -/]*[@-~]/g;
    // eslint-disable-next-line no-control-regex
    const ctrl = new RegExp('[\\x00-\\x1F\\x7F]', 'g');
    return str.replace(ansi, '').replace(ctrl, ' ').replace(/\s+/g, ' ').trim();
  };
  const cap = (s, n) => (s.length <= n ? s : s.slice(0, n));
  const last2 = (p) => {
    const norm = String(p).replace(/\\/g, '/');
    const parts = norm.split('/').filter(Boolean);
    return parts.slice(-2).join('/');
  };
  const basename = (p) => {
    const norm = String(p).replace(/\\/g, '/');
    const parts = norm.split('/').filter(Boolean);
    return parts[parts.length - 1] || norm;
  };

  try {
    switch (toolName) {
      case 'Bash': {
        const cmd = clean(toolInput.command);
        return { target: cap(cmd, 30), raw: cap(cmd, 500) };
      }
      case 'Read':
      case 'Edit':
      case 'Write':
      case 'NotebookEdit': {
        const fp = toolInput.file_path || toolInput.notebook_path || '';
        if (!fp) return { target: null, raw: null };
        const bn = basename(fp);
        const target = bn.length <= 30 ? bn : last2(fp);
        return { target: cap(clean(target), 30), raw: cap(clean(fp), 500) };
      }
      case 'MultiEdit': {
        const fp = toolInput.file_path || '';
        const n = Array.isArray(toolInput.edits) ? toolInput.edits.length : 0;
        if (!fp) return { target: null, raw: null };
        const bn = basename(fp);
        const target = `${bn} (${n}x)`;
        return { target: cap(clean(target), 30), raw: cap(clean(`${fp} (${n} edits)`), 500) };
      }
      case 'Grep': {
        const pat = clean(toolInput.pattern);
        const target = `"${cap(pat, 28)}"`;
        const rawExtra = toolInput.glob || toolInput.path || '';
        const raw = cap(clean(`${pat}${rawExtra ? ' in ' + rawExtra : ''}`), 500);
        return { target: cap(target, 30), raw };
      }
      case 'Glob': {
        const pat = clean(toolInput.pattern);
        return { target: cap(pat, 30), raw: cap(pat, 500) };
      }
      case 'WebFetch': {
        const url = clean(toolInput.url);
        let host = url;
        try { host = new URL(url).hostname || url; } catch { /* ignore */ }
        return { target: cap(host, 30), raw: cap(url, 500) };
      }
      case 'WebSearch': {
        const q = clean(toolInput.query);
        return { target: cap(q, 30), raw: cap(q, 500) };
      }
      case 'Task':
      case 'Agent': {
        const sub = toolInput.subagent_type || toolInput.description || '';
        const cleaned = clean(sub);
        return { target: cap(cleaned, 30), raw: cap(clean(toolInput.description || sub), 500) };
      }
      case 'TodoWrite': {
        const n = Array.isArray(toolInput.todos) ? toolInput.todos.length : 0;
        return { target: `${n} todos`, raw: cap(JSON.stringify(toolInput.todos || []), 500) };
      }
      default: {
        if (toolName && toolName.startsWith('mcp__')) {
          const parts = toolName.split('__');
          const tail = parts[parts.length - 1] || toolName;
          let raw = '';
          try { raw = cap(clean(JSON.stringify(toolInput)), 500); } catch { raw = ''; }
          return { target: cap(tail, 30), raw };
        }
        return { target: null, raw: null };
      }
    }
  } catch {
    return { target: null, raw: null };
  }
}

/**
 * Attempt PID reconnection via transcript when an `echo $$` / `echo $PPID` is detected.
 */
function handlePidReconnect({ agentManager, sessionPids, sessionId, data, debugLog, detectClaudePidByTranscript }) {
  if (data.tool_name !== 'Bash' || !data.tool_input) return;
  if (!/echo\s+\$(\$|PPID)/.test(data.tool_input.command || '')) return;

  const agent = agentManager && agentManager.getAgent(sessionId);
  const jsonlPath = (agent && agent.jsonlPath) || data.transcript_path || null;
  debugLog(`[Hook] PID reconnect trigger: ${sessionId.slice(0, 8)} (echo detected)`);

  if (agent && !sessionPids.has(sessionId)) {
    agentManager.updateAgent({ ...agent, firstSeen: Date.now() }, 'hook');
  }
  detectClaudePidByTranscript(jsonlPath, (result) => {
    if (typeof result === 'number') {
      sessionPids.set(sessionId, result);
      debugLog(`[Hook] PID reconnected: ${sessionId.slice(0, 8)} -> pid=${result}`);
    } else if (Array.isArray(result)) {
      const registeredPids = new Set(sessionPids.values());
      const newPid = result.find(p => !registeredPids.has(p));
      if (newPid) {
        sessionPids.set(sessionId, newPid);
        debugLog(`[Hook] PID reconnected (fallback): ${sessionId.slice(0, 8)} -> pid=${newPid}`);
      }
    }
  });
}

function createHookProcessor({ agentManager, sessionPids, debugLog, detectClaudePidByTranscript, excludePaths = [] }) {
  // Internal state
  const pendingSessionStarts = [];
  const firstPreToolUseDone = new Map(); // sessionId -> boolean

  // Self-tracking exclusion: if a Claude session's cwd matches one of these
  // paths, skip agent registration. Used to prevent Pixel Agent Desk from
  // registering an agent for a Claude CLI session running in its own source
  // tree (a self-debug scenario where the user's session would otherwise
  // appear in the dashboard the same app is rendering).
  const _excludeSet = new Set(
    (excludePaths || []).filter(Boolean).map((p) => path.resolve(p).toLowerCase())
  );
  function isExcludedCwd(cwd) {
    if (!cwd || _excludeSet.size === 0) return false;
    try {
      return _excludeSet.has(path.resolve(cwd).toLowerCase());
    } catch (_) {
      return false;
    }
  }

  function processHookEvent(data) {
    const event = data.hook_event_name;
    const sessionId = data.session_id || data.sessionId;
    if (!sessionId) return;

    debugLog(`[Hook] ${event} session=${sessionId.slice(0, 8)}`);

    // Create agent immediately on first event even if SessionStart was missed (universal fallback)
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

        // compact/resume/clear: only update if existing agent found (prevent duplicate creation)
        if (sessionSource !== 'startup' && agentManager) {
          const existing = agentManager.getAgent(sessionId);
          if (existing) {
            const compactUpdate = {
              ...existing, sessionId, state: 'Waiting',
              jsonlPath: sessionMeta.jsonlPath || existing.jsonlPath,
              model: sessionMeta.model || existing.model,
              source: sessionSource,
            };
            if (sessionSource === 'compact') {
              compactUpdate.tokenUsage = { ...(existing.tokenUsage || {}), contextPercent: 0 };
            }
            agentManager.updateAgent(compactUpdate, 'hook');
            debugLog(`[Hook] SessionStart (${sessionSource}) → updated existing agent ${sessionId.slice(0, 8)}`);
            break;
          }
        }

        handleSessionStart(sessionId, data.cwd || '', data._pid || 0, false, false, 'Waiting', null, sessionMeta);
        break;
      }

      case 'SessionEnd':
        if (data.reason) {
          debugLog(`[Hook] SessionEnd reason: ${data.reason} for ${sessionId.slice(0, 8)}`);
        }
        handleSessionEnd(sessionId);
        break;

      case 'UserPromptSubmit':
        firstPreToolUseDone.delete(sessionId);
        if (agentManager) {
          const agent = agentManager.getAgent(sessionId);
          if (agent) {
            agentManager.updateAgent({
              ...agent, sessionId, state: 'Thinking',
              currentTool: null,
              currentToolTarget: null,
              currentToolRaw: null,
            }, 'hook');
          }
        }
        break;

      case 'Stop':
      case 'TaskCompleted': {
        firstPreToolUseDone.delete(sessionId);
        if (event === 'TaskCompleted' && data.task_id) {
          debugLog(`[Hook] TaskCompleted: task=${data.task_id} subject="${data.task_subject || ''}" by ${data.teammate_name || sessionId.slice(0, 8)}`);
        }
        if (agentManager) {
          const agent = agentManager.getAgent(sessionId);
          const lastMsg = data.last_assistant_message || null;
          if (agent) {
            agentManager.updateAgent({
              ...agent, sessionId, state: 'Done',
              currentTool: null,
              currentToolTarget: null,
              currentToolRaw: null,
              lastMessage: lastMsg
            }, 'hook');
          }
        }
        break;
      }

      case 'PreToolUse': {
        if (!firstPreToolUseDone.has(sessionId)) {
          firstPreToolUseDone.set(sessionId, true);
          debugLog(`[Hook] PreToolUse ignored (first = session init)`);
        } else if (agentManager) {
          const agent = agentManager.getAgent(sessionId);
          if (agent) {
            const { target, raw } = extractToolTarget(data.tool_name, data.tool_input);
            agentManager.updateAgent({
              ...agent, sessionId, state: 'Working',
              currentTool: data.tool_name || null,
              currentToolTarget: target,
              currentToolRaw: raw,
            }, 'hook');
          }
        }
        break;
      }

      case 'PostToolUse': {
        if (agentManager && firstPreToolUseDone.has(sessionId)) {
          const agent = agentManager.getAgent(sessionId);
          if (agent) {
            const rawUsage = data.tool_response && data.tool_response.token_usage;
            const updatedUsage = computeTokenUsage(agent, rawUsage);
            agentManager.updateAgent({
              ...agent, sessionId, state: 'Thinking',
              currentTool: null,
              currentToolTarget: null,
              currentToolRaw: null,
              ...(updatedUsage && { tokenUsage: updatedUsage })
            }, 'hook');
          }
        }

        handlePidReconnect({ agentManager, sessionPids, sessionId, data, debugLog, detectClaudePidByTranscript });
        break;
      }

      case 'PostToolUseFailure':
        if (agentManager) {
          const agent = agentManager.getAgent(sessionId);
          if (agent) {
            const { target, raw } = extractToolTarget(data.tool_name, data.tool_input);
            agentManager.updateAgent({
              ...agent, sessionId, state: 'Error',
              currentTool: data.tool_name || null,
              currentToolTarget: target,
              currentToolRaw: raw,
            }, 'hook');
          }
        }
        break;

      case 'PermissionRequest':
        if (agentManager) {
          const agent = agentManager.getAgent(sessionId);
          if (agent) {
            const { target, raw } = extractToolTarget(data.tool_name, data.tool_input);
            agentManager.updateAgent({
              ...agent, sessionId, state: 'Help',
              currentTool: data.tool_name || null,
              currentToolTarget: target,
              currentToolRaw: raw,
            }, 'hook');
          }
        }
        break;

      case 'Notification': {
        const notifType = data.notification_type;
        let notifState = 'Waiting';
        if (notifType === 'permission_prompt' || notifType === 'elicitation_dialog') {
          notifState = 'Help';
        }

        if (agentManager) {
          const agent = agentManager.getAgent(sessionId);
          if (agent) {
            const updateData = { ...agent, sessionId, state: notifState };
            if (notifState !== 'Help') {
              updateData.currentTool = null;
              updateData.currentToolTarget = null;
              updateData.currentToolRaw = null;
            }
            agentManager.updateAgent(updateData, 'hook');
          }
        }
        break;
      }

      case 'SubagentStart': {
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
        const teammateName = data.teammate_name || null;
        const teamName = data.team_name || null;
        if (agentManager) {
          const agent = agentManager.getAgent(sessionId);
          if (agent) {
            agentManager.updateAgent({
              ...agent, state: 'Waiting', isTeammate: true,
              teammateName, teamName,
              currentTool: null,
              currentToolTarget: null,
              currentToolRaw: null,
            }, 'hook');
          } else {
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
        const trigger = data.trigger || 'unknown';
        debugLog(`[Hook] PreCompact (${trigger}) for ${sessionId.slice(0, 8)}`);
        if (agentManager) {
          const agent = agentManager.getAgent(sessionId);
          if (agent) {
            // Reset firstSeen to extend liveness grace period during compact
            agentManager.updateAgent({ ...agent, sessionId, state: 'Thinking', firstSeen: Date.now() }, 'hook');
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

  function handleSessionStart(sessionId, cwd, pid = 0, isTeammate = false, isSubagent = false, initialState = 'Waiting', parentId = null, meta = {}) {
    if (isExcludedCwd(cwd)) {
      debugLog(`[Hook] SessionStart skipped (excluded cwd): ${sessionId.slice(0, 8)} cwd=${cwd}`);
      return;
    }
    if (!agentManager) {
      pendingSessionStarts.push({ sessionId, cwd, ts: Date.now(), isTeammate, isSubagent, initialState, parentId, meta });
      debugLog(`[Hook] SessionStart queued: ${sessionId.slice(0, 8)}`);
      return;
    }
    const displayName = cwd ? path.basename(cwd) : 'Agent';
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
    cleanupAgentResources(sessionId);

    if (!agentManager) return;
    const agent = agentManager.getAgent(sessionId);
    if (agent) {
      debugLog(`[Hook] SessionEnd → removing agent ${sessionId.slice(0, 8)}`);
      agentManager.removeAgent(sessionId);
    } else {
      debugLog(`[Hook] SessionEnd for unknown agent ${sessionId.slice(0, 8)}`);
    }
  }

  function flushPendingStarts() {
    while (pendingSessionStarts.length > 0) {
      const { sessionId, cwd, isTeammate, isSubagent, initialState, parentId, meta } = pendingSessionStarts.shift();
      handleSessionStart(sessionId, cwd, 0, isTeammate, isSubagent, initialState || 'Waiting', parentId, meta || {});
    }
  }

  function cleanup() {
    firstPreToolUseDone.clear();
    pendingSessionStarts.length = 0;
  }

  return {
    processHookEvent,
    handleSessionStart,
    handleSessionEnd,
    flushPendingStarts,
    cleanup,
    // expose for sessionPersistence
    get firstPreToolUseDone() { return firstPreToolUseDone; },
  };
}

module.exports = { createHookProcessor };
