/**
 * Pixel Agent Desk Renderer - Multi-Agent Support
 * 멀티 에이전트 그리드 레이아웃 및 개별 상태 관리
 */

// --- DOM Elements ---
const agentGrid = document.getElementById('agent-grid');

// --- 스프라이트 시트 설정 ---
const SHEET = {
  cols: 9,
  width: 48,
  height: 64
};

// --- 애니메이션 시퀀스 ---
const ANIM_SEQUENCES = {
  working: { frames: [1, 2, 3, 4], fps: 8, loop: true },
  complete: { frames: [20, 21, 22, 23, 24, 25, 26, 27], fps: 6, loop: true },
  waiting: { frames: [32], fps: 1, loop: true },
  alert: { frames: [0, 31], fps: 4, loop: true }
};

// --- 상태별 맵핑 ---
const stateConfig = {
  'Working': { anim: 'working', class: 'state-working', label: 'Working...' },
  'Thinking': { anim: 'working', class: 'state-working', label: 'Thinking...' },
  'Done': { anim: 'complete', class: 'state-complete', label: 'Done!' },
  'Waiting': { anim: 'waiting', class: 'state-waiting', label: 'Waiting...' },
  'Error': { anim: 'alert', class: 'state-alert', label: 'Error!' },
  'Help': { anim: 'alert', class: 'state-alert', label: 'Help!' },
  'Offline': { anim: 'waiting', class: 'state-offline', label: 'Offline' }
};

// --- 에이전트별 상태 관리 ---
const agentStates = new Map(); // agentId -> { animName, frameIdx, rafId, startTime, timerInterval, lastFormattedTime }

// --- P1-1: 통합 requestAnimationFrame 애니메이션 매니저 ---
const animationManager = {
  animations: new Map(), // agentId -> { agentId, element, animName, sequence, frameIdx, lastTime, rafId }

  start(agentId, element, animName) {
    // Stop existing animation for this agent
    this.stop(agentId);

    const sequence = ANIM_SEQUENCES[animName];
    if (!sequence) return;

    // Draw first frame immediately
    const firstFrame = sequence.frames[0];
    const col = firstFrame % SHEET.cols;
    const row = Math.floor(firstFrame / SHEET.cols);
    const x = col * -SHEET.width;
    const y = row * -SHEET.height;
    element.style.backgroundPosition = `${x}px ${y}px`;

    const animation = {
      agentId,
      element,
      animName,
      sequence,
      frameIdx: 0,
      lastTime: performance.now(),
      rafId: null
    };

    this.animations.set(agentId, animation);

    // Start animation loop
    this.loop(agentId);
  },

  loop(agentId) {
    const animation = this.animations.get(agentId);
    if (!animation) return;

    animation.rafId = requestAnimationFrame((currentTime) => {
      if (!this.animations.has(agentId)) {
        return;
      }

      // Calculate frame based on FPS
      const targetFPS = animation.sequence.fps;
      const frameDuration = 1000 / targetFPS;

      // Only advance frame if enough time has passed
      if (currentTime - animation.lastTime >= frameDuration) {
        // Update frame
        animation.frameIdx++;

        if (animation.frameIdx >= animation.sequence.frames.length) {
          if (animation.sequence.loop) {
            animation.frameIdx = 0;
          } else {
            this.stop(agentId);
            return;
          }
        }

        // Draw frame
        const frameNum = animation.sequence.frames[animation.frameIdx];
        const col = frameNum % SHEET.cols;
        const row = Math.floor(frameNum / SHEET.cols);
        const x = col * -SHEET.width;
        const y = row * -SHEET.height;
        animation.element.style.backgroundPosition = `${x}px ${y}px`;

        animation.lastTime = currentTime;
      }

      // Continue loop
      this.loop(agentId);
    });
  },

  stop(agentId) {
    const animation = this.animations.get(agentId);
    if (animation) {
      // Cancel the RAF if it exists
      if (animation.rafId) {
        cancelAnimationFrame(animation.rafId);
      }
      this.animations.delete(agentId);
    }

    // Also cleanup any remaining intervals
    const state = agentStates.get(agentId);
    if (state && state.interval) {
      clearInterval(state.interval);
      state.interval = null;
    }
  }
};

// --- 아바타 관리 ---
let availableAvatars = [];
let idleAvatar = 'avatar_0.webp';
const agentAvatars = new Map(); // agentId -> random avatar path

// --- 유틸리티 함수 ---

function drawFrame(element, frameIndex) {
  if (!element) return;
  const col = frameIndex % SHEET.cols;
  const row = Math.floor(frameIndex / SHEET.cols);
  const x = col * -SHEET.width;
  const y = row * -SHEET.height;
  element.style.backgroundPosition = `${x}px ${y}px`;
}

function playAnimation(agentId, element, animName) {
  // P1-1: Use requestAnimationFrame instead of setInterval
  animationManager.start(agentId, element, animName);

  // Update state for compatibility
  const state = agentStates.get(agentId) || {};
  state.animName = animName;
  agentStates.set(agentId, state);
}

function updateAgentState(agentId, container, agentOrState) {
  // agentOrState가 객체면 agent, 문자열이면 이전 방식 호환성 유지용 state
  const isAgentObj = typeof agentOrState === 'object';
  const state = isAgentObj ? agentOrState.state : agentOrState;
  const isAggregated = isAgentObj && agentOrState.isAggregated;

  const baseConfig = stateConfig[state] || stateConfig['Waiting'];
  const config = { ...baseConfig };

  if (isAggregated) {
    config.label = "Managing..."; // "Managing Subs..."는 너무 길 수 있음
  }

  // currentTool이 있으면 Working 라벨에 도구명 표시
  const currentTool = isAgentObj ? agentOrState.currentTool : null;
  if (currentTool && state === 'Working') {
    config.label = currentTool;
  }

  const bubble = container.querySelector('.agent-bubble');
  const character = container.querySelector('.agent-character');

  // ARIA 라벨 업데이트 - 상태 변화 알림
  const agentDisplayName = container.querySelector('.agent-name')?.textContent || 'Agent';
  container.setAttribute('aria-label', `${agentDisplayName} - ${config.label}`);

  // Update container class
  container.className = `agent-card ${config.class}`;
  if (isAggregated) container.classList.add('is-aggregated');

  if (isAgentObj) {
    if (agentOrState.isSubagent) container.classList.add('is-subagent');
    else container.classList.remove('is-subagent');

    if (agentOrState.isTeammate) container.classList.add('is-teammate');
    else container.classList.remove('is-teammate');
  }

  // Play animation
  playAnimation(agentId, character, config.anim);

  // Get agent state
  let agentState = agentStates.get(agentId);
  if (!agentState) {
    agentState = {
      animName: null,
      frameIdx: 0,
      interval: null,
      startTime: null,
      timerInterval: null,
      lastFormattedTime: ''
    };
    agentStates.set(agentId, agentState);
  }

  // Timer logic
  if (config.anim === 'working') {
    if (!agentState.startTime) {
      agentState.startTime = Date.now();
    }
    if (!agentState.timerInterval) {
      agentState.timerInterval = setInterval(() => {
        const elapsed = Date.now() - agentState.startTime;
        agentState.lastFormattedTime = window.electronAPI.formatTime(elapsed);
        if (bubble) {
          bubble.textContent = `${config.label} (${agentState.lastFormattedTime})`;
        }
      }, 1000);
    }

    // Immediate display
    const elapsed = Date.now() - agentState.startTime;
    agentState.lastFormattedTime = window.electronAPI.formatTime(elapsed);
    if (bubble) {
      bubble.textContent = `${config.label} (${agentState.lastFormattedTime})`;
    }

  } else if (config.anim === 'complete') {
    // Task complete - 타이머 멈추되 startTime은 유지 (다음 턴에서 이어감)
    if (agentState.timerInterval) {
      clearInterval(agentState.timerInterval);
      agentState.timerInterval = null;
    }
    if (bubble) {
      const finalTime = agentState.lastFormattedTime || '00:00';
      bubble.textContent = `${config.label} (${finalTime})`;
    }
    // startTime 유지 — Working으로 복귀 시 누적 시간 이어감

  } else {
    // Other states (Waiting, Help, Error, Offline) - 타이머 완전 리셋
    if (agentState.timerInterval) {
      clearInterval(agentState.timerInterval);
      agentState.timerInterval = null;
    }
    agentState.startTime = null;
    agentState.lastFormattedTime = '';
    if (bubble) {
      bubble.textContent = config.label;
    }
  }

  agentStates.set(agentId, agentState);
  console.log(`[Renderer] ${agentId.slice(0, 8)}: ${state} -> ${config.label}`);
}

// --- 에이전트 카드 생성/관리 ---

function createAgentCard(agent) {
  const card = document.createElement('div');
  card.className = 'agent-card';
  card.dataset.agentId = agent.id;
  card.tabIndex = 0; // Make keyboard focusable

  // ARIA 속성 추가 - 접근성 개선
  card.setAttribute('role', 'article');
  card.setAttribute('aria-label', `${agent.displayName || 'Agent'} - ${agent.state || 'Waiting'}`);

  // 서브에이전트 표시
  if (agent.isSubagent) {
    card.classList.add('is-subagent');
    card.setAttribute('aria-label', `Subagent ${agent.displayName || 'Agent'} - ${agent.state || 'Waiting'}`);
  }

  // Create bubble
  const bubble = document.createElement('div');
  bubble.className = 'agent-bubble';
  bubble.textContent = 'Waiting...';
  bubble.setAttribute('role', 'status');
  bubble.setAttribute('aria-live', 'polite');

  // Create character
  const character = document.createElement('div');
  character.className = 'agent-character';

  // 에이전트 별 랜덤 아바타 지정
  let assignedAvatar = agentAvatars.get(agent.id);
  if (!assignedAvatar && availableAvatars.length > 0) {
    assignedAvatar = availableAvatars[Math.floor(Math.random() * availableAvatars.length)];
    agentAvatars.set(agent.id, assignedAvatar);
  } else if (!assignedAvatar) {
    assignedAvatar = idleAvatar || 'avatar_0.png';
  }

  if (assignedAvatar) {
    character.style.backgroundImage = `url('./public/characters/${assignedAvatar}')`;
  }

  // dismissBtn 관련 코드 삭제됨

  // 카드 타입 구분 (배지 및 테두리)
  let typeLabel = 'Main';
  let typeClass = 'type-main';
  if (agent.isSubagent) {
    typeLabel = agent.agentType ? agent.agentType : 'Sub';
    typeClass = 'type-sub';
  } else if (agent.isTeammate) {
    typeLabel = agent.teammateName || 'Team';
    typeClass = 'type-team';
  }
  card.classList.add(typeClass);

  // 상단 배지 (타입만 — 프로젝트명은 툴팁으로)
  const typeTag = document.createElement('span');
  typeTag.className = `type-tag ${typeClass}`;
  typeTag.textContent = typeLabel;
  typeTag.title = agent.projectPath || '';
  card.appendChild(typeTag);

  // Create agent name (직책/이름 표시)
  const nameBadge = document.createElement('div');
  nameBadge.className = 'agent-name';
  nameBadge.textContent = agent.displayName || typeLabel;
  nameBadge.title = agent.displayName; // 긴 이름일 경우 기본 툴팁

  // 만약 위 프로젝트 태그(폴더명)와 직책명(displayName)이 완전히 똑같거나 'Agent' 기본값이면 하단 배지를 숨김
  const projectNameStr = agent.projectPath ? agent.projectPath.split(/[\\/]/).pop() : 'Default';
  if (!agent.displayName || agent.displayName === projectNameStr || agent.displayName === 'Agent') {
    nameBadge.style.display = 'none';
  }

  // Assemble card
  card.appendChild(bubble);
  card.appendChild(character);
  card.appendChild(nameBadge);

  // 터미널 포커스 버튼 (카드 우측 상단)
  const focusBtn = document.createElement('button');
  focusBtn.className = 'focus-terminal-btn';
  focusBtn.textContent = '>';
  focusBtn.title = 'Focus terminal';
  focusBtn.setAttribute('aria-label', `Focus terminal for ${agent.displayName || 'Agent'}`);
  focusBtn.onclick = (e) => {
    e.stopPropagation();
    if (window.electronAPI && window.electronAPI.focusTerminal) {
      window.electronAPI.focusTerminal(agent.id);
    }
    // 클릭 피드백
    focusBtn.classList.add('clicked');
    setTimeout(() => focusBtn.classList.remove('clicked'), 300);
  };
  card.appendChild(focusBtn);

  // 캐릭터 찌르기(Poke) 상호작용
  character.style.cursor = 'pointer';
  const pokeMessages = [
    "앗, 깜짝이야!",
    "열심히 일하는 중입니다!",
    "코드 짜는 중...",
    "커피가 필요해요",
    "이 부분 버그 아니죠?",
    "간지러워요!",
    "제 타수 엄청 빠르죠?",
    "칭찬해주세요!"
  ];

  let pokeTimeout = null;
  character.onclick = (e) => {
    e.stopPropagation();
    if (pokeTimeout) return;
    const originalText = bubble.textContent;
    const randomMsg = pokeMessages[Math.floor(Math.random() * pokeMessages.length)];
    bubble.textContent = randomMsg;
    bubble.style.borderColor = '#ff4081';
    pokeTimeout = setTimeout(() => {
      bubble.style.borderColor = '';
      pokeTimeout = null;
      bubble.textContent = originalText;
    }, 2000);
  };

  return card;
}
// 에이전트 추가
function addAgent(agent) {
  // Check if already exists
  if (document.querySelector(`[data-agent-id="${agent.id}"]`)) {
    return;
  }

  const card = createAgentCard(agent);
  agentGrid.appendChild(card);

  // 전역 데이터 캐시 업데이트 (정렬용)
  if (!window.lastAgents) window.lastAgents = [];
  if (!window.lastAgents.some(a => a.id === agent.id)) {
    window.lastAgents.push(agent);
  }

  // Set initial state
  updateAgentState(agent.id, card, agent);

  // Update grid layout
  updateGridLayout();
  // Ensure we resize after adding
  requestDynamicResize();

  console.log(`[Renderer] Agent added: ${agent.displayName} (${agent.id.slice(0, 8)})`);
}

function updateAgent(agent) {
  const card = document.querySelector(`[data-agent-id="${agent.id}"]`);
  if (!card) return;

  // 전역 데이터 캐시 업데이트 (정렬 및 레이아웃용)
  if (window.lastAgents) {
    const idx = window.lastAgents.findIndex(a => a.id === agent.id);
    if (idx > -1) {
      window.lastAgents[idx] = agent;
    } else {
      window.lastAgents.push(agent);
    }
  }

  updateAgentState(agent.id, card, agent);
  updateGridLayout();
  requestDynamicResize();
}

function removeAgent(data) {
  const card = document.querySelector(`[data-agent-id="${data.id}"]`);
  if (!card) return;

  // Clean up intervals (항상 실행)
  const state = agentStates.get(data.id);
  if (state) {
    // interval 정리
    if (state.interval) {
      clearInterval(state.interval);
      state.interval = null;
    }
    // timerInterval 정리
    if (state.timerInterval) {
      clearInterval(state.timerInterval);
      state.timerInterval = null;
    }
  }
  // Map에서 삭제 (state가 없어도 안전하게 삭제)
  agentStates.delete(data.id);

  console.log(`[Renderer] Cleaned up agent ${data.id.slice(0, 8)} (intervals cleared)`);

  card.remove();

  // Update grid layout
  updateGridLayout();
  requestDynamicResize();

  console.log(`[Renderer] Agent removed: ${data.displayName} (${data.id.slice(0, 8)})`);
}

function cleanupAgents(data) {
  updateGridLayout();
  console.log(`[Renderer] Cleaned up ${data.count} agents`);
}

// --- 빈 상태(에이전트 0개) 대기 아바타 ---
const idleContainer = document.getElementById('container');
const idleCharacter = document.getElementById('character');
const idleBubble = document.getElementById('speech-bubble');
let idleAnimInterval = null;

function startIdleAnimation() {
  if (!idleCharacter) return;
  const seq = ANIM_SEQUENCES.waiting; // frame 32
  drawFrameOn(idleCharacter, seq.frames[0]);
  idleBubble.textContent = 'Waiting...';
}

function drawFrameOn(el, frameIndex) {
  if (!el) return;
  const col = frameIndex % SHEET.cols;
  const row = Math.floor(frameIndex / SHEET.cols);
  el.style.backgroundPosition = `${col * -SHEET.width}px ${row * -SHEET.height}px`;
}

function updateGridLayout() {
  const cards = Array.from(agentGrid.querySelectorAll('.agent-card'));
  if (cards.length === 0) {
    agentGrid.classList.remove('has-multiple');
    // 배경 박스만 제거 (idleContainer는 보존)
    agentGrid.querySelectorAll('.agent-party-bg').forEach(el => el.remove());
    if (idleContainer) {
      // idleContainer가 DOM에서 떨어졌으면 다시 붙이기
      if (!idleContainer.parentNode) {
        agentGrid.appendChild(idleContainer);
      }
      idleContainer.style.display = 'flex';
    }
    return;
  }

  if (idleContainer) idleContainer.style.display = 'none';
  agentGrid.classList.add('has-multiple');

  const cardDataList = cards.map(c => {
    return {
      card: c,
      data: window.lastAgents?.find(ag => ag.id === c.dataset.agentId) || { id: c.dataset.agentId }
    };
  });

  const mains = cardDataList.filter(item => !item.data.isSubagent && !item.data.isTeammate);
  const others = cardDataList.filter(item => item.data.isSubagent || item.data.isTeammate);
  const fallbackSubList = [...others];

  mains.sort((a, b) => (a.data.projectPath || '').localeCompare(b.data.projectPath || ''));

  // Clear grid contents (agent cards, bg boxes) — idleContainer는 보존
  Array.from(agentGrid.children).forEach(child => {
    if (child !== idleContainer) {
      agentGrid.removeChild(child);
    }
  });

  let lastProject = null;
  let mainIndex = 0;

  let col = 1;
  let currentRow = 1;
  let maxRowInBatch = 1;

  mains.forEach(mainItem => {
    const proj = mainItem.data.projectPath;
    if (lastProject !== null && proj !== lastProject) {
      mainIndex = 0;
    }
    lastProject = proj;

    // 메인 에이전트 넘버링 처리 (type-tag에만 표시, 하단 nameBadge는 중복이므로 건드리지 않음)
    const typeTag = mainItem.card.querySelector('.type-tag');
    const label = `Main_${mainIndex}`;
    if (typeTag) typeTag.textContent = label;
    mainIndex++;

    const mySubs = [];
    for (let i = fallbackSubList.length - 1; i >= 0; i--) {
      const sub = fallbackSubList[i];
      if (sub.data.parentId === mainItem.data.id || (!sub.data.parentId && sub.data.projectPath === proj)) {
        mySubs.push(sub);
        fallbackSubList.splice(i, 1);
      }
    }

    mySubs.reverse();

    // 가로가 10개를 초과하면 줄바꿈
    if (col > 10) {
      col = 1;
      currentRow = maxRowInBatch + 1;
      maxRowInBatch = currentRow;
    }

    // 그룹 배경을 위한 빈 박스
    const bgBox = document.createElement('div');
    bgBox.className = 'agent-party-bg';
    bgBox.style.gridColumn = col;
    // 메인(1칸) + 서브개수 만큼 row 블록을 합침
    bgBox.style.gridRow = `${currentRow} / span ${1 + mySubs.length}`;
    agentGrid.appendChild(bgBox);

    // 메인 에이전트는 [col, currentRow] 위치에
    mainItem.card.classList.remove('group-start');
    mainItem.card.style.gridColumn = col;
    mainItem.card.style.gridRow = currentRow;
    agentGrid.appendChild(mainItem.card);

    // 서브 에이전트는 그 아랫줄들부터 순차 배치
    mySubs.forEach((s, sIdx) => {
      const subRow = currentRow + 1 + sIdx;
      s.card.classList.remove('group-start');
      s.card.style.gridColumn = col;
      s.card.style.gridRow = subRow;
      agentGrid.appendChild(s.card);
      if (subRow > maxRowInBatch) maxRowInBatch = subRow;
    });

    col++;
  });

  // 고아 서브에이전트가 남은 경우
  fallbackSubList.forEach(s => {
    if (col > 10) {
      col = 1;
      currentRow = maxRowInBatch + 1;
      maxRowInBatch = currentRow;
    }
    s.card.classList.remove('group-start');
    s.card.style.gridColumn = col;
    s.card.style.gridRow = currentRow;
    agentGrid.appendChild(s.card);
    col++;
  });

  // 레이아웃이 끝난 직후 윈도우 사이즈 동적 조절 통지
  setTimeout(() => requestDynamicResize(), 50);
}

// 윈도우 높이 오토 조절 로직
let resizeObserver = null;
function requestDynamicResize() {
  if (!window.electronAPI || !window.electronAPI.resizeWindow) return;
  const grid = document.getElementById('agent-grid');
  if (!grid) return;

  // grid-template-columns: repeat(auto-fill, 90px) causes width issues if container is small.
  // Use scrollWidth/Height which captures the full extent of grid items.
  const width = grid.scrollWidth;
  const height = grid.scrollHeight;

  // 레이아웃이 완전히 비어있는 상태(40-50px 이하)에서는 리사이즈 요청을 무시하여 
  // 화면이 껌뻑거리거나 본체가 사라지는 현상을 방지합니다.
  if (width < 100 || height < 100) return;

  window.electronAPI.resizeWindow({ width, height });
}

if (window.ResizeObserver) {
  resizeObserver = new ResizeObserver(() => requestDynamicResize());
  if (agentGrid) resizeObserver.observe(agentGrid);
  // Also observe body just in case of font loads or other shifts
  resizeObserver.observe(document.body);
}

// --- Mission Control Dashboard Button ---

function createWebDashboardButton() {
  const button = document.createElement('button');
  button.id = 'web-dashboard-btn';
  button.className = 'web-dashboard-btn';
  button.innerHTML = '🌐 대시보드';
  button.title = '대시보드 열기 (Ctrl+D)';

  button.onclick = async () => {
    button.disabled = true;
    const originalHTML = button.innerHTML;
    button.innerHTML = '⏳ 여는 중...';

    try {
      if (window.electronAPI && window.electronAPI.openWebDashboard) {
        const result = await window.electronAPI.openWebDashboard();

        if (result.success) {
          button.innerHTML = '✓ 열림';
          setTimeout(() => {
            button.innerHTML = '🌐 대시보드';
            button.disabled = false;
          }, 2000);
        } else {
          button.innerHTML = '✗ 실패';
          console.error('[Renderer] Failed to open dashboard:', result.error);
          setTimeout(() => {
            button.innerHTML = originalHTML;
            button.disabled = false;
          }, 2000);
        }
      } else {
        console.error('[Renderer] electronAPI.openWebDashboard not available');
        button.disabled = false;
        button.innerHTML = originalHTML;
      }
    } catch (error) {
      console.error('[Renderer] Error opening dashboard:', error);
      button.innerHTML = '✗ 에러';
      setTimeout(() => {
        button.innerHTML = originalHTML;
        button.disabled = false;
      }, 2000);
    }
  };

  return button;
}


// --- 이벤트 리스너 등록 ---

// Keyboard shortcuts setup
function setupKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    // Ctrl/Cmd + D: Open Mission Control Dashboard
    if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
      e.preventDefault();
      const dashboardBtn = document.getElementById('web-dashboard-btn');
      if (dashboardBtn && !dashboardBtn.disabled) {
        dashboardBtn.click();
      }
    }


    // Ctrl/Cmd + W: Close focused/selected agent
    if ((e.ctrlKey || e.metaKey) && e.key === 'w') {
      e.preventDefault();
      const focusedAgent = document.querySelector('.agent-card[tabindex="0"]:focus') ||
                           document.querySelector('.agent-card:focus');
      if (focusedAgent) {
        const agentId = focusedAgent.dataset.agentId;
        if (agentId && window.electronAPI && window.electronAPI.dismissAgent) {
          window.electronAPI.dismissAgent(agentId);
        }
      }
    }

    // Tab: Navigate between agents
    if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const agents = Array.from(document.querySelectorAll('.agent-card'));
      if (agents.length === 0) return;

      const currentIndex = agents.findIndex(card => card === document.activeElement);

      if (e.shiftKey) {
        // Shift+Tab: Previous agent
        e.preventDefault();
        const prevIndex = currentIndex <= 0 ? agents.length - 1 : currentIndex - 1;
        agents[prevIndex].focus();
      } else if (currentIndex === -1) {
        // Tab: First agent
        e.preventDefault();
        agents[0].focus();
      }
      // Normal Tab: Let browser handle it
    }

    // Escape: Close any overlays/modals
    if (e.key === 'Escape') {
      // Close context menu if open
      const contextMenu = document.querySelector('.context-menu');
      if (contextMenu) {
        contextMenu.remove();
      }
    }

    // Enter: Focus terminal for active agent
    if (e.key === 'Enter') {
      const focusedAgent = document.querySelector('.agent-card:focus') ||
                           document.querySelector('.agent-card[tabindex="0"]:focus');
      if (focusedAgent) {
        const agentId = focusedAgent.dataset.agentId;
        if (agentId && window.electronAPI && window.electronAPI.focusTerminal) {
          window.electronAPI.focusTerminal(agentId);
        }
      }
    }

    // Arrow keys: Navigate between agents
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      const agents = Array.from(document.querySelectorAll('.agent-card'));
      if (agents.length === 0) return;

      const currentIndex = agents.findIndex(card => card === document.activeElement);
      if (currentIndex === -1) return;

      e.preventDefault();

      let nextIndex;
      switch (e.key) {
        case 'ArrowLeft':
          nextIndex = Math.max(0, currentIndex - 1);
          break;
        case 'ArrowRight':
          nextIndex = Math.min(agents.length - 1, currentIndex + 1);
          break;
        case 'ArrowUp':
          // Simple row navigation (approximate)
          nextIndex = Math.max(0, currentIndex - 10);
          break;
        case 'ArrowDown':
          // Simple row navigation (approximate)
          nextIndex = Math.min(agents.length - 1, currentIndex + 10);
          break;
      }

      agents[nextIndex].focus();
    }
  });

  console.log('[Renderer] Keyboard shortcuts registered');
}

// Context menu setup
function setupContextMenu() {
  document.addEventListener('contextmenu', (e) => {
    const agentCard = e.target.closest('.agent-card');
    if (!agentCard) return;

    e.preventDefault();

    const agentId = agentCard.dataset.agentId;
    if (!agentId) return;

    // Remove existing context menu
    const existingMenu = document.querySelector('.context-menu');
    if (existingMenu) existingMenu.remove();

    // Create context menu
    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.innerHTML = `
      <div class="context-menu-item" data-action="focus">
        <span class="menu-icon">🎯</span>
        <span class="menu-label">Focus Terminal</span>
        <span class="menu-shortcut">Enter</span>
      </div>
      <div class="context-menu-item" data-action="logs">
        <span class="menu-icon">📋</span>
        <span class="menu-label">View Logs</span>
      </div>
      <div class="context-menu-item" data-action="timeline">
        <span class="menu-icon">📊</span>
        <span class="menu-label">View Timeline</span>
      </div>
      <div class="context-menu-divider"></div>
      <div class="context-menu-item" data-action="close" class="danger">
        <span class="menu-icon">✕</span>
        <span class="menu-label">Close Agent</span>
        <span class="menu-shortcut">Ctrl+W</span>
      </div>
    `;

    // Position menu
    menu.style.left = `${e.clientX}px`;
    menu.style.top = `${e.clientY}px`;

    // Add click handlers
    menu.querySelectorAll('.context-menu-item').forEach(item => {
      item.addEventListener('click', () => {
        const action = item.dataset.action;

        switch (action) {
          case 'focus':
            if (window.electronAPI && window.electronAPI.focusTerminal) {
              window.electronAPI.focusTerminal(agentId);
            }
            break;
          case 'logs':
            console.log('[ContextMenu] View logs for agent:', agentId);
            // TODO: Implement log viewer
            break;
          case 'timeline':
            console.log('[ContextMenu] View timeline for agent:', agentId);
            // TODO: Implement timeline viewer
            break;
          case 'close':
            if (window.electronAPI && window.electronAPI.dismissAgent) {
              window.electronAPI.dismissAgent(agentId);
            }
            break;
        }

        menu.remove();
      });
    });

    document.body.appendChild(menu);

    // Close menu on click outside
    setTimeout(() => {
      document.addEventListener('click', function closeMenu(e) {
        if (!menu.contains(e.target)) {
          menu.remove();
          document.removeEventListener('click', closeMenu);
        }
      });
    }, 0);
  });

  console.log('[Renderer] Context menu registered');
}

async function init() {
  if (!window.electronAPI) {
    console.error('[Renderer] electronAPI not available');
    return;
  }

  // Setup keyboard shortcuts
  setupKeyboardShortcuts();

  // Setup context menu
  setupContextMenu();

  // 아바타 리스트 로드
  if (window.electronAPI.getAvatars) {
    try {
      const files = await window.electronAPI.getAvatars();
      const validFiles = files.filter(f => f.match(/\.(png|jpe?g|webp|gif)$/i));
      // 0. 또는 _0.를 포함하는 파일을 우선 찾음 (avatar_0.png, avatar_00.png 등)
      const zero = validFiles.find(f => f.includes('0.') || f.includes('_0.'));
      if (zero) idleAvatar = zero;

      availableAvatars = validFiles.filter(f => f !== idleAvatar);
      if (availableAvatars.length === 0 && idleAvatar) {
        availableAvatars.push(idleAvatar);
      }
    } catch (e) {
      console.warn('Failed to load avatars', e);
    }
  }

  // 로드 전 즉시 대기 아바타 표시
  if (idleContainer) {
    idleContainer.style.display = 'flex';
    if (idleCharacter && idleAvatar) {
      idleCharacter.style.backgroundImage = `url('./public/characters/${idleAvatar}')`;
    }
    startIdleAnimation();
  }

  // Create and add Mission Control dashboard button
  const dashboardBtn = createWebDashboardButton();
  document.body.appendChild(dashboardBtn);
  console.log('[Renderer] Mission Control button added');

  // Register event listeners
  window.electronAPI.onAgentAdded(addAgent);
  window.electronAPI.onAgentUpdated(updateAgent);
  window.electronAPI.onAgentRemoved(removeAgent);
  window.electronAPI.onAgentsCleaned(cleanupAgents);

  // Register error event listener (P0-3: Error Recovery)
  if (window.electronAPI.onErrorOccurred) {
    window.electronAPI.onErrorOccurred(createErrorUI);
  }

  // Load existing agents
  try {
    const agents = await window.electronAPI.getAllAgents();
    window.lastAgents = [...agents]; // 정렬용 전역 보관
    console.log(`[Renderer] Loaded ${agents.length} existing agents`);
    for (const agent of agents) {
      addAgent(agent);
    }
    updateGridLayout();
  } catch (err) {
    console.error('[Renderer] Failed to load agents:', err);
  }

  // Signal renderer ready
  window.electronAPI.rendererReady();
  console.log('[Renderer] Initialized');
}

// --- Visibility handling ---

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    // Pause all animations when hidden
    for (const [agentId, state] of agentStates.entries()) {
      if (state.interval) {
        clearInterval(state.interval);
        state.interval = null;
      }
      if (state.timerInterval) {
        clearInterval(state.timerInterval);
        state.timerInterval = null;
      }
    }
  } else {
    // Resume animations when visible
    for (const [agentId, state] of agentStates.entries()) {
      if (state.animName) {
        const card = document.querySelector(`[data-agent-id="${agentId}"]`);
        const character = card?.querySelector('.agent-character');
        if (character) {
          const tempAnim = state.animName;
          state.animName = null; // Reset to force replay
          playAnimation(agentId, character, tempAnim);
        }
      }
    }
  }
});

// --- P0-3: Error Recovery UI ---

// 에어 카운터 (최대 3개까지 표시)
const errorQueue = [];
const MAX_ERRORS = 3;

/**
 * 에러 UI 생성
 */
function createErrorUI(errorContext) {
  // 에러 큐에 추가
  errorQueue.push(errorContext);
  if (errorQueue.length > MAX_ERRORS) {
    errorQueue.shift(); // 가장 오래된 에러 제거
  }

  // 기존 에러 UI 제거
  const existing = document.querySelectorAll('.error-toast');
  existing.forEach(el => el.remove());

  // 새로운 에러 UI 생성
  errorQueue.forEach((err, index) => {
    const toast = document.createElement('div');
    toast.className = 'error-toast';
    toast.setAttribute('data-error-id', err.id);
    toast.setAttribute('role', 'alert');
    toast.setAttribute('aria-live', 'assertive');

    // 심각도별 스타일
    const severityClass = err.severity === 'fatal' ? 'error-fatal' :
      err.severity === 'error' ? 'error-error' :
        err.severity === 'warning' ? 'error-warning' : 'error-info';
    toast.classList.add(severityClass);

    // 에러 내용
    const icon = err.severity === 'fatal' ? '💀' :
      err.severity === 'error' ? '❌' :
        err.severity === 'warning' ? '⚠️' : 'ℹ️';

    toast.innerHTML = `
      <div class="error-header">
        <span class="error-icon">${icon}</span>
        <span class="error-code">${err.code}</span>
        <button class="error-close" aria-label="닫기">×</button>
      </div>
      <div class="error-body">
        <div class="error-title">${err.userMessage}</div>
        <div class="error-explanation">${err.explanation}</div>
      </div>
      <div class="error-actions">
        ${err.recovery.map(action => `
          <button class="error-action-btn" data-action="${action.type}">
            ${action.label}
          </button>
        `).join('')}
      </div>
    `;

    // 위치 계산 (우측 상단)
    toast.style.top = `${10 + index * 120}px`;
    toast.style.right = '10px';

    // 이벤트 리스너
    const closeBtn = toast.querySelector('.error-close');
    closeBtn.addEventListener('click', () => {
      toast.remove();
      const idx = errorQueue.findIndex(e => e.id === err.id);
      if (idx > -1) errorQueue.splice(idx, 1);
    });

    // 복구 액션 버튼
    const actionBtns = toast.querySelectorAll('.error-action-btn');
    actionBtns.forEach(btn => {
      btn.addEventListener('click', async () => {
        const action = btn.dataset.action;
        btn.disabled = true;
        btn.textContent = '처리 중...';

        try {
          if (window.electronAPI && window.electronAPI.executeRecoveryAction) {
            const result = await window.electronAPI.executeRecoveryAction(err.id, action);
            if (result.success) {
              btn.textContent = '✓ 완료';
              setTimeout(() => {
                toast.remove();
                const idx = errorQueue.findIndex(e => e.id === err.id);
                if (idx > -1) errorQueue.splice(idx, 1);
              }, 1500);
            } else {
              btn.textContent = '✗ 실패';
              setTimeout(() => {
                btn.disabled = false;
                btn.textContent = action;
              }, 2000);
            }
          }
        } catch (e) {
          console.error('[ErrorUI] Failed to execute recovery action:', e);
          btn.textContent = '✗ 오류';
          setTimeout(() => {
            btn.disabled = false;
            btn.textContent = action;
          }, 2000);
        }
      });
    });

    document.body.appendChild(toast);
  });
}

// --- Start ---
init();
