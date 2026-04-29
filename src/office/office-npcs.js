/**
 * Office NPCs — Static support-staff characters that wander predefined zones.
 *
 * Goals:
 *   - Make the office feel populated even when only a few real agents run.
 *   - Stay completely out of AgentManager / dashboard stats. NPCs are inserted
 *     directly into officeCharacters.characters, never via SSE.
 *   - Never occupy desks (no entry in seatAssignments). Real agents always win.
 *   - Wander only within their homeZone box (lounge / terrace) or within the
 *     meeting-room desk cluster (no sitting — just standing around).
 *
 * Visual differentiation is handled by office-ui.js (`agent.isNpc === true`
 * triggers dimmed nametag).
 */

/* eslint-disable no-unused-vars */

// Hardcoded NPC roster. id prefix `npc-` is enforced. avatarIndex collisions
// with real agents are fine — NPCs are visually dimmed.
const NPC_ROSTER = [
  { id: 'npc-001', displayName: '이지윤', role: '인턴',     avatarIndex: 0, homeZone: 'lounge'  },
  { id: 'npc-002', displayName: '박민호', role: '경리',     avatarIndex: 3, homeZone: 'lounge'  },
  { id: 'npc-003', displayName: '김서아', role: '디자이너', avatarIndex: 5, homeZone: 'meeting' },
  { id: 'npc-004', displayName: '정하늘', role: '에디터',   avatarIndex: 2, homeZone: 'meeting' },
  { id: 'npc-005', displayName: '최유진', role: '리셉션',   avatarIndex: 7, homeZone: 'lounge'  },
  { id: 'npc-006', displayName: '강도윤', role: '회계사',   avatarIndex: 1, homeZone: 'terrace' },
  { id: 'npc-007', displayName: '윤소연', role: '비서',     avatarIndex: 6, homeZone: 'terrace' },
];

var officeNpcs = {
  // homeZone -> { x1, y1, x2, y2 } resolved at spawn time
  zoneBounds: {},

  /** Compute meeting-zone bounding box from officeCoords.desk[type==='meeting']. */
  _computeMeetingBounds: function () {
    const desk = (typeof officeCoords !== 'undefined' && officeCoords.desk) || [];
    const meetingPts = desk.filter(function (d) { return d.type === 'meeting'; });
    if (meetingPts.length === 0) return null;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    meetingPts.forEach(function (p) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    });

    // Pad outward by ~1 tile so NPCs orbit the meeting table rather than
    // standing exactly on chair coords (chairs are real-agent territory).
    const TILE = (typeof OFFICE !== 'undefined' && OFFICE.TILE_SIZE) || 32;
    return {
      zone: 'meeting',
      x1: minX - TILE,
      y1: minY - TILE,
      x2: maxX + TILE,
      y2: maxY + TILE,
    };
  },

  /** Snap an arbitrary (x,y) onto the nearest walkable tile center. */
  _snapWalkable: function (x, y) {
    if (typeof officePathfinder === 'undefined' || officePathfinder.gridW === 0) {
      return { x: x, y: y };
    }
    const TILE = OFFICE.TILE_SIZE;
    const gx = Math.max(0, Math.min(officePathfinder.gridW - 1, Math.floor(x / TILE)));
    const gy = Math.max(0, Math.min(officePathfinder.gridH - 1, Math.floor(y / TILE)));
    if (officePathfinder.isWalkable(gx, gy)) {
      return { x: gx * TILE + 16, y: gy * TILE + 16 };
    }
    const w = officePathfinder.findNearestWalkable(gx, gy);
    return { x: w.x * TILE + 16, y: w.y * TILE + 16 };
  },

  /** True if (x,y) is at least one tile away from every desk coordinate. */
  _isClearOfDesks: function (x, y) {
    const desk = (typeof officeCoords !== 'undefined' && officeCoords.desk) || [];
    if (desk.length === 0) return true;
    const TILE = (typeof OFFICE !== 'undefined' && OFFICE.TILE_SIZE) || 32;
    const minDist = TILE; // ≥ 1 tile (32px) clearance
    for (let i = 0; i < desk.length; i++) {
      const d = desk[i];
      const dx = d.x - x;
      const dy = d.y - y;
      if (dx * dx + dy * dy < minDist * minDist) return false;
    }
    return true;
  },

  /** Random walkable point inside zone box; falls back to box center.
   *  Rejects candidates within 1 tile of any desk coordinate so meeting-zone
   *  NPCs don't end up standing on the conference table (code-reviewer #1). */
  _randomPointInZone: function (zone) {
    const bounds = this.zoneBounds[zone];
    if (!bounds) return null;

    // Up to 8 attempts to land on a walkable tile inside the box AND clear of
    // desk coordinates. If all 8 attempts fail, return null — caller will pass
    // this NPC's tick (no popping outside the room, no desk-clipping).
    for (let i = 0; i < 8; i++) {
      const rx = bounds.x1 + Math.random() * (bounds.x2 - bounds.x1);
      const ry = bounds.y1 + Math.random() * (bounds.y2 - bounds.y1);
      if (typeof officePathfinder === 'undefined' || officePathfinder.gridW === 0) {
        if (this._isClearOfDesks(rx, ry)) return { x: rx, y: ry };
        continue;
      }
      const gx = Math.floor(rx / OFFICE.TILE_SIZE);
      const gy = Math.floor(ry / OFFICE.TILE_SIZE);
      if (officePathfinder.isWalkable(gx, gy)) {
        const cx = gx * OFFICE.TILE_SIZE + 16;
        const cy = gy * OFFICE.TILE_SIZE + 16;
        if (this._isClearOfDesks(cx, cy)) return { x: cx, y: cy };
      }
    }
    // All 8 retries failed (zone is desk-dense) — skip this NPC tick.
    return null;
  },

  /**
   * Spawn the full NPC roster into officeCharacters.characters.
   * Idempotent — re-calling will not add duplicates.
   * Must be called AFTER officeCoords is parsed and pathfinder is ready.
   */
  spawn: function () {
    if (typeof officeCharacters === 'undefined' || typeof AVATAR_FILES === 'undefined') return;
    if (AVATAR_FILES.length === 0) return;

    // Resolve zone bounds (lounge/terrace are static; meeting is dynamic).
    this.zoneBounds.lounge = LOUNGE_AREA;
    this.zoneBounds.terrace = TERRACE_AREA;
    const meetingBounds = this._computeMeetingBounds();
    if (meetingBounds) {
      this.zoneBounds.meeting = meetingBounds;
    } else {
      // No meeting room found — re-route those NPCs to lounge.
      console.warn('[NPC] meeting zone unavailable in officeCoords, redirecting NPCs to lounge');
      this.zoneBounds.meeting = LOUNGE_AREA;
    }

    for (let i = 0; i < NPC_ROSTER.length; i++) {
      const def = NPC_ROSTER[i];
      if (officeCharacters.characters.has(def.id)) continue;

      const start = this._randomPointInZone(def.homeZone) || { x: 200, y: 200 };
      const avatarIdx = def.avatarIndex % AVATAR_FILES.length;
      const avatarFile = AVATAR_FILES[avatarIdx] || AVATAR_FILES[0];

      const char = {
        id: def.id,
        x: start.x,
        y: start.y,
        path: [],
        pathIndex: 0,
        facingDir: 'down',
        avatarFile: avatarFile,
        skinIndex: avatarIdx,
        deskIndex: undefined,
        currentAnim: 'down_idle',
        animFrame: 0,
        animTimer: 0,
        agentState: 'idle',
        restTimer: 0,
        bubble: null,
        role: def.displayName + ' · ' + def.role,
        // NPC flags consumed by office-character.updateAll and office-ui.
        isNpc: true,
        homeZone: def.homeZone,
        npcIdleUntil: performance.now() + 500 + Math.random() * 1500,
        metadata: {
          name: def.displayName,
          project: '',
          tool: null,
          type: 'npc',
          status: 'idle',
          lastMessage: null,
        },
      };

      officeCharacters.characters.set(def.id, char);
    }
  },

  /**
   * Per-frame update for a single NPC. Called by officeCharacters.updateAll
   * before _updateTarget when char.isNpc is true. Returns true if it handled
   * the character (caller should skip default _updateTarget logic).
   */
  updateNpc: function (char) {
    if (!char || !char.isNpc) return false;

    // Still walking along an active path — let _updateMovement handle it.
    if (char.path && char.path.length > 0 && char.pathIndex < char.path.length) {
      return true;
    }

    // Idle dwell timer: pause briefly on arrival before picking new target.
    const now = performance.now();
    if (now < (char.npcIdleUntil || 0)) {
      // While idling, force a non-walking idle pose facing current direction.
      char.currentAnim = (char.facingDir || 'down') + '_idle';
      return true;
    }

    // Pick a fresh wander target inside homeZone.
    const dest = this._randomPointInZone(char.homeZone);
    if (!dest) {
      char.npcIdleUntil = now + 3000;
      return true;
    }

    // Avoid bouncing in place: skip targets too close to current position.
    if (Math.abs(dest.x - char.x) < 12 && Math.abs(dest.y - char.y) < 12) {
      char.npcIdleUntil = now + 1000 + Math.random() * 1500;
      return true;
    }

    char.path = officePathfinder.findPath(char.x, char.y, dest.x, dest.y);
    char.pathIndex = 0;

    // Schedule next idle period after this walk finishes (consumed when path
    // empties on next frame).
    char.npcIdleUntil = now + 2000 + Math.random() * 3000;
    return true;
  },
};
