# Pixel Agent Desk 통합 고도화 로드맵
## Integration & Enhancement Roadmap v1.0

**작성일:** 2026-03-05
**기획자:** Claude (Sonnet 4.6)
**대상:** Pixel Agent Desk v2.0
**참고 자료:** Mission Control 아키텍처, Claude Hooks 심층 분석

---

## 📋 실행 요약 (Executive Summary)

본 문서는 Mission Control의 성숙한 아키텍처와 Claude Hooks의 풍부한 데이터 모델을 활용하여 Pixel Agent Desk를 단계적으로 고도화하는 4개월 로드맵을 제시합니다.

### 핵심 목표
1. **데이터 구조 현대화** (Phase 3A: 2주) - 이중 필드 해결, 검증 강화
2. **훅 데이터 활용 극대화** (Phase 3B: 2주) - 4개 신규 훅 도입
3. **Mission Control 고도화** (Phase 3C: 2주) - 대시보드 기능 확장
4. **생산성 분석 도입** (Phase 4: 4주) - 데이터 기반 인사이트 제공
5. **팀 협업 기능** (Phase 5: 8주) - 멀티 유저 지원

### 예상 투자 시간
- **총 개발 시간:** 344시간 (약 4개월)
- **P0 필수:** 120시간 (6주)
- **P1 중요:** 140시간 (7주)
- **P2 선택:** 84시간 (4주)

---

## 📊 현재 상태 분석 (Current State Analysis)

### A. Mission Control 참조 분석

#### 장점 (벤치마킹 대상)
```
✅ RESTful API 설계 (66개 엔드포인트)
✅ 실시간 업데이트 (WebSocket + SSE)
✅ 데이터 분석 기능 (attribution, diagnostics)
✅ 역할 기반 접근 제어 (RBAC)
✅ SQLite + WAL 모드 (높은 동시성)
✅ Zod 스키마 검증 (타입 안전성)
✅ 배경 작업 스케줄러
✅ 웹훅 delivery with retry
```

#### 우리 프로젝트에 적용 가능한 패턴
1. **API 설계:** `/api/agents`, `/api/stats`, `/api/health` 확장
2. **실시간 업데이트:** WebSocket → 단순화된 Server-Sent Events (SSE)
3. **데이터 분석:** 시간대별 작업 패턴, 병목 발견
4. **스케줄러:** 세션 정리, 통계 집계

### B. 훅 데이터 분석

#### 현재 활용 중인 필드
```javascript
{
  sessionId: "uuid",           // ✅ 사용 중
  projectPath: "/path/to/project", // ✅ 사용 중
  state: "Working",            // ✅ 사용 중
  timestamp: 1234567890        // ✅ 사용 중
}
```

#### 놓치고 있는 필드 (신규 발견)
```javascript
{
  transcript_path: "/path/to/transcript.jsonl", // 🆕 세션 로그 분석
  permission_mode: "auto|manual",               // 🆕 권한 모드 UI
  tool_response: {...},                         // 🆕 툴 결과 표시
  tool_use_id: "uuid",                          // 🆕 툴 호출 추적
  error: {...}                                  // 🆕 에러 상세 정보
}
```

### C. 현재 기술적 부채

#### 🔴 P0: 긴급 문제
1. **이중 sessionId 필드**
   - `session_id` (hook 원본) vs `sessionId` (내부 사용)
   - 혼재로 인한 데이터 불일치
   - **영향:** 세션 추적 오류, 로그 분석 어려움

2. **Silent JSON Parsing Failure**
   - `hook.js`에서 파싱 실패 시 무시
   - 에러 로깅 부재
   - **영향:** 디버깅 불가, 데이터 손실

3. **불충분한 검증**
   - HTTP 훅 데이터 Ajv 검증만 적용
   - 파일 기반 state.json 검증 없음
   - **영향:** 데이터 corruption 위험

#### 🟡 P1: 중요 문제
1. **단일 HTML 구조**
   - mission-control.html이 단일 파일
   - API와 분리되지 않음
   - **영향:** 유지보수 어려움, 확장성 제한

2. **놓치고 있는 훅 이벤트**
   - UserPromptSubmit (프롬프트 검증)
   - PermissionRequest (자동 권한)
   - PostToolUseFailure (실패 모니터링)
   - Notification (알림)

---

## 🗺️ Phase 3A: 데이터 구조 개선 (2주)

### 목표
데이터 안정성 확보 및 기술적 부채 해결

### 작업 항목

#### 1. 필드명 통일 (P0, 4시간)
```javascript
// 혼재 사용 문제 해결
// Before
data.session_id || data.sessionId

// After
data.sessionId // 표준화

// 영향 파일
- agentManager.js (line 41, 72)
- missionControlAdapter.js (line 81, 82, 118)
- sessionend_hook.js (line 16, 27, 29, 36, 37, 44, 49)
- utils.js (line 166, 170)
```

**구현 방법:**
1. `normalizeSessionId(data)` 헬퍼 함수 생성
2. 모든 진입점에서 헬퍼 사용
3. 기존 `session_id` → `sessionId` 마이그레이션

#### 2. JSON 파싱 에러 로깅 (P0, 2시간)
```javascript
// hook.js 개선
// Before
try {
    const data = JSON.parse(...);
} catch (e) {
    process.exit(0); // Silent failure
}

// After
try {
    const data = JSON.parse(...);
} catch (e) {
    // 로그 파일에 에러 기록
    fs.appendFileSync(
        path.join(os.homedir(), '.pixel-agent-desk', 'parse-errors.log'),
        `[${new Date().toISOString()}] Parse Error: ${e.message}\n`
    );
    process.exit(1); // 명시적 실패
}
```

#### 3. Ajv 스키마 강화 (P0, 6시간)
```javascript
// schemas/agentStateSchema.js (신규)
const agentStateSchema = {
    type: "object",
    required: ["sessionId", "state", "timestamp"],
    properties: {
        sessionId: {
            type: "string",
            format: "uuid",
            description: "Unique session identifier"
        },
        state: {
            type: "string",
            enum: ["Working", "Thinking", "Done", "Waiting", "Error", "Help", "Offline"]
        },
        timestamp: {
            type: "number",
            minimum: 0
        },
        // 신규 필드 추가
        transcript_path: {
            type: "string",
            description: "Path to session transcript"
        },
        permission_mode: {
            type: "string",
            enum: ["auto", "manual"],
            default: "manual"
        },
        tool_use_id: {
            type: "string",
            format: "uuid"
        }
    }
};

// main.js에서 적용
const ajv = new Ajv({ allErrors: true });
const validateAgentState = ajv.compile(agentStateSchema);

ipcMain.on('hook-received', (event, data) => {
    if (!validateAgentState(data)) {
        console.error('[Schema] Validation failed:', validateAgentState.errors);
        return;
    }
    // ... 처리 로직
});
```

#### 4. state.json 백업 메커니즘 (P1, 4시간)
```javascript
// utils.js 추가
async function safeWriteState(filePath, data) {
    const backupPath = filePath + '.backup';

    try {
        // 기존 파일 백업
        if (fs.existsSync(filePath)) {
            fs.copyFileSync(filePath, backupPath);
        }

        // 새 데이터 쓰기
        await fs.promises.writeFile(
            filePath,
            JSON.stringify(data, null, 2),
            'utf-8'
        );

        // 성공 시 백업 삭제
        if (fs.existsSync(backupPath)) {
            fs.unlinkSync(backupPath);
        }
    } catch (error) {
        // 실패 시 백업 복원
        if (fs.existsSync(backupPath)) {
            fs.copyFileSync(backupPath, filePath);
            fs.unlinkSync(backupPath);
        }
        throw error;
    }
}
```

### 성공 기준
- [ ] 모든 코드에서 `sessionId`만 사용 (혼재 제거)
- [ ] JSON 파싱 실패 100% 로깅
- [ ] Ajv 스키마 커버리지 90% 이상
- [ ] state.json 백업 복구 테스트 통과

---

## 🗺️ Phase 3B: 훅 데이터 활용 확대 (2주)

### 목표
새로운 훅 이벤트 도입으로 데이터 활용도 극대화

### 작업 항목

#### 1. UserPromptSubmit 훅 도입 (P0, 8시간)

**용도:** 사용자 프롬프트 검증 및 사전 처리

```javascript
// hooks/userPromptSubmit.js (신규)
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const PORT = 47821;

const chunks = [];
process.stdin.on('data', d => chunks.push(d));
process.stdin.on('end', () => {
    try {
        const data = JSON.parse(Buffer.concat(chunks).toString());

        // 프롬프트 검증 로직
        const validation = validatePrompt(data.prompt);

        const enrichedData = {
            ...data,
            _validation: validation,
            _timestamp: Date.now(),
            _pid: process.ppid
        };

        // HTTP 전송
        sendToServer(enrichedData);
    } catch (e) {
        process.exit(0);
    }
});

function validatePrompt(prompt) {
    const checks = {
        length: prompt.length > 0 && prompt.length < 100000,
        hasInstructions: /\b(can you|please|help|create|fix|debug)\b/i.test(prompt),
        hasContext: /\b(in|at|for|with|from)\b/i.test(prompt)
    };

    return {
        valid: Object.values(checks).every(v => v),
        checks,
        score: Object.values(checks).filter(v => v).length / 3
    };
}

function sendToServer(data) {
    const body = Buffer.from(JSON.stringify(data), 'utf-8');
    const req = http.request({
        hostname: '127.0.0.1',
        port: PORT,
        path: '/hook/user-prompt',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': body.length }
    }, () => process.exit(0));

    req.on('error', () => process.exit(0));
    req.setTimeout(3000, () => { req.destroy(); process.exit(0); });
    req.write(body);
    req.end();
}
```

**main.js 핸들러:**
```javascript
ipcMain.on('hook-user-prompt', (event, data) => {
    const { sessionId, prompt, _validation } = data;

    // 프롬프트 품질 로깅
    console.log(`[Prompt] Quality Score: ${_validation.score}`);

    // 낮은 품질 프롬프트 알림
    if (_validation.score < 0.5) {
        sendNotificationToRenderer({
            type: 'prompt-quality',
            sessionId,
            score: _validation.score,
            suggestions: [
                '구체적인 지시사항을 포함해주세요',
                '관련 컨텍스트를 제공해주세요',
                '명확한 작업 목표를 설정해주세요'
            ]
        });
    }
});
```

#### 2. PermissionRequest 훅 도입 (P1, 6시간)

**용도:** 권한 요청 모니터링 및 자동 승인 로직

```javascript
// hooks/permissionRequest.js (신규)
// ... (유사한 구조)

const enrichedData = {
    ...data,
    _autoApproval: shouldAutoApprove(data),
    _timestamp: Date.now()
};

function shouldAutoApprove(permission) {
    // 안전한 작업 자동 승인
    const safeReads = [
        'read_file',
        'list_directory',
        'search_files'
    ];

    return safeReads.includes(permission.tool_name) &&
           permission.permission_mode === 'auto';
}
```

**main.js 핸들러:**
```javascript
ipcMain.on('hook-permission-request', (event, data) => {
    const { sessionId, tool_name, _autoApproval } = data;

    // 자동 승인 로그
    if (_autoApproval) {
        console.log(`[Permission] Auto-approved: ${tool_name}`);
    } else {
        // 수동 승인 요청 UI 표시
        sendToRenderer('permission-request', data);
    }
});
```

#### 3. PostToolUseFailure 훅 도입 (P1, 6시간)

**용도:** 툴 실패 모니터링 및 재시도 로직

```javascript
// hooks/postToolUseFailure.js (신규)
// ... (유사한 구조)

const enrichedData = {
    ...data,
    _errorCategory: categorizeError(data.error),
    _retryable: isRetryable(data.error),
    _timestamp: Date.now()
};

function categorizeError(error) {
    if (error.message.includes('ENOENT')) return 'file_not_found';
    if (error.message.includes('EACCES')) return 'permission_denied';
    if (error.message.includes('timeout')) return 'timeout';
    return 'unknown';
}

function isRetryable(error) {
    const retryableErrors = ['timeout', 'network', 'rate_limit'];
    return retryableErrors.some(cat => error.message.includes(cat));
}
```

#### 4. transcript_path 활용 (P2, 4시간)

**용도:** 세션 로그 분석 및 인사이트 제공

```javascript
// utils.js 추가
async function analyzeTranscript(transcriptPath) {
    try {
        const content = await fs.promises.readFile(transcriptPath, 'utf-8');
        const lines = content.split('\n').filter(line => line.trim());

        const analysis = {
            totalMessages: 0,
            userMessages: 0,
            assistantMessages: 0,
            toolCalls: 0,
            totalTokens: 0,
            duration: 0,
            firstMessageTime: null,
            lastMessageTime: null
        };

        for (const line of lines) {
            try {
                const entry = JSON.parse(line);

                if (entry.type === 'user_message') {
                    analysis.userMessages++;
                } else if (entry.type === 'assistant_message') {
                    analysis.assistantMessages++;
                } else if (entry.type === 'tool_use') {
                    analysis.toolCalls++;
                }

                if (entry.usage) {
                    analysis.totalTokens += entry.usage.total_tokens || 0;
                }

                const timestamp = entry.timestamp || entry.created_at;
                if (timestamp) {
                    if (!analysis.firstMessageTime) {
                        analysis.firstMessageTime = timestamp;
                    }
                    analysis.lastMessageTime = timestamp;
                }
            } catch (e) {
                // Skip invalid lines
            }
        }

        analysis.totalMessages = analysis.userMessages + analysis.assistantMessages;

        if (analysis.firstMessageTime && analysis.lastMessageTime) {
            analysis.duration = analysis.lastMessageTime - analysis.firstMessageTime;
        }

        return analysis;
    } catch (error) {
        console.error('[Transcript] Analysis failed:', error);
        return null;
    }
}
```

### 성공 기준
- [ ] UserPromptSubmit 훅 정상 동작
- [ ] PermissionRequest 자동 승인 로직 구현
- [ ] PostToolUseFailure 에러 분류 정확도 90%
- [ ] transcript 분석 UI 표시

---

## 🗺️ Phase 3C: Mission Control 고도화 (2주)

### 목표
단일 HTML 구조를 분리하고 대시보드 기능 확장

### 작업 항목

#### 1. 파일 구조 재설계 (P0, 4시간)

```
Before:
mission-control.html (단일 파일 693줄)

After:
mission-control/
├── index.html          # 진입점 (50줄)
├── js/
│   ├── api.js          # API 클라이언트 (80줄)
│   ├── state.js        # 상태 관리 (60줄)
│   ├── dashboard.js    # 대시보드 렌더링 (200줄)
│   └── utils.js        # 헬퍼 함수 (40줄)
└── css/
    └── dashboard.css    # 스타일 (300줄)
```

#### 2. API 엔드포인트 확장 (P0, 8시간)

**신규 엔드포인트:**

```javascript
// mission-control-server.js

// 1. 타임라인 조회
app.get('/api/timeline', async (req, res) => {
    const { sessionId, hours = 24 } = req.query;
    const timeline = await agentManager.getTimeline(sessionId, hours);
    res.json(timeline);
});

// 2. 에이전트 제거
app.post('/api/agents/dismiss', async (req, res) => {
    const { agentId } = req.body;
    await agentManager.dismissAgent(agentId);
    res.json({ success: true });
});

// 3. 분석 데이터
app.get('/api/analytics', async (req, res) => {
    const { period = '24h' } = req.query;
    const analytics = await agentManager.getAnalytics(period);
    res.json(analytics);
});

// 4. 상태 스냅샷
app.get('/api/snapshot', async (req, res) => {
    const agents = await agentManager.getAllAgents();
    res.json({
        timestamp: Date.now(),
        agents: agents.map(adaptAgentToMissionControl),
        stats: calculateStats(agents)
    });
});
```

#### 3. 실시간 업데이트 강화 (P1, 6시간)

**Server-Sent Events (SSE) 구현:**

```javascript
// mission-control-server.js

const clients = new Set();

app.get('/api/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    clients.add(res);

    // 초기 데이터 전송
    const agents = agentManager.getAllAgents();
    res.write(`data: ${JSON.stringify({ type: 'init', agents })}\n\n`);

    req.on('close', () => {
        clients.delete(res);
    });
});

// 이벤트 브로드캐스트
function broadcastEvent(type, data) {
    const message = `data: ${JSON.stringify({ type, data })}\n\n`;
    clients.forEach(client => {
        try {
            client.write(message);
        } catch (e) {
            clients.delete(client);
        }
    });
}

// agentManager에서 이벤트 emit
agentManager.on('agent-added', (agent) => {
    broadcastEvent('agent-added', agent);
});

agentManager.on('agent-updated', (agent) => {
    broadcastEvent('agent-updated', agent);
});
```

#### 4. 필터링 및 정렬 (P1, 4시간)

```javascript
// mission-control/js/dashboard.js

class DashboardFilter {
    constructor() {
        this.filters = {
            projects: new Set(),
            states: new Set(),
            types: new Set()
        };
        this.sortBy = 'timestamp';
        this.sortOrder = 'desc';
    }

    apply(agents) {
        let filtered = agents;

        // 프로젝트 필터
        if (this.filters.projects.size > 0) {
            filtered = filtered.filter(a =>
                this.filters.projects.has(a.projectPath)
            );
        }

        // 상태 필터
        if (this.filters.states.size > 0) {
            filtered = filtered.filter(a =>
                this.filters.states.has(a.state)
            );
        }

        // 타입 필터
        if (this.filters.types.size > 0) {
            filtered = filtered.filter(a => {
                if (a.isSubagent) return this.filters.types.has('sub');
                if (a.isTeammate) return this.filters.types.has('team');
                return this.filters.types.has('main');
            });
        }

        // 정렬
        filtered.sort((a, b) => {
            const order = this.sortOrder === 'asc' ? 1 : -1;
            switch (this.sortBy) {
                case 'timestamp':
                    return (a.timestamp - b.timestamp) * order;
                case 'project':
                    return (a.projectPath || '').localeCompare(b.projectPath || '') * order;
                case 'state':
                    return (a.state || '').localeCompare(b.state || '') * order;
                default:
                    return 0;
            }
        });

        return filtered;
    }
}
```

### 성공 기준
- [ ] 파일 분리 완료 (모듈화)
- [ ] 신규 API 4개 정상 동작
- [ ] SSE 실시간 업데이트 지연 100ms 이하
- [ ] 필터링/정렬 UI 구현

---

## 🗺️ Phase 4: 생산성 분석 (4주)

### 목표
데이터 기반 인사이트 제공으로 작업 효율 개선

### 작업 항목

#### 1. 시간대별 작업 패턴 분석 (P0, 12시간)

```javascript
// analytics/timeAnalyzer.js (신규)

class TimeAnalyzer {
    constructor() {
        this.hourlyData = new Array(24).fill(0);
        this.dayOfWeekData = new Array(7).fill(0);
    }

    recordActivity(agent) {
        const date = new Date(agent.timestamp);
        const hour = date.getHours();
        const day = date.getDay();

        this.hourlyData[hour]++;
        this.dayOfWeekData[day]++;
    }

    getPeakHours() {
        const avg = this.hourlyData.reduce((a, b) => a + b) / 24;
        const peaks = [];

        for (let i = 0; i < 24; i++) {
            if (this.hourlyData[i] > avg * 1.5) {
                peaks.push(i);
            }
        }

        return peaks;
    }

    getWorkSchedule() {
        // 업무 시간 (9-18) vs 비업무 시간
        const workHours = this.hourlyData.slice(9, 18).reduce((a, b) => a + b);
        const nonWorkHours = this.hourlyData.filter((_, i) => i < 9 || i >= 18)
                                           .reduce((a, b) => a + b);

        return {
            work: workHours,
            nonWork: nonWorkHours,
            ratio: workHours / (workHours + nonWorkHours)
        };
    }
}
```

#### 2. 병목 발견 (P0, 8시간)

```javascript
// analytics/bottleneckDetector.js (신규)

class BottleneckDetector {
    constructor() {
        this.thresholdMs = 10 * 60 * 1000; // 10분
        this.slowTasks = [];
    }

    checkTaskDuration(agent) {
        if (agent.state === 'Done' && agent.startTime) {
            const duration = Date.now() - agent.startTime;

            if (duration > this.thresholdMs) {
                this.slowTasks.push({
                    sessionId: agent.sessionId,
                    project: agent.projectPath,
                    duration,
                    timestamp: Date.now()
                });
            }
        }
    }

    getBottlenecks() {
        // 프로젝트별 병목 집계
        const byProject = {};

        for (const task of this.slowTasks) {
            if (!byProject[task.project]) {
                byProject[task.project] = {
                    count: 0,
                    totalDuration: 0,
                    avgDuration: 0
                };
            }

            byProject[task.project].count++;
            byProject[task.project].totalDuration += task.duration;
            byProject[task.project].avgDuration =
                byProject[task.project].totalDuration / byProject[task.project].count;
        }

        return byProject;
    }

    getAlerts() {
        return this.slowTasks
            .filter(task => task.duration > this.thresholdMs * 2)
            .map(task => ({
                type: 'bottleneck',
                severity: 'warning',
                message: `Task in ${task.project} took ${Math.round(task.duration / 60000)}min`,
                sessionId: task.sessionId
            }));
    }
}
```

#### 3. 생산성 지표 (P1, 8시간)

```javascript
// analytics/productivityMetrics.js (신규)

class ProductivityMetrics {
    constructor() {
        this.tasksCompleted = 0;
        this.tasksFailed = 0;
        this.totalTime = 0;
        this.activeTime = 0;
    }

    recordCompletion(agent) {
        if (agent.state === 'Done') {
            this.tasksCompleted++;
            if (agent.duration) {
                this.totalTime += agent.duration;
                this.activeTime += agent.duration;
            }
        } else if (agent.state === 'Error') {
            this.tasksFailed++;
        }
    }

    getMetrics() {
        return {
            completionRate: this.tasksCompleted /
                           (this.tasksCompleted + this.tasksFailed) || 0,
            avgTaskTime: this.totalTime / this.tasksCompleted || 0,
            activeTimeRatio: this.activeTime / this.totalTime || 0,
            throughput: this.tasksCompleted / (this.totalTime / 3600000) || 0
        };
    }

    getTrends() {
        // 시간 추이 (1시간 단위)
        const hourly = [];

        for (let i = 0; i < 24; i++) {
            // TODO: 실제 데이터 집계
            hourly.push({
                hour: i,
                completed: Math.floor(Math.random() * 10),
                failed: Math.floor(Math.random() * 2)
            });
        }

        return hourly;
    }
}
```

#### 4. 일일/주간 리포트 (P2, 8시간)

```javascript
// analytics/reportGenerator.js (신규)

class ReportGenerator {
    constructor(timeAnalyzer, bottleneckDetector, productivityMetrics) {
        this.timeAnalyzer = timeAnalyzer;
        this.bottleneckDetector = bottleneckDetector;
        this.productivityMetrics = productivityMetrics;
    }

    generateDailyReport() {
        const today = new Date();

        return {
            date: today.toISOString().split('T')[0],
            summary: {
                totalTasks: this.productivityMetrics.tasksCompleted,
                completionRate: this.productivityMetrics.getMetrics().completionRate,
                avgTaskTime: this.productivityMetrics.getMetrics().avgTaskTime
            },
            timeAnalysis: {
                peakHours: this.timeAnalyzer.getPeakHours(),
                workSchedule: this.timeAnalyzer.getWorkSchedule()
            },
            bottlenecks: this.bottleneckDetector.getBottlenecks(),
            alerts: this.bottleneckDetector.getAlerts()
        };
    }

    generateWeeklyReport() {
        const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

        return {
            weekStart: weekAgo.toISOString().split('T')[0],
            weekEnd: new Date().toISOString().split('T')[0],
            trends: this.productivityMetrics.getTrends(),
            insights: this.generateInsights()
        };
    }

    generateInsights() {
        const metrics = this.productivityMetrics.getMetrics();
        const insights = [];

        if (metrics.completionRate < 0.8) {
            insights.push({
                type: 'warning',
                message: '완료율이 80% 미만입니다. 실패 원인을 분석해보세요.'
            });
        }

        if (metrics.avgTaskTime > 600000) { // 10분
            insights.push({
                type: 'info',
                message: '평균 작업 시간이 10분을 초과합니다. 작업 분할을 고려해보세요.'
            });
        }

        return insights;
    }
}
```

### 성공 기준
- [ ] 시간대별 작업 패턴 시각화
- [ ] 병목 알림 정확도 90%
- [ ] 생산성 지표 4개 이상 계산
- [ ] 일일 리포트 자동 생성

---

## 🗺️ Phase 5: 팀 협업 (8주)

### 목표
멀티 유저 지원으로 팀 생산성 향상

### 작업 항목

#### 1. 사용자 인증 시스템 (P0, 16시간)

```javascript
// auth/userAuth.js (신규)

class UserAuth {
    constructor() {
        this.users = new Map();
        this.sessions = new Map();
    }

    createUser(username, password) {
        const hashedPassword = this.hashPassword(password);

        const user = {
            id: generateId(),
            username,
            hashedPassword,
            role: 'viewer', // viewer, operator, admin
            createdAt: Date.now()
        };

        this.users.set(username, user);
        return user;
    }

    authenticate(username, password) {
        const user = this.users.get(username);

        if (!user) {
            return { success: false, error: 'User not found' };
        }

        if (!this.verifyPassword(password, user.hashedPassword)) {
            return { success: false, error: 'Invalid password' };
        }

        const session = {
            id: generateId(),
            userId: user.id,
            username: user.username,
            role: user.role,
            createdAt: Date.now(),
            expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000 // 7일
        };

        this.sessions.set(session.id, session);

        return { success: true, session };
    }

    validateSession(sessionId) {
        const session = this.sessions.get(sessionId);

        if (!session) {
            return { valid: false };
        }

        if (Date.now() > session.expiresAt) {
            this.sessions.delete(sessionId);
            return { valid: false };
        }

        return { valid: true, user: session };
    }

    hashPassword(password) {
        // 간단한 해시 (실제로는 bcrypt 사용 권장)
        return require('crypto')
            .createHash('sha256')
            .update(password)
            .digest('hex');
    }

    verifyPassword(password, hash) {
        return this.hashPassword(password) === hash;
    }
}
```

#### 2. 팀 대시보드 (P1, 20시간)

```javascript
// dashboard/teamDashboard.js (신규)

class TeamDashboard {
    constructor(agentManager, userAuth) {
        this.agentManager = agentManager;
        this.userAuth = userAuth;
        this.userStats = new Map();
    }

    async getTeamView() {
        const users = Array.from(this.userAuth.users.values());

        return {
            timestamp: Date.now(),
            users: await Promise.all(
                users.map(user => this.getUserSummary(user.id))
            ),
            teamStats: this.getTeamStats()
        };
    }

    async getUserSummary(userId) {
        const userAgents = await this.agentManager.getAgentsByUser(userId);

        return {
            userId,
            username: userAgents[0]?.username || 'Unknown',
            activeAgents: userAgents.filter(a =>
                ['Working', 'Thinking'].includes(a.state)
            ).length,
            completedTasks: userAgents.filter(a => a.state === 'Done').length,
            currentProjects: [...new Set(userAgents.map(a => a.projectPath))],
            lastActivity: Math.max(...userAgents.map(a => a.timestamp))
        };
    }

    getTeamStats() {
        const allAgents = this.agentManager.getAllAgents();

        return {
            totalAgents: allAgents.length,
            activeAgents: allAgents.filter(a =>
                ['Working', 'Thinking'].includes(a.state)
            ).length,
            totalProjects: new Set(allAgents.map(a => a.projectPath)).size,
            avgCompletionRate: this.calculateAvgCompletionRate(allAgents)
        };
    }

    calculateAvgCompletionRate(agents) {
        const completed = agents.filter(a => a.state === 'Done').length;
        const total = agents.length;

        return total > 0 ? completed / total : 0;
    }
}
```

#### 3. 사용자별 필터링 (P1, 8시간)

```javascript
// filters/userFilter.js (신규)

class UserFilter {
    constructor() {
        this.selectedUsers = new Set();
    }

    toggleUser(userId) {
        if (this.selectedUsers.has(userId)) {
            this.selectedUsers.delete(userId);
        } else {
            this.selectedUsers.add(userId);
        }
    }

    filter(agents) {
        if (this.selectedUsers.size === 0) {
            return agents;
        }

        return agents.filter(agent =>
            this.selectedUsers.has(agent.userId)
        );
    }
}
```

#### 4. 상태 비교 기능 (P2, 12시간)

```javascript
// comparison/userComparison.js (신규)

class UserComparison {
    constructor(teamDashboard) {
        this.teamDashboard = teamDashboard;
    }

    async compareUsers(userIds) {
        const users = await Promise.all(
            userIds.map(id => this.teamDashboard.getUserSummary(id))
        );

        return {
            users,
            comparison: {
                mostActive: this.getMostActive(users),
                highestCompletion: this.getHighestCompletion(users),
                mostProjects: this.getMostProjects(users)
            }
        };
    }

    getMostActive(users) {
        return users.reduce((max, user) =>
            user.activeAgents > max.activeAgents ? user : max
        );
    }

    getHighestCompletion(users) {
        return users.reduce((max, user) =>
            user.completedTasks > max.completedTasks ? user : max
        );
    }

    getMostProjects(users) {
        return users.reduce((max, user) =>
            user.currentProjects.length > max.currentProjects.length ? user : max
        );
    }
}
```

### 성공 기준
- [ ] 사용자 인증 정상 동작
- [ ] 팀 대시보드 표시
- [ ] 사용자별 필터링
- [ ] 상태 비교 기능 구현

---

## 📈 PRD 업데이트 사항

### Phase 3 (데이터 구조 개선) 추가

#### P0 항목
1. **필드명 통일** (4시간)
   - 모든 코드에서 `sessionId` 표준화
   - 이중 필드 혼재 문제 해결

2. **JSON 파싱 에러 로깅** (2시간)
   - hook.js silent failure 제거
   - 에러 로그 파일 기록

3. **Ajv 스키마 강화** (6시간)
   - 신규 필드 스키마 정의
   - 90% 커버리지 달성

#### P1 항목
1. **state.json 백업** (4시간)
   - 백업 메커니즘 구현
   - 복구 테스트 통과

### Phase 3 (훅 활용 확대) 추가

#### P0 항목
1. **UserPromptSubmit 훅** (8시간)
   - 프롬프트 품질 검증
   - 낮은 품질 알림

#### P1 항목
1. **PermissionRequest 훅** (6시간)
   - 자동 승인 로직
   - 권한 모드 UI

2. **PostToolUseFailure 훅** (6시간)
   - 에러 분류
   - 재시도 로직

#### P2 항목
1. **transcript 분석** (4시간)
   - 세션 로그 분석
   - 인사이트 제공

### Phase 3 (Mission Control 고도화) 수정

#### P0 항목
1. **파일 구조 재설계** (4시간)
   - 단일 HTML → 모듈화
   - 5개 파일로 분리

2. **API 확장** (8시간)
   - /api/timeline
   - /api/analytics
   - /api/agents/dismiss
   - /api/snapshot

#### P1 항목
1. **SSE 실시간 업데이트** (6시간)
   - WebSocket → 단순화된 SSE
   - 지연 100ms 이하

2. **필터링/정렬** (4시간)
   - 프로젝트/상태/타입 필터
   - 시간/프로젝트/활동 정렬

### Phase 4 (생산성 분석) 추가

#### P0 항목
1. **시간대별 패턴 분석** (12시간)
2. **병목 발견** (8시간)

#### P1 항목
1. **생산성 지표** (8시간)

#### P2 항목
1. **일일/주간 리포트** (8시간)

### Phase 5 (팀 협업) 추가

#### P0 항목
1. **사용자 인증** (16시간)

#### P1 항목
1. **팀 대시보드** (20시간)
2. **사용자 필터링** (8시간)

#### P2 항목
1. **상태 비교** (12시간)

---

## 🎯 성공 기준 정량화

### Phase 3A (데이터 구조)
- [ ] 테스트 커버리지 35% 이상
- [ ] sessionId 혼재 0%
- [ ] JSON 파싱 실패 100% 로깅
- [ ] state.json 복구 성공률 100%

### Phase 3B (훅 활용)
- [ ] 프롬프트 검증 정확도 90%
- [ ] 권한 자동 승인률 60%
- [ ] 에러 분류 정확도 90%
- [ ] transcript 분석成功率 95%

### Phase 3C (Mission Control)
- [ ] API 응답 시간 200ms 이하
- [ ] SSE 지연 100ms 이하
- [ ] 필터링/정렬 반응속도 50ms 이하
- [ ] 파일 모듈화 완성도 100%

### Phase 4 (생산성 분석)
- [ ] 병목 발견 정확도 90%
- [ ] 생산성 지표 4개 이상
- [ ] 리포트 생성 시간 1초 이하
- [ ] 인사이트 유용성 점수 4/5 이상

### Phase 5 (팀 협업)
- [ ] 인증 성공률 99%
- [ ] 팀 대시보드 로딩 1초 이하
- [ ] 사용자 필터링 반응 100ms 이하
- [ ] 상태 비교 정확도 100%

---

## 🚀 구현 우선순위

### Week 1-2: Phase 3A (기반 안정화)
1. sessionId 통일 (Day 1)
2. JSON 로깅 (Day 2)
3. Ajv 스키마 (Day 3-5)
4. 백업 시스템 (Day 6-8)
5. 테스트 작성 (Day 9-10)

### Week 3-4: Phase 3B (훅 활용)
1. UserPromptSubmit (Day 11-14)
2. PermissionRequest (Day 15-17)
3. PostToolUseFailure (Day 18-20)
4. transcript 분석 (Day 21-22)

### Week 5-6: Phase 3C (대시보드)
1. 파일 분리 (Day 23-24)
2. API 확장 (Day 25-28)
3. SSE 구현 (Day 29-32)
4. 필터링/정렬 (Day 33-35)

### Week 7-10: Phase 4 (분석)
1. 시간 분석 (Day 36-41)
2. 병목 발견 (Day 42-47)
3. 생산성 지표 (Day 48-53)
4. 리포트 생성 (Day 54-59)

### Week 11-18: Phase 5 (협업)
1. 인증 시스템 (Day 60-69)
2. 팀 대시보드 (Day 70-85)
3. 필터링 (Day 86-91)
4. 상태 비교 (Day 92-101)

---

## 🔍 위험 완화 계획

### 기술적 위험
1. **SQLite 성능**
   - 완화: 현재 JSON 유지, 6개월 후 재평가
   - 롤백: JSON 파일 시스템으로 복귀

2. **SIE 연결**
   - 완화: 단순화된 SSE, 재연결 로직
   - 롤백: 폴링으로 대체

3. **훅 데이터 호환성**
   - 완화: 버전 관리, 하위 호환 유지
   - 롤백: 기존 훅만 사용

### 일정 위험
1. **개발 시간 초과**
   - 완화: P2 항목 축소
   - 대안: Phase 5를 다음 릴리스로 연기

2. **테스트 커버리지 미달**
   - 완화: P0 핵심 모듈 집중
   - 대안: E2E 테스트로 대체

---

## 📚 참고 자료

1. **Mission Control GitHub**
   - https://github.com/builderz-labs/mission-control
   - REST API 설계, SSE 패턴 참조

2. **Claude Hooks 문서**
   - UserPromptSubmit, PermissionRequest 등 신규 훅
   - 데이터 모델 분석

3. **현재 프로젝트**
   - agentManager.js, hook.js, main.js
   - 기존 아키텍처 분석

---

## ✅ 결론

본 로드맵은 Mission Control의 성숙한 패턴과 Claude Hooks의 풍부한 데이터를 활용하여 Pixel Agent Desk를 4개월 내에 현대화하는 구체적인 계획을 제시합니다.

### 핵심 성과 요약
- **데이터 안정성:** sessionId 통일, 검증 강화
- **훅 활용:** 4개 신규 훅으로 데이터 풍부화
- **대시보드:** 단일 파일 → 모듈화, API 확장
- **분석:** 생산성 인사이트 제공
- **협업:** 팀 기능 도입

### 다음 단계
1. Phase 3A 착수 (sessionId 통일)
2. PRD Phase 3-5 섹션 업데이트
3. 팀 리뷰 및 우선순위 확정

---

**문서 버전:** 1.0
**마지막 수정:** 2026-03-05
**상태:** 기획 완료, 승인 대기
