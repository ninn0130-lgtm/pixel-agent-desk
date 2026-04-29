/**
 * Agent Card — updateAgentState, createAgentCard
 */

import { stateConfig, agentStates, agentAvatars, AVATAR_FILES, avatarFromAgentId } from './config.js';
import { playAnimation } from './animationManager.js';

// Mirror BUBBLE_MAX from src/office/office-character.js so the Working label
// (tool + ': ' + target) is consistent across mainWindow's compact 72px
// bubble and the canvas bubbles in dashboardWindow / pipWindow. The bubble
// CSS clips at 72px with text-overflow:ellipsis already; this cap keeps the
// JS-level string from growing unboundedly and keeps the hover title sane.
const BUBBLE_MAX = 38;
function fitBubbleText(s) {
  if (!s) return s;
  return s.length <= BUBBLE_MAX ? s : s.slice(0, BUBBLE_MAX - 1) + '…';
}

export function updateAgentState(agentId, container, agentOrState) {
  const isAgentObj = typeof agentOrState === 'object';
  const state = isAgentObj ? agentOrState.state : agentOrState;
  const isAggregated = isAgentObj && agentOrState.isAggregated;

  const baseConfig = stateConfig[state] || stateConfig['Waiting'];
  const config = { ...baseConfig };
  // fullLabel: untruncated text used for ARIA and hover tooltip. Defaults
  // to the visible label; overridden when a Working tool/target composes a
  // longer string than fits the 72px bubble.
  config.fullLabel = config.label;

  if (isAggregated) {
    config.label = "Managing...";
    config.fullLabel = "Managing...";
  }

  const currentTool = isAgentObj ? agentOrState.currentTool : null;
  const currentToolTarget = isAgentObj ? agentOrState.currentToolTarget : null;
  if (currentTool && state === 'Working') {
    const full = currentToolTarget ? currentTool + ': ' + currentToolTarget : currentTool;
    config.fullLabel = full;
    config.label = fitBubbleText(full);
  }

  const bubble = container.querySelector('.agent-bubble');
  const character = container.querySelector('.agent-character');

  // Update ARIA label — use fullLabel so screen readers get the untruncated
  // text (e.g., "Bash: ssh root@host" rather than "Bash: ssh root@h…").
  const agentDisplayName = container.querySelector('.agent-name')?.textContent || 'Agent';
  container.setAttribute('aria-label', `${agentDisplayName} - ${config.fullLabel}`);

  // Update container class + data-state for CSS selector targeting
  container.className = `agent-card ${config.class}`;
  container.setAttribute('data-state', state ? state.toLowerCase() : 'waiting');
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

  // Timer element (pre-created in createAgentCard)
  const timerEl = container.querySelector('.agent-timer');

  // Timer logic
  if (config.anim === 'working') {
    if (!agentState.startTime) {
      agentState.startTime = Date.now();
    }
    if (!agentState.timerInterval) {
      agentState.timerInterval = setInterval(() => {
        const elapsed = Date.now() - agentState.startTime;
        agentState.lastFormattedTime = window.electronAPI.formatTime(elapsed);
        if (timerEl) timerEl.textContent = agentState.lastFormattedTime;
      }, 1000);
    }

    const elapsed = Date.now() - agentState.startTime;
    agentState.lastFormattedTime = window.electronAPI.formatTime(elapsed);
    if (bubble) {
      bubble.textContent = config.label;
      bubble.title = config.fullLabel;
    }
    if (timerEl) {
      timerEl.textContent = agentState.lastFormattedTime;
      timerEl.style.visibility = 'visible';
    }

  } else if (config.anim === 'complete') {
    if (agentState.timerInterval) {
      clearInterval(agentState.timerInterval);
      agentState.timerInterval = null;
    }
    if (bubble) {
      bubble.textContent = config.label;
      bubble.title = config.fullLabel;
    }
    if (timerEl) {
      timerEl.textContent = agentState.lastFormattedTime || '00:00';
      timerEl.style.visibility = 'visible';
    }

  } else {
    if (agentState.timerInterval) {
      clearInterval(agentState.timerInterval);
      agentState.timerInterval = null;
    }
    agentState.startTime = null;
    agentState.lastFormattedTime = '';
    if (timerEl) timerEl.style.visibility = 'hidden';
    if (bubble) {
      // Thinking state: show animated dots
      if (state === 'Thinking' && !isAggregated) {
        bubble.innerHTML = '<span class="thinking-dots"><span>.</span><span>.</span><span>.</span></span>';
        bubble.title = config.fullLabel;
      } else {
        bubble.textContent = config.label;
        bubble.title = config.fullLabel;
      }
    }
  }

  agentStates.set(agentId, agentState);
}

// --- Satellite (mini avatar) DOM creators ---

export function createSatelliteTray() {
  const tray = document.createElement('div');
  tray.className = 'satellite-tray';
  return tray;
}

export function createMiniAvatar(agent) {
  const mini = document.createElement('div');
  mini.className = 'mini-avatar';
  mini.dataset.agentId = agent.id;
  mini.dataset.state = (agent.state || 'waiting').toLowerCase();

  // Assign avatar sprite (50% scale background)
  let assignedAvatar = agentAvatars.get(agent.id);
  if (!assignedAvatar) {
    if (agent.avatarIndex !== undefined && agent.avatarIndex !== null && AVATAR_FILES[agent.avatarIndex]) {
      assignedAvatar = AVATAR_FILES[agent.avatarIndex];
    } else {
      assignedAvatar = avatarFromAgentId(agent.id);
    }
    agentAvatars.set(agent.id, assignedAvatar);
  }
  if (assignedAvatar) {
    mini.style.backgroundImage = `url('./public/characters/${assignedAvatar}')`;
  }

  // Tooltip
  const label = agent.displayName || agent.agentType || 'Sub';
  const stateLabel = agent.state || 'Waiting';
  mini.title = `${label} — ${stateLabel}`;

  // Click -> focus terminal
  mini.onclick = async (e) => {
    e.stopPropagation();
    if (window.electronAPI && window.electronAPI.focusTerminal) {
      await window.electronAPI.focusTerminal(agent.id);
    }
  };

  return mini;
}

export function createAgentCard(agent) {
  const card = document.createElement('div');
  card.className = 'agent-card';
  card.dataset.agentId = agent.id;
  card.tabIndex = 0;

  card.setAttribute('role', 'article');
  card.setAttribute('aria-label', `${agent.displayName || 'Agent'} - ${agent.state || 'Waiting'}`);

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

  // Assign avatar per agent — server-assigned avatarIndex first, fallback: hash
  let assignedAvatar = agentAvatars.get(agent.id);
  if (!assignedAvatar) {
    if (agent.avatarIndex !== undefined && agent.avatarIndex !== null && AVATAR_FILES[agent.avatarIndex]) {
      assignedAvatar = AVATAR_FILES[agent.avatarIndex];
    } else {
      assignedAvatar = avatarFromAgentId(agent.id);
    }
    agentAvatars.set(agent.id, assignedAvatar);
  }

  if (assignedAvatar) {
    character.style.backgroundImage = `url('./public/characters/${assignedAvatar}')`;
  }

  // Card type class (for CSS color distinction only)
  const typeClass = agent.isSubagent ? 'type-sub' : (agent.isTeammate ? 'type-team' : 'type-main');
  card.classList.add(typeClass);

  // Top badge — unified to project basename
  const basename = agent.projectPath ? agent.projectPath.replace(/[\\/]+$/, '').split(/[\\/]/).pop() : '';
  const typeTag = document.createElement('span');
  typeTag.className = `type-tag ${typeClass}`;
  typeTag.textContent = basename || 'Agent';
  typeTag.title = agent.projectPath || '';

  // Agent name — show slug-based name only (omit project folder name)
  const nameBadge = document.createElement('div');
  nameBadge.className = 'agent-name';
  const hasSlugName = agent.slug && agent.displayName && agent.displayName !== 'Agent';
  nameBadge.textContent = hasSlugName ? agent.displayName : '';
  nameBadge.title = agent.projectPath || '';
  if (!hasSlugName) nameBadge.style.display = 'none';

  // Timer element (pre-created to avoid dynamic DOM insertion in updateAgentState)
  const timerEl = document.createElement('div');
  timerEl.className = 'agent-timer';
  timerEl.style.visibility = 'hidden';

  // Satellite tray (for mini child avatars)
  const satelliteTray = createSatelliteTray();

  // Assemble card (satellite tray first = visually top)
  card.appendChild(satelliteTray);
  card.appendChild(typeTag);
  card.appendChild(bubble);
  card.appendChild(timerEl);
  card.appendChild(character);
  card.appendChild(nameBadge);

  // Terminal focus button
  const focusBtn = document.createElement('button');
  focusBtn.className = 'focus-terminal-btn';
  focusBtn.innerHTML = '<span class="focus-icon">&#xF0;</span>';
  focusBtn.title = 'Focus terminal (click to switch to this terminal)';
  focusBtn.setAttribute('aria-label', `Focus terminal for ${agent.displayName || 'Agent'}`);
  focusBtn.onclick = async (e) => {
    e.stopPropagation();
    if (window.electronAPI && window.electronAPI.focusTerminal) {
      const result = await window.electronAPI.focusTerminal(agent.id);
      if (result && result.success) {
        focusBtn.classList.add('clicked');
        setTimeout(() => focusBtn.classList.remove('clicked'), 300);
      } else {
        // Shake animation on failure
        focusBtn.style.animation = 'shake 0.3s ease';
        focusBtn.title = 'Could not find PID';
        setTimeout(() => {
          focusBtn.style.animation = '';
          focusBtn.title = 'Focus terminal';
        }, 1500);
      }
    }
  };
  card.appendChild(focusBtn);

  // Character poke interaction
  character.style.cursor = 'pointer';
  const pokeMessages = [
    "Eek, you startled me!",
    "Hard at work here!",
    "Writing code...",
    "Need more coffee",
    "This isn't a bug, right?",
    "That tickles!",
    "Pretty fast typing, huh?",
    "Say something nice!"
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
