# Mission Control Architecture Analysis

**Analysis Date:** 2026-03-05
**Analyst:** Claude (Sonnet 4.6)
**Subject:** mission-control-main (Next.js) vs Current Pixel Agent Desk Implementation

---

## Executive Summary

This document provides a comprehensive architectural analysis of the OpenClaw Mission Control dashboard (mission-control-main) compared to our current Pixel Agent Desk Mission Control implementation. The analysis focuses on identifying valuable patterns, components, and strategies that can be adopted to enhance our system.

### Key Findings
- **mission-control-main** is a production-ready, enterprise-grade Next.js dashboard with 66 REST API endpoints
- **Our implementation** is a lightweight, single-file HTML dashboard with basic WebSocket support
- **Integration Opportunity:** High - we can adopt several architectural patterns without abandoning our simple approach
- **Recommended Strategy:** Hybrid approach - keep our simplicity while adopting key features from mission-control-main

---

## 1. Project Structure Analysis

### 1.1 mission-control-main Architecture

```
mission-control-main/
├── src/
│   ├── app/
│   │   ├── api/                    # 66 REST API endpoints
│   │   │   ├── agents/            # Agent CRUD + lifecycle
│   │   │   ├── sessions/          # Session management
│   │   │   ├── claude/            # Claude Code integration
│   │   │   ├── tasks/             # Task management
│   │   │   ├── auth/              # Authentication
│   │   │   ├── events/            # SSE streaming
│   │   │   ├── webhooks/          # Webhook management
│   │   │   └── ...
│   │   ├── [[...panel]]/page.tsx  # SPA shell (28 panels)
│   │   └── layout.tsx
│   ├── components/
│   │   ├── layout/               # NavRail, HeaderBar, LiveFeed
│   │   ├── dashboard/            # Overview dashboard
│   │   ├── panels/               # 28 feature panels
│   │   └── chat/                 # Agent chat UI
│   └── lib/
│       ├── db.ts                 # SQLite (better-sqlite3, WAL mode)
│       ├── auth.ts               # Session + API key auth, RBAC
│       ├── claude-sessions.ts    # Local Claude Code scanner
│       ├── migrations.ts         # 21 schema migrations
│       ├── scheduler.ts          # Background task scheduler
│       ├── webhooks.ts           # Outbound webhook delivery
│       ├── websocket.ts          # Gateway WebSocket client
│       ├── device-identity.ts    # Ed25519 device identity
│       ├── agent-sync.ts         # OpenClaw config sync
│       └── event-bus.ts          # SSE event broadcasting
├── .data/                        # Runtime data (SQLite DB)
└── package.json
```

### 1.2 Current Pixel Agent Desk Architecture

```
pixel-agent-desk/
├── mission-control.html          # Single-file dashboard (19KB)
├── mission-control-server.js     # Node.js HTTP + WebSocket server
├── missionControlPreload.js      # IPC bridge (Electron)
├── missionControlAdapter.js      # Data transformation layer
├── main.js                       # Electron main process
├── agentManager.js               # Agent lifecycle management
└── utils.js                      # Shared utilities
```

---

## 2. API Architecture Comparison

### 2.1 mission-control-main API Endpoints

#### Agent Management (10 endpoints)
```
GET    /api/agents                      # List agents (filter: status, role)
POST   /api/agents                      # Create agent
GET    /api/agents/[id]                 # Agent details
PUT    /api/agents/[id]                 # Update agent + gateway config
DELETE /api/agents/[id]                 # Delete agent
POST   /api/agents/[id]/heartbeat       # Agent heartbeat
POST   /api/agents/[id]/wake            # Wake sleeping agent
GET    /api/agents/[id]/attribution     # Self-scope audit/cost report
GET/PUT /api/agents/[id]/soul           # Agent SOUL content
POST   /api/agents/sync                 # Sync from openclaw.json
GET/POST /api/agents/comms              # Inter-agent messaging
POST   /api/agents/message              # Send message to agent
```

#### Session Control (3 endpoints)
```
GET    /api/sessions                    # Active gateway sessions
POST   /api/sessions/[id]/control       # Control session (monitor/pause/terminate)
```

#### Claude Code Integration (2 endpoints)
```
GET    /api/claude/sessions             # List discovered sessions
POST   /api/claude/sessions             # Trigger manual scan
```

#### Real-time Events (1 endpoint)
```
GET    /api/events                      # SSE stream of DB changes
```

#### Task Management (7 endpoints)
```
GET    /api/tasks                       # List tasks (filter: status, assigned_to)
POST   /api/tasks                       # Create task
GET    /api/tasks/[id]                  # Task details
PUT    /api/tasks/[id]                  # Update task
DELETE /api/tasks/[id]                  # Delete task
GET    /api/tasks/[id]/comments         # Task comments
POST   /api/tasks/[id]/comments         # Add comment
POST   /api/tasks/[id]/broadcast        # Broadcast task to agents
GET    /api/tasks/queue                 # Poll next task
```

#### Monitoring & Status (6 endpoints)
```
GET    /api/status                      # System status (uptime, memory, disk)
GET    /api/activities                  # Activity feed
GET    /api/notifications               # Notifications
GET    /api/tokens                      # Token usage and cost
GET    /api/standup                     # Standup report history
POST   /api/standup                     # Generate standup
```

#### Authentication (6 endpoints)
```
POST   /api/auth/login                  # Login with username/password
POST   /api/auth/google                 # Google Sign-In
POST   /api/auth/logout                 # Destroy session
GET    /api/auth/me                     # Current user info
GET    /api/auth/access-requests        # List pending requests (admin)
POST   /api/auth/access-requests        # Approve/reject requests (admin)
```

#### Webhooks (6 endpoints)
```
GET/POST/PUT/DELETE /api/webhooks       # Webhook CRUD
POST   /api/webhooks/test               # Test delivery
POST   /api/webhooks/retry              # Manual retry failed delivery
GET    /api/webhooks/deliveries         # Delivery history
GET    /api/webhooks/verify-docs        # Signature verification docs
```

### 2.2 Current Pixel Agent Desk API

#### Agent Management (2 endpoints)
```
GET    /api/agents                      # Get all agents
GET    /api/agents/:id/details          # Get agent details
```

#### Statistics (2 endpoints)
```
GET    /api/stats                       # Get statistics
GET    /api/health                      # Health check
```

#### Real-time (1 WebSocket endpoint)
```
WS     /ws                              # WebSocket for real-time updates
```

### 2.3 Comparison Table

| Feature | mission-control-main | Pixel Agent Desk | Gap |
|---------|---------------------|------------------|-----|
| Agent CRUD | ✅ Full | ❌ Read-only | High |
| Session Control | ✅ Monitor/Pause/Terminate | ❌ None | High |
| Claude Integration | ✅ Auto-scan JSONL | ❌ None | High |
| Real-time Updates | ✅ SSE + WebSocket | ✅ WebSocket | Low |
| Authentication | ✅ RBAC + OAuth | ❌ None | High |
| Task Management | ✅ Full Kanban | ❌ None | Medium |
| Webhooks | ✅ Delivery + Retry | ❌ None | Medium |
| Token Tracking | ✅ Per-model costs | ❌ None | Medium |
| Background Scheduler | ✅ Cron-based | ❌ None | Medium |

---

## 3. Data Model Analysis

### 3.1 mission-control-main Core Data Models

#### Agent Model
```typescript
interface Agent {
  id: number;
  name: string;
  role: string;
  session_key?: string;
  soul_content?: string;          // Markdown personality file
  status: 'offline' | 'idle' | 'busy' | 'error';
  last_seen?: number;
  last_activity?: string;
  created_at: number;
  updated_at: number;
  config?: string;                // JSON string
  workspace_id: number;
}
```

#### Task Model
```typescript
interface Task {
  id: number;
  title: string;
  description?: string;
  status: 'inbox' | 'assigned' | 'in_progress' | 'review' | 'quality_review' | 'done';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  project_id?: number;
  ticket_ref?: string;
  assigned_to?: string;
  created_by: string;
  created_at: number;
  updated_at: number;
  outcome?: 'success' | 'failed' | 'partial' | 'abandoned';
  completed_at?: number;
}
```

#### Claude Session Model
```typescript
interface ClaudeSession {
  session_id: string;
  project_slug: string;
  project_path: string | null;
  model: string | null;
  git_branch: string | null;
  user_messages: number;
  assistant_messages: number;
  tool_uses: number;
  input_tokens: number;
  output_tokens: number;
  estimated_cost: number;
  first_message_at: string | null;
  last_message_at: string | null;
  last_user_prompt: string | null;
  is_active: boolean;
  scanned_at: number;
  updated_at: number;
}
```

### 3.2 Current Pixel Agent Desk Data Model

```javascript
// Our simplified agent model
{
  id: string;              // UUID
  sessionId: string;
  displayName: string;
  state: string;           // 'Working', 'Thinking', 'Done', etc.
  projectPath: string;
  isSubagent: boolean;
  isTeammate: boolean;
  parentId?: string;
  firstSeen: number;
  lastSeen: number;
}
```

### 3.3 Key Differences

| Aspect | mission-control-main | Pixel Agent Desk |
|--------|---------------------|------------------|
| Database | SQLite with WAL mode | In-memory |
| Schema | 21 migrations | No schema |
| Relationships | Foreign keys | None |
| Workspace Support | Multi-tenant | Single workspace |
| Session Tracking | Separate table | Embedded in agent |
| Cost Tracking | Per-model pricing | None |
| Audit Trail | Full audit log | None |

---

## 4. Real-time Update Mechanisms

### 4.1 mission-control-main: SSE + WebSocket Hybrid

#### Server-Sent Events (SSE)
```typescript
// /api/events route
export async function GET(request: NextRequest) {
  const stream = new ReadableStream({
    start(controller) {
      const handler = (event: ServerEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
      }
      eventBus.on('server-event', handler)

      // Heartbeat every 30s
      const heartbeat = setInterval(() => {
        controller.enqueue(encoder.encode(': heartbeat\n\n'))
      }, 30_000)
    }
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    }
  })
}
```

**Event Types Broadcast:**
- `agent.created`, `agent.updated`, `agent.deleted`
- `task.created`, `task.updated`, `task.deleted`
- `chat.message`, `notification.created`
- `activity.created`, `audit.security`

#### WebSocket for Gateway
```typescript
// Gateway WebSocket with Ed25519 device identity
const ws = new WebSocket(gatewayUrl)
ws.send(JSON.stringify({
  type: 'req',
  method: 'connect',
  id: requestId,
  params: {
    client_id: clientId,
    device_auth_signature: signPayload(challenge),
    protocol_version: 3
  }
}))
```

**Features:**
- Challenge-response authentication
- Heartbeat ping/pong (30s interval)
- Automatic reconnection with exponential backoff
- Request-response correlation

### 4.2 Current Pixel Agent Desk: WebSocket Only

```javascript
// Simple WebSocket implementation
server.on('upgrade', (req, socket, head) => {
  const client = {
    socket,
    readyState: 1, // OPEN
    send: (data) => {
      // Manual frame encoding
      const frame = [0x81]; // FIN + Text frame
      socket.write(Buffer.concat([Buffer.from(frame), dataBytes]));
    }
  }

  // Send initial data
  client.send(JSON.stringify({
    type: 'initial',
    data: agents,
    timestamp: Date.now()
  }))
})
```

**Message Types:**
- `initial` - Full agent list on connect
- `agent.added` - New agent created
- `agent.updated` - Agent state changed
- `agent.removed` - Agent deleted

### 4.3 Comparison

| Feature | mission-control-main | Pixel Agent Desk |
|---------|---------------------|------------------|
| Protocol | SSE + WebSocket | WebSocket only |
| Authentication | Ed25519 signatures | None |
| Heartbeat | Ping/Pong with tracking | None |
| Reconnection | Exponential backoff | None |
| Event Types | 20+ event types | 3 event types |
| Client Library | React hook (`useWebSocket`) | Vanilla JS |
| Message Queue | Event bus pattern | Direct broadcast |

---

## 5. Claude Code Integration

### 5.1 mission-control-main: Automatic JSONL Scanner

**Key Features:**
- Scans `~/.claude/projects/` every 60 seconds
- Parses JSONL session transcripts
- Extracts token usage, model info, message counts
- Calculates estimated costs with per-model pricing
- Detects active sessions (last message < 5 minutes ago)

**Implementation:**
```typescript
export function scanClaudeSessions(): SessionStats[] {
  const claudeHome = config.claudeHome
  const projectsDir = join(claudeHome, 'projects')
  const projectDirs = readdirSync(projectsDir)

  const sessions: SessionStats[] = []
  for (const projectSlug of projectDirs) {
    const files = readdirSync(projectDir).filter(f => f.endsWith('.jsonl'))
    for (const file of files) {
      const parsed = parseSessionFile(filePath, projectSlug)
      if (parsed) sessions.push(parsed)
    }
  }
  return sessions
}
```

**Data Extracted:**
- Session ID and project slug
- Model name and git branch
- User/assistant message counts
- Tool use count
- Input/output tokens (including cache)
- Estimated cost (USD)
- Active status (boolean)
- First/last message timestamps
- Last user prompt (truncated)

**Database Storage:**
```sql
CREATE TABLE claude_sessions (
  session_id TEXT PRIMARY KEY,
  project_slug TEXT,
  model TEXT,
  git_branch TEXT,
  user_messages INTEGER,
  assistant_messages INTEGER,
  tool_uses INTEGER,
  input_tokens INTEGER,
  output_tokens INTEGER,
  estimated_cost REAL,
  first_message_at TEXT,
  last_message_at TEXT,
  is_active INTEGER,
  scanned_at INTEGER,
  updated_at INTEGER
);
```

### 5.2 Current Pixel Agent Desk: No Integration

We currently do not scan or track Claude Code sessions.

### 5.3 Integration Opportunity

**High Value** - This feature would significantly enhance our dashboard by:
1. Providing visibility into local Claude Code usage
2. Tracking token costs across all sessions
3. Identifying active vs inactive sessions
4. Mapping sessions to projects and git branches

**Implementation Effort:** Medium
- Need to add JSONL parsing capability
- Need to add scanner to our background scheduler
- Need to extend our data model

---

## 6. Authentication & Authorization

### 6.1 mission-control-main Security Architecture

**Three Authentication Methods:**
1. **Session Cookie** - `POST /api/auth/login` sets `mc-session` (7-day expiry)
2. **API Key** - `x-api-key` header matches `API_KEY` env var
3. **Google OAuth** - OAuth with admin approval workflow

**Role-Based Access Control (RBAC):**
```typescript
type Role = 'viewer' | 'operator' | 'admin'

interface User {
  id: number;
  username: string;
  display_name: string;
  role: Role;
  workspace_id: number;
  provider?: 'local' | 'google';
  email?: string | null;
  avatar_url?: string | null;
  is_approved?: number;
  created_at: number;
  last_login_at: number | null;
}
```

**Role Permissions:**
- `viewer` - Read-only access
- `operator` - Read + write (tasks, agents, chat)
- `admin` - Full access (users, settings, system ops)

**Implementation:**
```typescript
export function requireRole(request: NextRequest, role: Role): AuthResult {
  const session = getSessionFromCookie(request)
  if (!session) return { error: 'Unauthorized', status: 401 }

  const user = getUserById(session.user_id)
  if (!user || !hasRole(user.role, role)) {
    return { error: 'Forbidden', status: 403 }
  }

  return { user }
}
```

**Security Features:**
- scrypt password hashing
- Constant-time string comparison (timing attack prevention)
- Session token rotation
- CSRF protection
- Rate limiting (per-IP and per-user)
- Audit logging for security events

### 6.2 Current Pixel Agent Desk: No Authentication

We currently have no authentication or authorization system.

### 6.3 Integration Opportunity

**Medium Value** - For a desktop app, full authentication may be overkill. However:
- Basic API key protection for the HTTP server would be valuable
- Rate limiting would prevent abuse
- Audit logging would be useful for debugging

**Recommended Approach:**
1. Add simple API key header check (`x-api-key`)
2. Add rate limiting middleware
3. Add basic request logging
4. Skip OAuth/RBAC for now (desktop app context)

---

## 7. Session Control Capabilities

### 7.1 mission-control-main: Full Session Lifecycle

**Control Actions:**
```typescript
type SessionAction = 'monitor' | 'pause' | 'terminate'

// POST /api/sessions/[id]/control
await runClawdbot([
  '-c', `sessions_kill("${sessionId}")`  // terminate
])

await runClawdbot([
  '-c', `sessions_send("${sessionId}", ${JSON.stringify({
    type: 'control',
    action: 'pause'  // pause or monitor
  })})`
])
```

**Implementation:**
- Uses `clawdbot` CLI tool to control OpenClaw gateway sessions
- `monitor` - Start detailed monitoring of a session
- `pause` - Pause session execution
- `terminate` - Kill the session immediately

**Safety Features:**
- Session ID format validation (`/^[a-zA-Z0-9_-]+$/`)
- Operator role required
- Audit logging for all control actions
- Activity feed updates

### 7.2 Current Pixel Agent Desk: No Session Control

We can view agents but cannot control their execution.

### 7.3 Integration Opportunity

**High Value** - Session control would be valuable for:
1. Pausing runaway agents
2. Terminating stuck sessions
3. Monitoring specific sessions in detail

**Implementation Challenge:**
We don't use OpenClaw gateway, so we'd need to implement our own session control mechanism using Electron's process management.

**Alternative Approach:**
- Add "Focus Agent" button to bring agent window to front
- Add "Dismiss Agent" button to close agent window
- These are already implemented in our IPC bridge!

---

## 8. Background Task Scheduling

### 8.1 mission-control-main Scheduler

**Features:**
- Cron-based task scheduling
- Persistent job storage in SQLite
- Automatic retry with exponential backoff
- Job history and status tracking

**Built-in Jobs:**
```typescript
interface CronJob {
  id: number;
  name: string;
  schedule: string;        // cron expression
  handler: string;         // job handler function
  enabled: boolean;
  last_run_at?: number;
  next_run_at?: number;
  run_count?: number;
  fail_count?: number;
}
```

**Default Jobs:**
- `claude_session_scan` - Every 60s, scan Claude Code sessions
- `database_backup` - Daily at 2 AM, backup SQLite database
- `stale_cleanup` - Daily at 3 AM, clean up old records
- `agent_heartbeat_check` - Every 5 min, check for stale agents

**API:**
```typescript
GET/POST /api/cron           # List/create cron jobs
PUT /api/cron/[id]           # Update job
DELETE /api/cron/[id]        # Delete job
GET/POST /api/scheduler      # Scheduler control
```

### 8.2 Current Pixel Agent Desk: No Scheduler

We use `setInterval` in the main process for periodic tasks.

### 8.3 Integration Opportunity

**Medium Value** - A proper scheduler would be useful for:
1. Periodic Claude Code session scanning
2. Database cleanup
3. Health checks
4. Statistics aggregation

**Recommended Approach:**
- Keep it simple with a lightweight cron-like scheduler
- Don't need full persistence (desktop app)
- Focus on the specific jobs we need

---

## 9. Webhook System

### 9.1 mission-control-main Webhooks

**Features:**
- Outbound webhooks with HTTP POST
- Delivery history with retry tracking
- Exponential backoff retry (up to 5 attempts)
- Circuit breaker to disable failing webhooks
- HMAC-SHA256 signature verification
- Per-webhook event filtering

**Webhook Model:**
```typescript
interface Webhook {
  id: number;
  name: string;
  url: string;
  events: string[];          // Event types to deliver
  secret?: string;           // HMAC signing key
  enabled: boolean;
  headers?: Record<string, string>;
  timeout_ms: number;
  created_at: number;
  updated_at: number;
}
```

**Delivery Model:**
```typescript
interface WebhookDelivery {
  id: number;
  webhook_id: number;
  event_type: string;
  payload: string;
  status: 'pending' | 'success' | 'failed' | 'retrying';
  http_status?: number;
  attempt: number;
  next_retry_at?: number;
  created_at: number;
  updated_at: number;
}
```

**Signature Verification:**
```typescript
const signature = crypto
  .createHmac('sha256', webhook.secret)
  .update(JSON.stringify(payload))
  .digest('hex')

const header = `sha256=${signature}`
headers['x-webhook-signature'] = header
```

### 9.2 Current Pixel Agent Desk: No Webhooks

We don't have webhook capability.

### 9.3 Integration Opportunity

**Low-Medium Value** - For a desktop app, webhooks are less critical. However:
- Could be useful for external integrations (e.g., Slack notifications)
- Could enable cross-system communication
- Would require a public endpoint (not typical for desktop apps)

**Recommendation:** Defer this feature unless specific use case emerges.

---

## 10. Database & Persistence

### 10.1 mission-control-main: SQLite with WAL Mode

**Configuration:**
```typescript
const db = new Database(DB_PATH)
db.pragma('journal_mode = WAL')        // Write-Ahead Logging
db.pragma('synchronous = NORMAL')
db.pragma('cache_size = 1000')
db.pragma('foreign_keys = ON')
```

**Schema Migrations:**
- 21 migrations tracking schema evolution
- Automatic migration on startup
- Rollback support for downgrades

**Key Tables:**
- `users` - User accounts and roles
- `user_sessions` - Session tokens
- `agents` - Agent registry
- `tasks` - Task management
- `claude_sessions` - Claude Code session tracking
- `activities` - Activity feed
- `notifications` - User notifications
- `audit_log` - Security audit trail
- `webhooks` - Webhook definitions
- `webhook_deliveries` - Delivery history
- `workspaces` - Multi-tenant workspace isolation
- `cron_jobs` - Scheduled task definitions
- `token_usage` - Per-session token tracking
- `projects` - Project management
- `pipelines` - Pipeline orchestration

### 10.2 Current Pixel Agent Desk: In-Memory Only

We store all data in memory. Agents are tracked in JavaScript objects.

**Pros:**
- Simple
- Fast (no I/O)
- No schema to manage

**Cons:**
- Data lost on restart
- No history/audit trail
- No cross-session analytics
- Limited query capabilities

### 10.3 Integration Opportunity

**High Value** - Adding SQLite persistence would enable:
1. Agent history and analytics
2. Session token tracking
3. Cost tracking over time
4. Activity feed and audit log
5. Claude Code session history

**Recommended Approach:**
1. Add SQLite with better-sqlite3 (same as mission-control-main)
2. Start with minimal schema (agents, sessions, activities)
3. Add migrations from day 1
4. Keep in-memory cache for performance

---

## 11. UI/UX Architecture

### 11.1 mission-control-main: Next.js SPA

**Tech Stack:**
- Next.js 16 (App Router)
- React 19
- Tailwind CSS 3.4
- Zustand 5 (state management)
- Recharts 3 (charts)

**Architecture:**
```typescript
// SPA shell with 28 panels
app/[[...panel]]/page.tsx

// Zustand store for state
interface MissionControlState {
  agents: Agent[]
  sessions: Session[]
  tasks: Task[]
  notifications: Notification[]
  connection: ConnectionStatus
  // ... 28 panel states
}

// Custom hooks for data fetching
useWebSocket()        // Gateway connection
useServerEvents()     // SSE stream
useSmartPoll()        // Intelligent polling (pauses when away)
```

**Panels (28 total):**
- Dashboard (overview)
- Tasks (Kanban board)
- Agents (list and details)
- Sessions (active gateway sessions)
- Tokens (usage and cost)
- Memory (file browser)
- Logs (agent log viewer)
- Chat (agent chat UI)
- Notifications
- Activities (feed)
- Settings
- Webhooks
- Gateways
- Integrations
- Projects
- Pipelines
- Workflows
- Scheduler
- Audit Log
- Backup
- Cleanup
- Quality Review
- Standup
- Search
- Releases
- Super Admin (tenant management)

### 11.2 Current Pixel Agent Desk: Single HTML File

**Tech Stack:**
- Vanilla JavaScript
- Plain CSS with animations
- Inline HTML/CSS/JS (single file)

**Architecture:**
```javascript
// Simple state management
let agents = []

// IPC-based updates
window.missionControlAPI.onAgentAdded((agent) => {
  agents.push(agent)
  renderDashboard()
})

// Client-side rendering
function renderDashboard() {
  const stats = calculateStats()
  const groups = groupAgentsByProject()
  container.innerHTML = `
    ${renderStatsPanel(stats)}
    ${renderProjectGroups(groups)}
  `
}
```

**Features:**
- Project-based grouping
- Timeline visualization
- Status indicators with animations
- Connection status indicator
- Empty states and loading states

### 11.3 Comparison

| Aspect | mission-control-main | Pixel Agent Desk |
|--------|---------------------|------------------|
| Framework | Next.js + React | Vanilla JS |
| State Management | Zustand | Manual array management |
| Styling | Tailwind CSS | Custom CSS |
| Panels | 28 panels | 1 dashboard |
| Real-time | SSE + WebSocket | IPC events |
| Routing | URL-based panels | N/A (single view) |
| Charts | Recharts | None |
| Performance | Bundle splitting | Single file load |

**Advantages of Our Approach:**
- Simpler (no build step)
- Faster initial load (single file)
- Easier to debug (no framework layers)
- Smaller footprint

**Advantages of mission-control-main:**
- Scalable to 28+ panels
- Better code organization
- Type safety (TypeScript)
- Richer UI components

---

## 12. Agent Lifecycle Management

### 12.1 mission-control-main Agent Lifecycle

**States:**
```
offline → idle → busy → error
   ↓       ↓       ↓
   └───────┴───────┴──→ offline
```

**Lifecycle Operations:**
1. **Register** - `POST /api/agents` (with optional OpenClaw workspace provisioning)
2. **Heartbeat** - `POST /api/agents/[id]/heartbeat` (with inline token reporting)
3. **Wake** - `POST /api/agents/[id]/wake` (wake sleeping agent)
4. **Update** - `PUT /api/agents/[id]` (update config, status, soul)
5. **Retire** - `DELETE /api/agents/[id]` (admin only)

**SOUL System:**
```markdown
# Agent SOUL (soul.md)

## Identity
- Name: ResearchAgent
- Theme: Academic rigor and curiosity

## Capabilities
- Literature review and synthesis
- Data analysis and visualization
- Technical writing

## Behavioral Guidelines
- Always cite sources
- Prefer peer-reviewed sources
- Acknowledge limitations
- Avoid speculation without evidence

## Communication Style
- Formal but accessible
- Use precise terminology
- Explain complex concepts clearly
```

**Features:**
- SOUL content stored in database and workspace
- Bidirectional sync (DB ↔ `soul.md` file)
- Template-based agent creation
- Gateway config write-back

### 12.2 Current Pixel Agent Desk Agent Lifecycle

**States:**
```
Created → Working → Done
   ↓         ↓
Waiting ← Thinking
   ↓
Help/Error
```

**Lifecycle Operations:**
1. **Create** - Automatic on first heartbeat
2. **Update** - On each heartbeat
3. **Remove** - Manual or on session end

**Simpler Model:**
- No SOUL system
- No explicit registration
- No wake capability
- No config management

### 12.3 Comparison

**Our Advantages:**
- Simpler state model (easier to understand)
- Automatic lifecycle management
- No manual registration required

**mission-control-main Advantages:**
- SOUL system for agent personality
- Template-based creation
- Gateway integration
- Config persistence

**Recommendation:**
- Keep our simple state model
- Consider adding SOUL-like capability for agent personality
- Add template-based agent creation for common patterns

---

## 13. Integration Possibilities

### 13.1 High-Value Features to Adopt

#### 1. Claude Code Session Scanning
**Effort:** Medium
**Value:** High
**Why:** Provides visibility into local Claude usage and costs

**Implementation:**
```javascript
// Add to agentManager.js
const { scanClaudeSessions } = require('./claude-scanner');

setInterval(async () => {
  const sessions = await scanClaudeSessions();
  // Update dashboard with session data
}, 60000); // Every 60 seconds
```

#### 2. SQLite Persistence
**Effort:** High
**Value:** High
**Why:** Enables history, analytics, and cross-session insights

**Implementation:**
```javascript
// Add database.js
const Database = require('better-sqlite3');
const db = new Database('pixel-agent-desk.db');

// Add migrations
db.exec(`
  CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    session_id TEXT,
    display_name TEXT,
    state TEXT,
    project_path TEXT,
    first_seen INTEGER,
    last_seen INTEGER,
    created_at INTEGER DEFAULT (strftime('%s', 'now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    session_id TEXT PRIMARY KEY,
    project TEXT,
    model TEXT,
    input_tokens INTEGER DEFAULT 0,
    output_tokens INTEGER DEFAULT 0,
    estimated_cost REAL DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    last_message_at INTEGER
  );
`);
```

#### 3. Token Usage Tracking
**Effort:** Medium
**Value:** High
**Why:** Essential for cost management and optimization

**Implementation:**
```javascript
// Extend agent model
{
  ...agent,
  tokens: {
    input: 125000,
    output: 45000,
    total: 170000,
    estimatedCost: 0.52 // USD
  },
  model: 'claude-sonnet-4-6'
}
```

#### 4. Session Control (Basic)
**Effort:** Low
**Value:** Medium
**Why:** Already partially implemented via IPC

**Implementation:**
```javascript
// Extend missionControlPreload.js
contextBridge.exposeInMainWorld('missionControlAPI', {
  // ... existing methods

  pauseAgent: (agentId) => {
    ipcRenderer.send('mission-pause-agent', agentId);
  },

  terminateAgent: (agentId) => {
    ipcRenderer.send('mission-terminate-agent', agentId);
  }
});
```

#### 5. Activity Feed
**Effort:** Low
**Value:** Medium
**Why:** Improves observability and debugging

**Implementation:**
```javascript
// Add to mission-control.html
<div class="activity-feed">
  <h3>Recent Activity</h3>
  <div id="activityList"></div>
</div>

<script>
function logActivity(type, message, data) {
  const activity = {
    type,
    message,
    data,
    timestamp: Date.now()
  };

  // Store in SQLite
  db.prepare('INSERT INTO activities ...').run(activity);

  // Broadcast to dashboard
  broadcastUpdate('activity', activity);
}
</script>
```

### 13.2 Medium-Value Features

#### 6. Enhanced API Endpoints
**Effort:** Low
**Value:** Medium
**Why:** Better integration with external tools

**Add:**
- `GET /api/agents/:id/history` - Agent state history
- `GET /api/sessions` - Active sessions list
- `GET /api/tokens` - Token usage stats
- `GET /api/activities` - Activity feed

#### 7. Basic Authentication
**Effort:** Low
**Value:** Medium
**Why:** Security for HTTP server

**Implementation:**
```javascript
// Add to mission-control-server.js
const API_KEY = process.env.MISSION_CONTROL_API_KEY;

function checkAuth(req) {
  const key = req.headers['x-api-key'];
  return key === API_KEY;
}
```

#### 8. Rate Limiting
**Effort:** Low
**Value:** Medium
**Why:** Prevents abuse and overload

**Implementation:**
```javascript
// Simple rate limiter
const rateLimits = new Map();

function checkRateLimit(ip) {
  const now = Date.now();
  const window = 60000; // 1 minute
  const maxRequests = 100;

  const history = rateLimits.get(ip) || [];
  const recent = history.filter(t => now - t < window);

  if (recent.length >= maxRequests) {
    return false; // Rate limited
  }

  recent.push(now);
  rateLimits.set(ip, recent);
  return true;
}
```

### 13.3 Lower Priority Features

#### 9. Task Management (Kanban)
**Effort:** High
**Value:** Low-Medium
**Why:** Useful but may be overkill for desktop app

#### 10. Webhook System
**Effort:** High
**Value:** Low
**Why:** Less relevant for desktop app context

#### 11. Multi-Workspace Support
**Effort:** High
**Value:** Low
**Why:** Most users only need one workspace

---

## 14. Recommended Integration Roadmap

### Phase 1: Quick Wins (1-2 weeks)
**Goal:** Add high-value, low-effort features

1. **Add API Key Authentication**
   - Simple header check
   - Environment variable configuration
   - Effort: 2 hours

2. **Add Rate Limiting**
   - Simple in-memory rate limiter
   - Per-IP tracking
   - Effort: 4 hours

3. **Add Activity Feed**
   - Log key events to SQLite
   - Display in dashboard
   - Effort: 8 hours

4. **Add Basic Session Control**
   - Pause/Dismiss already implemented
   - Add Terminate capability
   - Effort: 4 hours

**Total Effort:** ~18 hours (2-3 days)

### Phase 2: Data & Persistence (2-3 weeks)
**Goal:** Add SQLite persistence and Claude Code integration

1. **Add SQLite Database**
   - Set up better-sqlite3
   - Create initial schema
   - Add migration system
   - Effort: 16 hours

2. **Persist Agent Data**
   - Save agents to database
   - Load on startup
   - Keep in-memory cache
   - Effort: 8 hours

3. **Add Claude Code Scanner**
   - Scan `~/.claude/projects/`
   - Parse JSONL files
   - Extract token usage
   - Effort: 16 hours

4. **Add Token Tracking**
   - Track per-session tokens
   - Calculate costs
   - Display in dashboard
   - Effort: 8 hours

**Total Effort:** ~48 hours (1 week)

### Phase 3: Enhanced Features (3-4 weeks)
**Goal:** Add advanced monitoring and control

1. **Add Session History**
   - Track agent state changes
   - Query historical data
   - Visualize timeline
   - Effort: 16 hours

2. **Add Agent SOUL System**
   - Create soul.md template
   - Parse SOUL files
   - Display in dashboard
   - Effort: 12 hours

3. **Enhanced API Endpoints**
   - Add history endpoint
   - Add tokens endpoint
   - Add activities endpoint
   - Effort: 8 hours

4. **Add Background Scheduler**
   - Simple cron-like scheduler
   - Claude session scan job
   - Cleanup job
   - Effort: 12 hours

**Total Effort:** ~48 hours (1 week)

### Phase 4: Polish & Optimization (1-2 weeks)
**Goal:** Improve performance and UX

1. **Optimize WebSocket Communication**
   - Add heartbeat/ping-pong
   - Add reconnection logic
   - Optimize message size
   - Effort: 12 hours

2. **Add Dashboard Enhancements**
   - More visualizations
   - Better filtering
   - Export capabilities
   - Effort: 16 hours

3. **Add Error Handling**
   - Graceful degradation
   - Error recovery
   - User notifications
   - Effort: 8 hours

4. **Performance Optimization**
   - Lazy loading
   - Debouncing
   - Memory optimization
   - Effort: 8 hours

**Total Effort:** ~44 hours (1 week)

---

## 15. Architecture Decision Records

### ADR-001: Keep Single-File HTML Dashboard

**Decision:** Continue using single-file HTML dashboard rather than migrating to Next.js

**Rationale:**
- Desktop app context ( Electron) - no need for web server complexity
- Simplicity - easier to maintain and debug
- Performance - no build step, instant loading
- Sufficient for current needs - one dashboard is enough

**Trade-offs:**
- ❌ Harder to scale to multiple panels
- ❌ No TypeScript type safety
- ❌ Manual DOM manipulation
- ✅ Simpler deployment
- ✅ Faster development iterations
- ✅ Easier to customize

**Revisit:** If we need more than 5 distinct views/panels

---

### ADR-002: Add SQLite Persistence

**Decision:** Add SQLite database for agent and session persistence

**Rationale:**
- Enables historical analysis
- Provides audit trail
- Supports analytics
- Survives app restarts

**Implementation:**
- Use better-sqlite3 (same as mission-control-main)
- Start with minimal schema
- Add migrations from day 1
- Keep in-memory cache for performance

**Schema (v1):**
```sql
CREATE TABLE agents (
  id TEXT PRIMARY KEY,
  display_name TEXT,
  state TEXT,
  project_path TEXT,
  first_seen INTEGER,
  last_seen INTEGER,
  created_at INTEGER DEFAULT (strftime('%s', 'now'))
);

CREATE TABLE sessions (
  session_id TEXT PRIMARY KEY,
  project TEXT,
  model TEXT,
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  estimated_cost REAL DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  last_message_at INTEGER
);

CREATE TABLE activities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT,
  message TEXT,
  data TEXT, -- JSON
  created_at INTEGER DEFAULT (strftime('%s', 'now'))
);
```

**Revisit:** If performance becomes an issue

---

### ADR-003: Adopt SSE for Real-time Updates

**Decision:** Add Server-Sent Events (SSE) alongside WebSocket

**Rationale:**
- SSE is simpler for one-way updates (server → client)
- Better browser support (no polyfills needed)
- Automatic reconnection
- Lower overhead than WebSocket

**Implementation:**
```javascript
// Add SSE endpoint to mission-control-server.js
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const sendEvent = (type, data) => {
    res.write(`data: ${JSON.stringify({ type, data, timestamp: Date.now() })}\n\n`);
  };

  // Keep connection alive
  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 30000);

  req.on('close', () => {
    clearInterval(heartbeat);
  });
});
```

**Use Cases:**
- Activity feed updates
- Agent state changes
- Session updates
- Notifications

**Keep WebSocket For:**
- Two-way communication (if needed)
- Gateway integration (if we add it)

**Revisit:** If we need bidirectional real-time communication

---

### ADR-004: Implement Claude Code Session Scanner

**Decision:** Add automatic scanning of Claude Code sessions

**Rationale:**
- Provides visibility into local Claude usage
- Tracks token costs
- Identifies active sessions
- Low maintenance effort

**Implementation:**
```javascript
// claude-scanner.js
const fs = require('fs');
const path = require('path');

function scanClaudeSessions() {
  const claudeHome = process.env.HOME + '/.claude';
  const projectsDir = path.join(claudeHome, 'projects');

  const sessions = [];

  for (const project of fs.readdirSync(projectsDir)) {
    const projectDir = path.join(projectsDir, project);
    const jsonlFiles = fs.readdirSync(projectDir)
      .filter(f => f.endsWith('.jsonl'));

    for (const file of jsonlFiles) {
      const session = parseJsonlFile(path.join(projectDir, file));
      if (session) sessions.push(session);
    }
  }

  return sessions;
}

function parseJsonlFile(filePath) {
  const lines = fs.readFileSync(filePath, 'utf8').split('\n');
  let sessionId = null;
  let model = null;
  let inputTokens = 0;
  let outputTokens = 0;

  for (const line of lines) {
    const entry = JSON.parse(line);
    if (entry.sessionId) sessionId = entry.sessionId;
    if (entry.message?.model) model = entry.message.model;
    if (entry.message?.usage) {
      inputTokens += entry.message.usage.input_tokens || 0;
      outputTokens += entry.message.usage.output_tokens || 0;
    }
  }

  return { sessionId, model, inputTokens, outputTokens };
}
```

**Schedule:** Every 60 seconds via background scheduler

**Revisit:** If performance becomes an issue (too many sessions)

---

## 16. Conclusion

### Summary of Key Findings

1. **mission-control-main is a comprehensive, production-grade system** with 66 API endpoints, full authentication, multi-tenant support, and 28 dashboard panels.

2. **Our current implementation is simpler and more focused** on the desktop app use case, with a single-file dashboard and basic WebSocket updates.

3. **High-value integration opportunities** include:
   - Claude Code session scanning
   - SQLite persistence
   - Token usage tracking
   - Activity feed
   - Basic session control

4. **Lower priority features** (for now):
   - Full RBAC system (overkill for desktop app)
   - Webhook system (less relevant for desktop)
   - Multi-tenant workspaces (most users only need one)
   - Full task management system (can add later if needed)

### Recommended Strategy

**Adopt a hybrid approach:**
- Keep our simple single-file HTML dashboard
- Add SQLite persistence for history and analytics
- Add Claude Code session scanner
- Add token tracking and cost estimation
- Enhance API with additional endpoints
- Add basic authentication and rate limiting
- Keep WebSocket for real-time updates (add SSE if needed)

### Next Steps

1. **Implement Phase 1** (Quick Wins) - 1-2 weeks
2. **Evaluate results** and gather feedback
3. **Implement Phase 2** (Data & Persistence) - 2-3 weeks
4. **Assess** if additional phases are needed
5. **Iterate** based on user feedback and usage patterns

### Success Metrics

- **Performance:** Dashboard load time < 100ms
- **Reliability:** 99.9% uptime for HTTP/WebSocket server
- **Usability:** Zero configuration required for basic use
- **Adoption:** Users actively using Claude Code session tracking
- **Cost Savings:** Users can identify and optimize expensive sessions

---

## Appendix A: File Reference

### mission-control-main Key Files

| File | Purpose | Lines of Code |
|------|---------|---------------|
| `src/app/api/agents/route.ts` | Agent CRUD operations | 411 |
| `src/app/api/agents/[id]/route.ts` | Single agent operations | 240 |
| `src/app/api/sessions/route.ts` | Session listing | 118 |
| `src/app/api/sessions/[id]/control/route.ts` | Session control | 78 |
| `src/app/api/events/route.ts` | SSE streaming | 71 |
| `src/app/api/claude/sessions/route.ts` | Claude Code sessions | 103 |
| `src/lib/db.ts` | Database schema and operations | 500+ |
| `src/lib/auth.ts` | Authentication and authorization | 300+ |
| `src/lib/claude-sessions.ts` | JSONL scanner | 308 |
| `src/lib/event-bus.ts` | SSE event broadcasting | 64 |
| `src/lib/websocket.ts` | Gateway WebSocket client | 500+ |
| `src/lib/models.ts` | Type definitions | 31 |

### Our Key Files

| File | Purpose | Lines of Code |
|------|---------|---------------|
| `mission-control.html` | Dashboard UI | 693 |
| `mission-control-server.js` | HTTP + WebSocket server | 401 |
| `missionControlPreload.js` | IPC bridge | 67 |
| `missionControlAdapter.js` | Data transformation | 155 |
| `agentManager.js` | Agent lifecycle management | ~500 |
| `main.js` | Electron main process | ~1000 |

---

## Appendix B: API Endpoint Comparison

### mission-control-main Endpoints (66 total)

#### Agents (10)
- GET/POST /api/agents
- GET/PUT/DELETE /api/agents/[id]
- POST /api/agents/[id]/heartbeat
- POST /api/agents/[id]/wake
- GET /api/agents/[id]/attribution
- GET/PUT /api/agents/[id]/soul
- POST /api/agents/sync
- GET/POST /api/agents/comms
- POST /api/agents/message

#### Sessions (2)
- GET /api/sessions
- POST /api/sessions/[id]/control

#### Claude Code (2)
- GET/POST /api/claude/sessions

#### Tasks (7)
- GET/POST /api/tasks
- GET/PUT/DELETE /api/tasks/[id]
- GET/POST /api/tasks/[id]/comments
- POST /api/tasks/[id]/broadcast
- GET /api/tasks/queue

#### Auth (6)
- POST /api/auth/login
- POST /api/auth/google
- POST /api/auth/logout
- GET /api/auth/me
- GET/POST /api/auth/access-requests

#### Monitoring (6)
- GET /api/status
- GET /api/activities
- GET /api/notifications
- GET /api/tokens
- GET/POST /api/standup
- GET /api/releases/check

#### Webhooks (6)
- GET/POST/PUT/DELETE /api/webhooks
- POST /api/webhooks/test
- POST /api/webhooks/retry
- GET /api/webhooks/deliveries
- GET /api/webhooks/verify-docs

#### Configuration (3)
- GET/PUT /api/settings
- GET/PUT /api/gateway-config
- GET/POST /api/cron

#### Integrations (6)
- GET/POST/PUT/DELETE /api/integrations
- GET/POST/PUT/DELETE /api/gateways
- POST /api/gateways/connect
- POST /api/github

#### Operations (7)
- GET/POST /api/scheduler
- GET /api/audit
- GET /api/logs
- GET /api/memory
- GET /api/search
- GET /api/export
- POST /api/backup
- POST /api/cleanup

#### Real-time (3)
- GET /api/events
- GET/POST /api/chat/conversations
- GET/POST /api/chat/messages

#### Super Admin (5)
- GET/POST /api/super/tenants
- POST /api/super/tenants/[id]/decommission
- GET/POST /api/super/provision-jobs
- POST /api/super/provision-jobs/[id]/run

#### Other (9)
- GET/POST /api/pipelines
- POST /api/pipelines/run
- GET/POST /api/workflows
- GET /api/workload
- POST /api/quality-review
- GET/POST /api/projects
- GET /api/projects/[id]/tasks
- GET/POST /api/alerts
- GET/POST /api/tokens

### Our Endpoints (4 total)

- GET /api/agents
- GET /api/agents/:id/details
- GET /api/stats
- GET /api/health
- WS /ws

---

**End of Analysis Report**
