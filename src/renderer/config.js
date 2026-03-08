/**
 * Renderer Config — constants, sprite settings, state maps
 */

// --- DOM Elements ---
const agentGrid = document.getElementById('agent-grid');

// --- Sprite sheet settings ---
const SHEET = {
  cols: 8,  // 384px / 48px = 8 cols × 9 rows = 72 frames
  width: 48,
  height: 64
};

// --- Animation sequences ---
// Frame layout (8 cols × 9 rows, 4 frames per action):
//   Row 0: front_idle(0-3)  front_walk(4-7)
//   Row 1: front_sit_idle(8-11)  front_sit_work(12-15)
//   Row 2: left_idle(16-19)  left_walk(20-23)
//   Row 3: left_sit_idle(24-27)  left_sit_work(28-31)
//   Row 4: right_idle(32-35)  right_walk(36-39)
//   Row 5: right_sit_idle(40-43)  right_sit_work(44-47)
//   Row 6: back_idle(48-51)  back_walk(52-55)
//   Row 7: back_sit_idle(56-59)  back_sit_work(60-63)
//   Row 8: front_done_dance(64-67)  front_alert_jump(68-71)
const ANIM_SEQUENCES = {
  working:  { frames: [64, 65, 66, 67], fps: 8, loop: true },  // front_done_dance
  complete: { frames: [68, 69, 70, 71], fps: 4, loop: true },  // front_alert_jump
  waiting:  { frames: [0, 1, 2, 3],     fps: 4, loop: true },  // front_idle
  alert:    { frames: [68, 69, 70, 71], fps: 4, loop: true },  // front_alert_jump
};

// --- State-to-config mapping ---
const stateConfig = {
  'Working': { anim: 'working', class: 'state-working', label: 'Working...' },
  'Thinking': { anim: 'working', class: 'state-working', label: 'Thinking...' },
  'Done': { anim: 'complete', class: 'state-complete', label: 'Done!' },
  'Waiting': { anim: 'waiting', class: 'state-waiting', label: 'Waiting...' },
  'Error': { anim: 'alert', class: 'state-alert', label: 'Error!' },
  'Help': { anim: 'alert', class: 'state-alert', label: 'Help!' },
  'Offline': { anim: 'waiting', class: 'state-offline', label: 'Offline' }
};

// --- Shared agent data (replaces window.lastAgents) ---
let lastAgents = [];

// --- Per-agent state management ---
const agentStates = new Map(); // agentId -> { animName, frameIdx, rafId, startTime, timerInterval, lastFormattedTime }

// --- Avatar management ---
// Same list as office view (office-config.js) — must be kept in sync
const AVATAR_FILES = [
  'avatar_0.webp','avatar_1.webp','avatar_2.webp','avatar_3.webp',
  'avatar_4.webp','avatar_5.webp','avatar_6.webp','avatar_7.webp',
];
let availableAvatars = [];
let idleAvatar = 'avatar_0.webp';
const agentAvatars = new Map(); // agentId -> avatar filename

/** Agent ID -> deterministic avatar filename (produces same result as office view) */
function avatarFromAgentId(id) {
  let hash = 0;
  const str = id || '';
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return AVATAR_FILES[Math.abs(hash) % AVATAR_FILES.length];
}
