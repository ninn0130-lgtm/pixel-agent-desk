/**
 * Agent Grid — add/update/remove Agent, updateGridLayout, resize
 */

function addAgent(agent) {
  if (document.querySelector(`[data-agent-id="${agent.id}"]`)) {
    return;
  }

  const card = createAgentCard(agent);
  agentGrid.appendChild(card);

  if (!window.lastAgents) window.lastAgents = [];
  if (!window.lastAgents.some(a => a.id === agent.id)) {
    window.lastAgents.push(agent);
  }

  updateAgentState(agent.id, card, agent);
  updateGridLayout();
  requestDynamicResize();
}

function updateAgent(agent) {
  const card = document.querySelector(`[data-agent-id="${agent.id}"]`);
  if (!card) return;

  if (window.lastAgents) {
    const idx = window.lastAgents.findIndex(a => a.id === agent.id);
    if (idx > -1) {
      window.lastAgents[idx] = agent;
    } else {
      window.lastAgents.push(agent);
    }
  }

  // 에이전트 타입 변경 감지 (auto-create로 Main 생성 후 SubagentStart로 Sub 전환 시)
  const wasSubagent = card.classList.contains('is-subagent');
  const wasTeammate = card.classList.contains('is-teammate');
  const typeChanged = (!!agent.isSubagent !== wasSubagent) || (!!agent.isTeammate !== wasTeammate);

  updateAgentState(agent.id, card, agent);

  if (typeChanged) {
    updateGridLayout();
    requestDynamicResize();
  }
}

function removeAgent(data) {
  const card = document.querySelector(`[data-agent-id="${data.id}"]`);
  if (!card) return;

  // 애니메이션 메모리 정리
  animationManager.stop(data.id);

  const state = agentStates.get(data.id);
  if (state) {
    if (state.interval) {
      clearInterval(state.interval);
      state.interval = null;
    }
    if (state.timerInterval) {
      clearInterval(state.timerInterval);
      state.timerInterval = null;
    }
  }
  agentStates.delete(data.id);
  agentAvatars.delete(data.id);

  // 퇴장 애니메이션 후 DOM 제거
  card.classList.add('removing');
  setTimeout(() => {
    card.remove();
    updateGridLayout();
    requestDynamicResize();
  }, 250);
}

function cleanupAgents(data) {
  updateGridLayout();
}

// --- 빈 상태(에이전트 0개) 대기 아바타 ---
const idleContainer = document.getElementById('container');
const idleCharacter = document.getElementById('character');
const idleBubble = document.getElementById('speech-bubble');

function startIdleAnimation() {
  if (!idleCharacter) return;
  const seq = ANIM_SEQUENCES.waiting;
  drawFrameOn(idleCharacter, seq.frames[0]);
  idleBubble.textContent = 'Waiting...';
}

function drawFrameOn(el, frameIndex) {
  if (!el) return;
  const col = frameIndex % SHEET.cols;
  const row = Math.floor(frameIndex / SHEET.cols);
  // 싱글 캐릭터는 1.5배 확대 (72x96, bg 648x384)
  const fw = 72;
  const fh = 96;
  el.style.backgroundPosition = `${col * -fw}px ${row * -fh}px`;
}

function updateGridLayout() {
  const cards = Array.from(agentGrid.querySelectorAll('.agent-card'));
  if (cards.length === 0) {
    agentGrid.classList.remove('has-multiple');
    agentGrid.querySelectorAll('.agent-party-bg').forEach(el => el.remove());
    if (idleContainer) {
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

    if (col > 10) {
      col = 1;
      currentRow = maxRowInBatch + 1;
      maxRowInBatch = currentRow;
    }

    const bgBox = document.createElement('div');
    bgBox.className = 'agent-party-bg';
    bgBox.style.gridColumn = col;
    bgBox.style.gridRow = `${currentRow} / span ${1 + mySubs.length}`;
    agentGrid.appendChild(bgBox);

    mainItem.card.classList.remove('group-start');
    mainItem.card.style.gridColumn = col;
    mainItem.card.style.gridRow = currentRow;
    agentGrid.appendChild(mainItem.card);

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

}

// 윈도우 크기 조절 (에이전트 추가/제거 시에만 호출, 500ms 쓰로틀)
let _resizeTimer = null;
function requestDynamicResize() {
  if (!window.electronAPI || !window.electronAPI.resizeWindow) return;
  if (_resizeTimer) return;
  _resizeTimer = setTimeout(() => {
    _resizeTimer = null;
    const grid = document.getElementById('agent-grid');
    if (!grid) return;
    const width = grid.scrollWidth;
    const height = grid.scrollHeight;
    if (width < 100 || height < 100) return;
    window.electronAPI.resizeWindow({ width, height });
  }, 500);
}
