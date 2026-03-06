/**
 * Multi-Agent Manager
 * - P2-10: 상태 변경 시에만 이벤트 emit
 * - 표시 이름 개선: slug 없을 경우 cwd basename 사용
 */

const EventEmitter = require('events');
const path = require('path');
const { formatSlugToDisplayName } = require('./utils');

// AVATAR_FILES 개수 (renderer/config.js, office/office-config.js와 동기화)
const AVATAR_COUNT = 23;

class AgentManager extends EventEmitter {
  constructor() {
    super();
    this.agents = new Map();
    this._pendingEmit = new Map(); // agentId → { timer, state } — UI emit 디바운스
    this._usedAvatarIndices = new Set(); // 현재 사용 중인 아바타 인덱스
    this.config = {
      softLimitWarning: 50,  // 소프트 워닝 (차단하지 않음, 로그만)
      stateDebounceMs: 500,  // Working→Thinking 전환 디바운스 (ms)
    };
  }

  start() {
    // 에이전트 정리는 main.js liveness checker(PID 기반)가 전담
    console.log('[AgentManager] Started');
  }

  stop() {
    for (const pending of this._pendingEmit.values()) {
      clearTimeout(pending.timer);
    }
    this._pendingEmit.clear();
    this._usedAvatarIndices.clear();
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
      avatarIndex: existingAgent ? existingAgent.avatarIndex : this._assignAvatarIndex(agentId),
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
      this._cancelPendingEmit(agentId);
      this.emit('agent-added', this.getAgentWithEffectiveState(agentId));
      console.log(`[AgentManager] Agent added: ${agentData.displayName} (${newState})`);
    } else if (newState !== prevState) {
      this._emitWithDebounce(agentId, prevState, newState, agentData.displayName);
    }

    return agentData;
  }

  /**
   * 상태 전환 디바운스 — Working→Thinking 전환 시 500ms 지연하여 깜빡임 방지
   * Thinking→Working (승격)은 즉시 적용, 기존 pending 취소
   */
  _emitWithDebounce(agentId, prevState, newState, displayName) {
    const isDowngrade = (prevState === 'Working' && newState === 'Thinking');

    if (isDowngrade) {
      // Working→Thinking: 지연 emit (500ms 내 Working 재진입 시 취소됨)
      this._cancelPendingEmit(agentId);
      const timer = setTimeout(() => {
        this._pendingEmit.delete(agentId);
        const current = this.agents.get(agentId);
        if (current && current.state === newState) {
          this.emit('agent-updated', this.getAgentWithEffectiveState(agentId));
        }
      }, this.config.stateDebounceMs);
      this._pendingEmit.set(agentId, { timer, state: newState });
    } else {
      // 즉시 emit — pending이 있으면 취소
      this._cancelPendingEmit(agentId);
      this.emit('agent-updated', this.getAgentWithEffectiveState(agentId));
    }
  }

  _cancelPendingEmit(agentId) {
    const pending = this._pendingEmit.get(agentId);
    if (pending) {
      clearTimeout(pending.timer);
      this._pendingEmit.delete(agentId);
    }
  }

  removeAgent(agentId) {
    const agent = this.agents.get(agentId);
    if (!agent) return false;
    this._cancelPendingEmit(agentId);
    this._releaseAvatarIndex(agent.avatarIndex);
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

  /**
   * 아바타 인덱스 할당 — 해시 충돌 시 미사용 아바타 우선
   */
  _assignAvatarIndex(agentId) {
    let hash = 0;
    const str = agentId || '';
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0;
    }
    const hashIdx = Math.abs(hash) % AVATAR_COUNT;

    if (!this._usedAvatarIndices.has(hashIdx)) {
      this._usedAvatarIndices.add(hashIdx);
      return hashIdx;
    }

    // 해시 충돌: 미사용 아바타 순회
    for (let i = 0; i < AVATAR_COUNT; i++) {
      if (!this._usedAvatarIndices.has(i)) {
        this._usedAvatarIndices.add(i);
        return i;
      }
    }

    // 모든 아바타 사용 중이면 해시 폴백
    return hashIdx;
  }

  /**
   * 아바타 인덱스 해제
   */
  _releaseAvatarIndex(avatarIndex) {
    if (avatarIndex !== undefined && avatarIndex !== null) {
      this._usedAvatarIndices.delete(avatarIndex);
    }
  }

  getStats() {
    const agents = this.getAllAgents();
    const counts = { Done: 0, Thinking: 0, Working: 0, Waiting: 0, Help: 0, Error: 0 };
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
