# CLAUDE.md — Pixel Agent Desk

Electron app that visualizes Claude Code CLI status as pixel avatars. Pure JS, Canvas rendering, HTTP hooks (:47821).

## Rules

- Do not change IPC channel names, hookSchema `additionalProperties: true`, or AVATAR_FILES sync between `renderer/config.js` and `office/office-config.js`.
- Avatar lifecycle is fully PID-based (liveness checker) — do not add timer-based or manual dismiss mechanisms.

## Commands

- Run: `npm start`
- Tests: `npm test`

## Architecture

```
Claude CLI ──HTTP hook──▶ POST(:47821) ──▶ hookProcessor
                                              │
                                    ┌─────────┤
                                    ▼         ▼
                              agentManager  agent-desk-server(:3000)
                                  │              │
                                  ▼         ┌───┴──────────┐
                            renderer/*      ▼              ▼
                          (pixel avatar) dashboard.html  pip.html
                                         (agent desk)  (PiP floating)
```

### Key Modules

| Module | File | Role |
|--------|------|------|
| Main | `src/main.js` | Module init, event wiring, app lifecycle |
| Hook Server | `src/main/hookServer.js` | HTTP :47821, AJV schema validation |
| Hook Processor | `src/main/hookProcessor.js` | Event switch + state mapping |
| Hook Registration | `src/main/hookRegistration.js` | Claude CLI hook auto-registration |
| Liveness Checker | `src/main/livenessChecker.js` | PID detection, zombie sweep (2s/30s) |
| Window Manager | `src/main/windowManager.js` | Electron window lifecycle, dashboard/PiP server |
| IPC Handlers | `src/main/ipcHandlers.js` | IPC channel handlers, terminal focus, PiP toggle |
| Session Persistence | `src/main/sessionPersistence.js` | State persistence, session recovery |
| Agent Manager | `src/agentManager.js` | Agent state Map, event emitting (SSoT) |
| Dashboard Adapter | `src/dashboardAdapter.js` | Agent state → dashboard format mapping |
| Agent Desk Server | `src/dashboard-server.js` | REST API + SSE for Agent Desk |
| Session Scanner | `src/sessionScanner.js` | JSONL parsing for token/cost stats |
| Heatmap Scanner | `src/heatmapScanner.js` | Daily activity aggregation (GitHub-style) |
| Pricing | `src/pricing.js` | Per-model token pricing, context window sizes |
| Error Handler | `src/errorHandler.js` | Error capture, logging, deduplication |
| Utils | `src/utils.js` | Display name formatting, window sizing |
| Dashboard Preload | `src/dashboardPreload.js` | IPC bridge for dashboard window |
| PiP Preload | `src/pipPreload.js` | IPC bridge for PiP window (close, backToDashboard) |
| Renderer | `src/renderer/*.js` | Pixel avatar Canvas rendering |
| Virtual Office | `src/office/*.js` | 2D pixel art office (A* pathfinding, sprites) |

### Avatar Lifecycle

```
SessionStart hook → agent created (Waiting) → 10s grace period
                         │
         Hook events drive state: Waiting → Thinking → Working → Done
                         │
         Removal (automatic only, no manual dismiss):
           1. SessionEnd hook → immediate removal
           2. PID dead + transcript re-check fails → removal
           3. Zombie sweep: process count < agent count → oldest removed
```

### Sprite Sheet Format

Avatar files in `public/characters/avatar_*.webp` — **384×576px, 8 cols × 9 rows = 72 frames (48×64 each)**

```
Row 0: front_idle(0-3)      front_walk(4-7)
Row 1: front_sit_idle(8-11) front_sit_work(12-15)
Row 2: left_idle(16-19)     left_walk(20-23)
Row 3: left_sit_idle(24-27) left_sit_work(28-31)
Row 4: right_idle(32-35)    right_walk(36-39)
Row 5: right_sit_idle(40-43) right_sit_work(44-47)
Row 6: back_idle(48-51)     back_walk(52-55)
Row 7: back_sit_idle(56-59) back_sit_work(60-63)
Row 8: front_done_dance(64-67) front_alert_jump(68-71)
```

**Taskbar renderer** (`ANIM_SEQUENCES` in `renderer/config.js`):
- Working/Thinking → `front_done_dance` (64-67)
- Done/Error/Help  → `front_alert_jump` (68-71)
- Waiting          → `front_idle` (0-3)

**Office canvas** (`SPRITE_FRAMES` in `office/office-config.js`):
- Walk/idle use directional keys: `walk_{dir}`, `{dir}_idle`
- Desk seated: `sit_{dir}` (idle) or `sit_work_{dir}` (working)
- Done at idle zone: `IDLE_SEAT_MAP` per spot id (18,28→right / 24→dance / 19,29→left / rest→down)

### PiP (Picture-in-Picture) Mode

- Open/close via the PiP button in the Operational Floorplan panel header of the dashboard
- Always-on-top floating window (alwaysOnTop: floating), fixed resize at office map ratio (864:800)
- Receives agent state independently via SSE (`/api/events`) — character positions are not synced with the dashboard (each maintains its own officeCharacters Map)
- While PiP is active, the dashboard canvas is hidden and a placeholder is shown
- Closing the dashboard also closes PiP
- Hover overlay: Dashboard (back) + X (close) buttons

### Known Limitation: PID Detection on Windows

- On Windows, Claude does not keep JSONL files open, so transcript_path → PID detection may fail
- With multiple sessions, the fallback may mis-map PIDs (zombie/ghost avatars)
- No issue during normal use (1-2 sessions); if it occurs, only display is unstable
- The root fix requires Claude Code to include PID in the hook payload
