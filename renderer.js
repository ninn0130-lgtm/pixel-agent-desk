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
  'Working': { anim: 'working', class: 'state-working', label: '⚡ Working...' },
  'Thinking': { anim: 'working', class: 'state-working', label: '⚡ Working...' },
  'Done': { anim: 'complete', class: 'state-complete', label: '✓ Done!' },
  'Waiting': { anim: 'waiting', class: 'state-waiting', label: '⏳ Waiting...' },
  'Error': { anim: 'alert', class: 'state-alert', label: '⚠️ Error!' },
  'Help': { anim: 'alert', class: 'state-alert', label: '⚠️ Help!' },
  'Offline': { anim: 'waiting', class: 'state-offline', label: '💤 Offline' }
};

// --- 에이전트별 상태 관리 ---
const agentStates = new Map(); // agentId -> { animName, frameIdx, interval, startTime, timerInterval, lastFormattedTime }

// --- 아바타 관리 ---
let availableAvatars = [];
let idleAvatar = 'avatar_0.png';
const agentAvatars = new Map(); // agentId -> random avatar path

// --- 유틸리티 함수 ---

function formatTime(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function drawFrame(element, frameIndex) {
  if (!element) return;
  const col = frameIndex % SHEET.cols;
  const row = Math.floor(frameIndex / SHEET.cols);
  const x = col * -SHEET.width;
  const y = row * -SHEET.height;
  element.style.backgroundPosition = `${x}px ${y}px`;
}

function playAnimation(agentId, element, animName) {
  const sequence = ANIM_SEQUENCES[animName];
  if (!sequence) return;

  const state = agentStates.get(agentId) || {};
  const prevAnim = state.animName;

  if (prevAnim === animName) return; // Already playing this animation

  // Clear previous interval
  if (state.interval) {
    clearInterval(state.interval);
  }

  // Update state
  state.animName = animName;
  state.frameIdx = 0;
  agentStates.set(agentId, state);

  // Draw first frame immediately
  drawFrame(element, sequence.frames[0]);

  // Start animation loop
  const interval = setInterval(() => {
    const currentState = agentStates.get(agentId);
    if (!currentState) {
      clearInterval(interval);
      return;
    }

    currentState.frameIdx++;

    if (currentState.frameIdx >= sequence.frames.length) {
      if (sequence.loop) {
        currentState.frameIdx = 0;
      } else {
        clearInterval(interval);
        return;
      }
    }

    drawFrame(element, sequence.frames[currentState.frameIdx]);
  }, 1000 / sequence.fps);

  // Store interval in state
  state.interval = interval;
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
      if (agentState.timerInterval) {
        clearInterval(agentState.timerInterval);
      }

      agentState.timerInterval = setInterval(() => {
        const elapsed = Date.now() - agentState.startTime;
        agentState.lastFormattedTime = formatTime(elapsed);
        if (bubble) {
          bubble.textContent = `${config.label} (${agentState.lastFormattedTime})`;
        }
      }, 1000);
    }

    // Immediate display
    const elapsed = Date.now() - agentState.startTime;
    agentState.lastFormattedTime = formatTime(elapsed);
    if (bubble) {
      bubble.textContent = `${config.label} (${agentState.lastFormattedTime})`;
    }

  } else if (config.anim === 'complete') {
    // Task complete - stop timer and keep final time
    if (agentState.timerInterval) {
      clearInterval(agentState.timerInterval);
      agentState.timerInterval = null;
    }
    if (bubble) {
      const finalTime = agentState.lastFormattedTime || '00:00';
      bubble.textContent = `${config.label} (${finalTime})`;
    }
    agentState.startTime = null;

  } else {
    // Other states - clear timer
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
    typeLabel = 'Sub';
    typeClass = 'type-sub';
  } else if (agent.isTeammate) {
    typeLabel = 'Team';
    typeClass = 'type-team';
  }
  card.classList.add(typeClass);

  // 상단 배지 (프로젝트명 + 타입)
  const header = document.createElement('div');
  header.className = 'agent-header';

  const projectTagWrapper = document.createElement('div');
  projectTagWrapper.className = 'project-tag-wrapper';
  projectTagWrapper.setAttribute('data-full-path', agent.projectPath || 'No Path');

  const projectTag = document.createElement('span');
  projectTag.className = 'project-tag';
  projectTag.textContent = agent.projectPath ? agent.projectPath.split(/[\\/]/).pop() : 'Default';

  projectTagWrapper.appendChild(projectTag);

  const typeTag = document.createElement('span');
  typeTag.className = `type-tag ${typeClass}`;
  typeTag.textContent = typeLabel;

  header.appendChild(projectTagWrapper);
  header.appendChild(typeTag);
  card.appendChild(header);

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
  card.appendChild(header);
  card.appendChild(bubble);
  card.appendChild(character);
  card.appendChild(nameBadge);

  // 캐릭터 영역에만 클릭 이벤트 (터미널 표출 및 상호작용) 할당
  character.style.cursor = 'pointer';
  character.setAttribute('role', 'button');
  character.setAttribute('tabindex', '0');
  character.setAttribute('aria-label', `Focus terminal for ${agent.displayName || 'Agent'}`);

  // 찌르기(Poke) 상호작용 - 터미널 포커스 대신 재미있는 반응 추가
  const pokeMessages = [
    "앗, 깜짝이야!",
    "열심히 일하는 중입니다!",
    "코드 짜는 중... 💻",
    "커피가 필요해요 ☕",
    "이 부분 버그 아니죠?",
    "간지러워요!",
    "제 타수 엄청 빠르죠?",
    "칭찬해주세요! 🌟"
  ];

  let pokeTimeout = null;
  character.onclick = (e) => {
    e.stopPropagation(); // 카드 밖 영역 등 상위로 전파 방지

    // 1. 터미널 포커스 호출 (실제 PID 활용)
    if (window.electronAPI && window.electronAPI.focusTerminal) {
      window.electronAPI.focusTerminal(agent.id);
    }

    // 2. 찌르기 반응 (시각적 피드백)
    if (pokeTimeout) return;
    const originalText = bubble.textContent;
    const originalBorder = bubble.style.borderColor;

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
    if (idleContainer) idleContainer.style.display = 'flex';
    // Remove all old wrappers
    while (agentGrid.firstChild) agentGrid.removeChild(agentGrid.firstChild);
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

  // Clear grid contents nicely (preserve elements but detach them)
  while (agentGrid.firstChild) {
    agentGrid.removeChild(agentGrid.firstChild);
  }

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

    // 메인 에이전트 넘버링 처리
    const nameBadge = mainItem.card.querySelector('.agent-name');
    const typeTag = mainItem.card.querySelector('.type-tag');

    const label = `Main_${mainIndex}`;
    if (typeTag) typeTag.textContent = label;
    if (nameBadge) {
      if (nameBadge.textContent === 'Main' || nameBadge.textContent === 'Agent' || nameBadge.style.display === 'none' || nameBadge.textContent.startsWith('Main_')) {
        nameBadge.textContent = label;
        nameBadge.style.display = 'block';
      }
    }
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
  button.innerHTML = '🌐 View as Web';
  button.title = 'Open Mission Control Dashboard';

  button.onclick = async () => {
    button.disabled = true;
    const originalHTML = button.innerHTML;
    button.innerHTML = '⏳ Opening...';

    try {
      if (window.electronAPI && window.electronAPI.openWebDashboard) {
        const result = await window.electronAPI.openWebDashboard();

        if (result.success) {
          button.innerHTML = '✓ Opened';
          setTimeout(() => {
            button.innerHTML = '🌐 View as Web';
            button.disabled = false;
          }, 2000);
        } else {
          button.innerHTML = '✗ Failed';
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
      button.innerHTML = '✗ Error';
      setTimeout(() => {
        button.innerHTML = originalHTML;
        button.disabled = false;
      }, 2000);
    }
  };

  return button;
}

// --- 이벤트 리스너 등록 ---

async function init() {
  if (!window.electronAPI) {
    console.error('[Renderer] electronAPI not available');
    return;
  }

  // 아바타 리스트 로드
  if (window.electronAPI.getAvatars) {
    try {
      const files = await window.electronAPI.getAvatars();
      const validFiles = files.filter(f => f.match(/\.(png|jpe?g|webp|gif)$/i));
      const zero = validFiles.find(f => f.includes('_0.') || f === 'avatar_00.png' || f === 'avatar_0.png');
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
