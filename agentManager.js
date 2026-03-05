/**
 * Multi-Agent Manager
 * - P2-10: 상태 변경 시에만 이벤트 emit
 * - 표시 이름 개선: slug 없을 경우 cwd basename 사용
 */

const EventEmitter = require('events');
const path = require('path');
const { formatSlugToDisplayName } = require('./utils');

class AgentManager extends EventEmitter {
  constructor() {
    super();
    this.agents = new Map();
    this.config = {
      softLimitWarning: 50,  // 소프트 워닝 (차단하지 않음, 로그만)
    };
  }

  start() {
    // 에이전트 정리는 main.js liveness checker(PID 기반)가 전담
    console.log('[AgentManager] Started');
  }

  stop() {
    this.agents.clear();
    console.log('[AgentManager] Stopped');
  }

  /**
   * 에이전트 업데이트 또는 추가
   */
  updateAgent(entry, source = 'log') {
    const agentId = entry.sessionId || entry.agentId || entry.uuid || 'unknown';
    const now = Date.now();
    const existingAgent = this.agents.get(agentId);

    // 소프트 워닝: 에이전트 수가 많으면 경고만 (등록 차단하지 않음)
    if (!existingAgent && this.agents.size >= this.config.softLimitWarning) {
      console.warn(`[AgentManager] ⚠ ${this.agents.size} agents active (soft limit: ${this.config.softLimitWarning}). Consider checking for stale sessions.`);
    }

    const prevState = existingAgent ? existingAgent.state : null;
    let newState = entry.state;
    if (!newState) newState = prevState || 'Done';

    let activeStartTime = existingAgent ? existingAgent.activeStartTime : now;
    let lastDuration = existingAgent ? existingAgent.lastDuration : 0;

    // 활성 상태 진입 시 (Done/Error/Help/Waiting -> Working/Thinking)
    const isPassive = (s) => s === 'Done' || s === 'Help' || s === 'Error' || s === 'Waiting';
    const isActive = (s) => s === 'Working' || s === 'Thinking';

    if (isActive(newState) && (isPassive(prevState) || !existingAgent)) {
      activeStartTime = now;
    }

    // 다시 Done으로 돌아갈 때, 마지막 소요 시간 저장
    if (newState === 'Done' && existingAgent && isActive(prevState)) {
      lastDuration = now - activeStartTime;
    }

    const agentData = {
      id: agentId,
      sessionId: entry.sessionId,
      agentId: entry.agentId,
      slug: entry.slug,
      displayName: this.formatDisplayName(entry.slug, entry.projectPath),
      projectPath: entry.projectPath,
      jsonlPath: entry.jsonlPath || (existingAgent ? existingAgent.jsonlPath : null),
      // Task 3A-2: 신규 메타데이터 필드
      model: entry.model !== undefined ? entry.model : (existingAgent ? existingAgent.model : null),
      permissionMode: entry.permissionMode !== undefined ? entry.permissionMode : (existingAgent ? existingAgent.permissionMode : null),
      source: entry.source !== undefined ? entry.source : (existingAgent ? existingAgent.source : null),
      agentType: entry.agentType !== undefined ? entry.agentType : (existingAgent ? existingAgent.agentType : null),
      // 현재 사용 중인 도구
      currentTool: entry.currentTool !== undefined ? entry.currentTool : (existingAgent ? existingAgent.currentTool : null),
      // Stop 이벤트의 마지막 응답 메시지
      lastMessage: entry.lastMessage !== undefined ? entry.lastMessage : (existingAgent ? existingAgent.lastMessage : null),
      // SessionEnd 종료 사유
      endReason: entry.endReason !== undefined ? entry.endReason : (existingAgent ? existingAgent.endReason : null),
      // 팀 정보
      teammateName: entry.teammateName !== undefined ? entry.teammateName : (existingAgent ? existingAgent.teammateName : null),
      teamName: entry.teamName !== undefined ? entry.teamName : (existingAgent ? existingAgent.teamName : null),
      // Task 3A-3: 토큰 사용량 (훅에서 누적, 스캐너에서 보완)
      tokenUsage: entry.tokenUsage !== undefined ? entry.tokenUsage : (existingAgent ? existingAgent.tokenUsage : { inputTokens: 0, outputTokens: 0, estimatedCost: 0 }),
      isSubagent: entry.isSubagent || (existingAgent ? existingAgent.isSubagent : false),
      isTeammate: entry.isTeammate || (existingAgent ? existingAgent.isTeammate : false),
      parentId: entry.parentId || (existingAgent ? existingAgent.parentId : null),
      state: newState,
      activeStartTime,
      lastDuration,
      lastActivity: now,
      timestamp: entry.timestamp || now,
      firstSeen: existingAgent ? existingAgent.firstSeen : now,
      updateCount: existingAgent ? existingAgent.updateCount + 1 : 1
    };

    this.agents.set(agentId, agentData);

    // 서브에이전트 상태 변화 시 부모 상태 리프레시
    if (agentData.parentId) {
      this.reEvaluateParentState(agentData.parentId);
    }

    if (!existingAgent) {
      this.emit('agent-added', this.getAgentWithEffectiveState(agentId));
      console.log(`[AgentManager] Agent added: ${agentData.displayName} (${newState})`);
    } else if (newState !== prevState) {
      this.emit('agent-updated', this.getAgentWithEffectiveState(agentId));
      console.log(`[AgentManager] ${agentData.displayName}: ${prevState} → ${newState}`);
    }

    return agentData;
  }

  removeAgent(agentId) {
    const agent = this.agents.get(agentId);
    if (!agent) return false;
    this.agents.delete(agentId);

    // 서브에이전트 삭제 시 부모 상태 리프레시
    if (agent.parentId) {
      this.reEvaluateParentState(agent.parentId);
    }

    this.emit('agent-removed', { id: agentId, displayName: agent.displayName });
    console.log(`[AgentManager] Removed: ${agent.displayName}`);
    return true;
  }

  getAllAgents() {
    return Array.from(this.agents.keys()).map(id => this.getAgentWithEffectiveState(id));
  }

  getAgentWithEffectiveState(agentId) {
    const agent = this.agents.get(agentId);
    if (!agent) return null;

    // 이미 Help나 Error 상태면 그대로 반환 (최우선순위)
    if (agent.state === 'Help' || agent.state === 'Error') return agent;

    // 자식(Subagent)들 상태 확인
    const children = Array.from(this.agents.values()).filter(a => a.parentId === agentId);

    // 1. 자식 중 하나라도 Help/Error 면 부모 상태도 Help로 표시 (사용자 개입 필요 알림)
    const someChildNeedsHelp = children.some(c => c.state === 'Help' || c.state === 'Error');
    if (someChildNeedsHelp) {
      return { ...agent, state: 'Help', isAggregated: true };
    }

    // 이미 Working 상태면 그대로 반환
    if (agent.state === 'Working' || agent.state === 'Thinking') return agent;

    // 2. 자식 중 하나라도 Working/Thinking 이면 부모 상태도 Working으로 표시
    const someChildWorking = children.some(c => c.state === 'Working' || c.state === 'Thinking');
    if (someChildWorking) {
      return { ...agent, state: 'Working', isAggregated: true };
    }

    return agent;
  }

  reEvaluateParentState(parentId) {
    const parent = this.agents.get(parentId);
    if (!parent) return;
    // 부모의 상태 업데이트 이벤트를 강제로 발생시켜 렌더러가 Working으로 인지하게 함
    this.emit('agent-updated', this.getAgentWithEffectiveState(parentId));
  }
  getAgent(agentId) { return this.agents.get(agentId) || null; }
  getAgentCount() { return this.agents.size; }
  dismissAgent(agentId) { return this.removeAgent(agentId); }

  // 에이전트 정리는 main.js liveness checker(PID 기반)가 전담
  // cleanupIdleAgents 삭제 — 타이머 기반 정리는 PID 체크와 충돌

  getAgentsByActivity() {
    return this.getAllAgents().sort((a, b) => b.lastActivity - a.lastActivity);
  }

  /**
   * 표시 이름 결정
   * 1. slug (예: "toasty-sparking-lecun" → "Toasty Sparking Lecun")
   * 2. projectPath의 basename (예: "pixel-agent-desk-master")
   * 3. 폴백: "Agent"
   */
  formatDisplayName(slug, projectPath) {
    if (slug) {
      return formatSlugToDisplayName(slug);
    }
    if (projectPath) {
      return path.basename(projectPath);
    }
    return 'Agent';
  }

  getStats() {
    const agents = this.getAllAgents();
    const counts = { Done: 0, Thinking: 0, Working: 0, Waiting: 0, Help: 0 };
    for (const agent of agents) {
      if (counts.hasOwnProperty(agent.state)) {
        counts[agent.state]++;
      }
    }
    return {
      total: agents.length,
      byState: counts
    };
  }
}

module.exports = AgentManager;
