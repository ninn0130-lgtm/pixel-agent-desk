# 📋 PRD: Pixel Agent Desk (Log-Only Architecture)

## 프로젝트 개요

| 항목 | 내용 |
|------|------|
| 목적 | Claude CLI 작업 상태를 픽셀 캐릭터로 시각화 |
| 핵심 가치 | "내 컴퓨터 안에서 실제로 일하고 있는 AI 친구" |
| 타겟 | Claude CLI 사용자, 픽셀 아트 선호자 |
| 아키텍처 | **Log-Only** — JSONL 로그 파일 감시만으로 동작 (Read-Only) |
| 상태 | 🚧 MVP 구현 완료, 안정화 필요 |

---

## 감지 메커니즘

- **대상**: `~/.claude/projects/` 디렉토리 내의 모든 `.jsonl` 파일
- **방법**: `fs.watch`가 파일 수정을 감지하면 마지막 추가분만 읽어 즉시 JSON 파싱
- **새 파일 발견**: 5초 주기 스캔으로 새로 생성된 세션 파일 자동 감지
- **활성 파일 필터**: 최근 30분 이내 수정된 파일만 감시 대상
- **에이전트 식별**: `sessionId`를 1순위 키로 사용 (세션 단위 일관성 보장)
- **핵심 원칙**: Hook 없이 로그 내 `type`, `subtype`, `message.content`, `stop_reason` 필드를 정밀 분석

---

## 에이전트 상태 정의 (5단계)

| 상태 | 조건 (JSONL 필드) | 캐릭터 동작 | 라벨 |
|------|-------------------|------------|------|
| 💤 **Idle** | `stop_reason: "end_turn"` 또는 `subtype: "turn_duration"` | 가만히 서 있기 | Idle |
| 🧠 **Thinking** | `type: "assistant"` + `content[].type === "thinking"` | 바쁘게 움직임 (8fps) | Thinking 구름 (...) |
| ⚙️ **Working** | `type: "progress"` 또는 `tool_use` / `toolUseResult` | 바쁘게 움직임 (8fps) | Working |
| 💬 **Reporting** | `type: "assistant"` + `content[].type === "text"` | 가만히 서 있기 | Reporting |
| 🔴 **Offline** | `claude.exe` 프로세스가 해당 `cwd`에서 종료됨 | 흑백/반투명 처리 | Offline |

### 상태 판별 우선순위
1. Working (tool_use, progress) — 가장 높은 우선순위
2. Thinking (assistant + thinking content)
3. Reporting (assistant + text content)
4. Idle (end_turn, turn_duration, 기본값)

---

## 상태 ↔ 애니메이션 매핑

- **Working (작업 중)**: 에이전트가 도구를 사용하거나 사고 중일 때 (타이머 작동).
- **Done (완료)**: 전체 테스크가 종료되었을 때 (최종 시간 표시, 댄스 애니메이션).
- **Waiting (대기)**: 세션 시작 시 혹은 답변 완료 후 사용자 입력을 기다릴 때 (**앉아있기**).
- **Error (에러)**: 작업 중 오류 발생 시 (붉은 테두리).
- **Help (알림)**: 권한 요청이나 알림 발생 시.
- **Offline (오프라인)**: 연결된 터미널이 닫혔을 때 (흑백 처리, 10분 후 자동 퇴근).

---

## 멀티 에이전트 처리 전략

### 윈도우 리사이징

에이전트 수에 따라 Electron 윈도우 크기를 **동적으로 조정**한다.

| 에이전트 수 | 윈도우 크기 | 레이아웃 |
|------------|------------|----------|
| 0~1 | 220×200 (기본) | 싱글 아바타, 말풍선 위 |
| 2~4 | 가로 확장 (에이전트 × 200px) | 1행 가로 배치 |
| 5~10 | 가로 + 세로 확장 (2행 그리드) | 2행 그리드 |

### 에이전트 생명주기

```
[파일 발견] → [초기 tail 읽기] → [상태 파싱] → [에이전트 등록]
                                                      ↓
                                             [fs.watch 실시간 감시]
                                                      ↓
                                               [상태 업데이트 IPC]
                                                      ↓
                              10분 idle 시 → [자동 퇴근 (cleanup)]
```

### 중복 방지 규칙

- **세션 키**: `sessionId`를 1순위로 사용 → 같은 세션의 서브에이전트가 별개 아바타로 갈라지는 것 방지
- **시간 필터**: 초기 tail 읽기 시 30분 이내 타임스탬프 항목만 처리 → 과거 데이터가 에이전트 슬롯을 점유하지 않음
- **파일 필터**: mtime 30분 이내 파일만 감시 대상 → 47개 중 활성 파일만 선택

---

## 🐛 발견된 문제점 및 개선 계획

### P0: 크리티컬 (반드시 수정)

#### 1. tailFile()이 대용량 파일을 전체 메모리에 로드
- **파일**: `jsonlParser.js` L182-198
- **문제**: `fs.readFileSync(filePath, 'utf-8')` — 3.7MB 같은 대형 JSONL 파일을 전부 메모리에 읽고 나서 마지막 100줄만 사용. 불필요한 메모리 낭비.
- **수정**: 파일 끝에서 역방향 읽기(reverse read) 구현. 끝에서 지정 바이트 블록만 읽고 줄바꿈을 찾아 필요한 줄만 추출.

#### 2. 초기 tail 읽기에서 항목별 updateAgent 호출 과다
- **파일**: `logMonitor.js` L90-108
- **문제**: 100줄 × N개 파일 → 수백 번의 `updateAgent()`가 초기화 때 한꺼번에 호출됨. 각 호출마다 IPC 이벤트가 renderer로 전달돼서 무의미한 상태 전환 폭풍(Thinking→Working→Idle→Thinking...)이 발생.
- **수정**: 초기 로드 시에는 **각 에이전트 per sessionId의 마지막 상태만** 추출해서 단 1회 updateAgent 호출. 중간 상태 전환은 무시.

#### 3. handleFileChange에서 불완전한 JSON 줄 처리 부재
- **파일**: `logMonitor.js` L174-176
- **문제**: 증분 읽기가 줄 경계를 정확히 맞추지 못할 수 있음. 파일이 줄 중간에서 잘릴 경우 `JSON.parse`가 실패하고 해당 데이터를 영구 유실.
- **수정**: 불완전한 마지막 줄을 `pendingBuffer`에 저장하고, 다음 change 이벤트에서 앞에 붙여서 재시도.

### P1: 중요 (사용 경험에 영향)

#### 4. 멀티→싱글 모드 전환 시 DOM 정리 누락
- **파일**: `renderer.js` L175-227
- **문제**: `renderAgents()`가 싱글 모드(`agentArray.length === 1`)로 갈 때, 기존 멀티 에이전트 DOM 요소(`.agent-container`)를 제거하지 않고 `return`함. CSS `display:none`으로 숨기긴 하지만, DOM에 좀비 요소로 남아 있어 메모리 누수 + ID 충돌 가능.
- **수정**: 싱글 모드 전환 시 `agentGrid` 안의 `.agent-container` 요소를 명시적으로 `remove()`.

#### 5. IPC 이벤트 리스너 누적 (메모리 누수)
- **파일**: `preload.js` L22-33
- **문제**: `ipcRenderer.on()`을 사용하고 있어, renderer가 새로고침(F5 등)될 때마다 **리스너가 누적**됨. `removeAllListeners()` 같은 정리 로직 없음.
- **수정**: `ipcRenderer.on` 대신 리스너 등록/해제 패턴 적용, 또는 renderer 초기화 시 기존 리스너 정리.

#### 6. 윈도우 크기가 고정 (220×200)
- **파일**: `main.js` L15-17
- **문제**: 멀티 에이전트 모드에서도 창 크기가 220×200 고정. 2개 이상 에이전트 시 내부 콘텐츠가 잘리거나 overflow.
- **수정**: `agentManager`의 agent-added/removed 이벤트에 반응하여 `mainWindow.setSize()`로 동적 리사이징.

#### 7. 사용하지 않는 CSS 클래스/코드 잔존
- **파일**: `styles.css`
- **문제**: `.state-offline`, `.state-detecting`, `.paused` 같은 CSS 클래스가 코드 어디서도 사용되지 않음. 레거시 흔적.
- **수정**: 사용하지 않는 CSS 규칙 제거.

### P2: 개선 (품질 향상)

#### 8. jsonlParser.getAgentId()가 agentManager.updateAgent()와 일관성 없음
- **파일**: `jsonlParser.js` L149-161 vs `agentManager.js` L53-55
- **문제**: `getAgentId()`는 `agentId → sessionId → slug` 순서, `updateAgent()`는 `sessionId → agentId → uuid` 순서. 사용하는 곳이 없지만, 향후 사용 시 불일치 가능.
- **수정**: `getAgentId()` 메서드를 제거하거나 `agentManager`와 동일하게 통일.

#### 9. createAgentElement에서 HTML 인젝션 위험
- **파일**: `renderer.js` L128-133
- **문제**: `agent.displayName`을 템플릿 리터럴로 직접 innerHTML에 삽입. XSS는 Electron이므로 보안 문제는 낮지만, 특수 문자 포함 slug 시 렌더 깨짐 가능.
- **수정**: `textContent`로 설정하거나, `createElement()`로 안전하게 구성.

#### 10. agentManager에서 상태 변경 없어도 agent-updated 이벤트 발행
- **파일**: `agentManager.js` L52-93
- **문제**: 기존 에이전트의 상태가 동일해도 매번 `agent-updated` 이벤트를 emit. 불필요한 IPC 트래픽.
- **수정**: 이전 상태와 비교하여 실제 변경 시에만 이벤트 발행.

#### 11. logMonitor에서 이벤트 포워딩 로직 불필요
- **파일**: `logMonitor.js` L20-44
- **문제**: `agentManager`의 이벤트를 `logMonitor`에서 다시 포워딩하지만, `main.js`에서는 `agentManager`에 직접 리스너를 달고 있어 이 포워딩이 실제로 사용되지 않음. 데드 코드.
- **수정**: `logMonitor` 내 이벤트 포워딩 코드 제거.

---

## 주요 기능

| 기능 | 상태 |
|------|------|
| JSONL 로그 실시간 감시 (fs.watch + 증분 읽기) | ✅ 구현됨 |
| 멀티 에이전트 지원 (최대 10개 동시 추적) | ✅ 동적 윈도우 리사이징 적용 완료 |
| 5단계 상태 시스템 (Idle/Thinking/Working/Reporting/Offline) | ✅ 구현됨 (프로세스 감시 포함) |
| 자동 퇴근 (10분 idle 타임아웃) | ✅ 구현됨 (Offline은 5분 경과 시 퇴근) |
| 투명 배경 + Always on Top | ✅ 구현됨 (focusable:false로 창 숨김 방지) |
| 캐릭터 드래그 | ✅ 구현됨 |
| 싱글 ↔ 멀티 에이전트 UI 자동 전환 | ✅ 구현됨 (멀티일 때 풀사이즈 캐릭터 표시) |
| DPI 설정 고정 (프레임 어긋남 방지) | ✅ 구현됨 |
| 백그라운드 애니메이션 최적화 | ✅ 구현됨 |
| 증분 읽기 pendingBuffer 및 최적화 | ✅ 구현됨 |
| 터미널 포커스 기능 | ✅ 아바타 클릭 시 터미널 `SetForegroundWindow` 작동 |

### 7.3 윈도우 인터랙션
- **드래그**: 캐릭터 및 말풍선 영역을 통한 자유로운 창 이동.
- **포커스**: `alwaysOnTop` 고정 및 배경 클릭 통과 (`pointer-events: none`).
- **상호작용**: 이름표 및 말풍선 우클릭을 통한 컨텍스트 메뉴 지원.

---

## 기술 스택

```
Electron (Node.js + HTML/JS/CSS)
├── fs.watch (JSONL 파일 실시간 감시)
├── JSONL Parser (상태 판별 엔진)
├── Agent Manager (멀티 에이전트 관리)
├── IPC 통신 (Main ↔ Renderer)
└── CSS Animation (스프라이트 시트)
```

---

## 아키텍처 흐름

```
~/.claude/projects/*.jsonl (Claude CLI 자동 생성)
       ↓ fs.watch (파일 변경 감지)
logMonitor.js (증분 읽기 + jsonlParser 호출)
       ↓ agentManager.updateAgent()
agentManager.js (멀티 에이전트 상태 관리)
       ↓ EventEmitter (상태 변경 시에만)
main.js (Electron Main Process)
       ↓ IPC (preload.js)
renderer.js (애니메이션 + 상태 라벨)
       ↓ agent 수 변경 시
main.js → mainWindow.setSize() (동적 리사이징)
```

---

## 📁 파일 구조

```
pixel-agent-desk/
├── main.js           # Electron 메인 프로세스, IPC 핸들러, 동적 리사이징
├── logMonitor.js     # JSONL 파일 감시 (fs.watch + 증분 읽기 + pendingBuffer)
├── jsonlParser.js    # JSONL 파싱 엔진, 상태 판별, 역방향 tail
├── agentManager.js   # 멀티 에이전트 관리 (EventEmitter, 상태 diff)
├── renderer.js       # 애니메이션 엔진, 싱글/멀티 UI, DOM lifecycle
├── preload.js        # IPC 통신 브릿지 (contextBridge)
├── index.html        # UI 구조
├── styles.css        # 디자인 시스템 (픽셀 렌더링, 반응형 그리드)
├── package.json      # 의존성 관리
└── avatar_00.png     # 픽셀 캐릭터 스프라이트 시트 (48x64, 9x4 프레임)
```

---

## JSONL 로그 포맷

```json
{
  "sessionId": "uuid",
  "agentId": "agent-uuid",
  "slug": "toasty-sparking-lecun",
  "cwd": "/path/to/project",
  "type": "user|assistant|progress",
  "subtype": "turn_duration",
  "message": {
    "content": [
      { "type": "thinking", "thinking": "..." },
      { "type": "text", "text": "..." },
      { "type": "tool_use", "name": "Write", "input": { ... } }
    ],
    "stop_reason": "end_turn"
  },
  "timestamp": "2026-03-03T...",
  "uuid": "message-uuid",
  "durationMs": 12345
}
```

---

## ✅ 구현 완료

- [x] Electron 투명 배경 창 생성
- [x] JSONL 로그 파일 실시간 감시 (fs.watch + 증분 읽기)
- [x] 5단계 상태 판별 엔진 (Offline 프로세스 감지 추가)
- [x] 멀티 에이전트 관리 (최대 10개, 동적 리사이징 지원)
- [x] 자동 퇴근 (10분 idle 타임아웃, Offline은 5분)
- [x] IPC 통신으로 실시간 상태 업데이트 (`agent-updated` 최적화)
- [x] 상태별 픽셀 아트 애니메이션 및 말풍선 UI (Thinking '...' 시각 효과 분리)
- [x] 캐릭터 드래그 기능 (focusable: false 적용하여 다른 창에 안 가려짐)
- [x] Always on Top + 작업표시줄 폴링(250ms)으로 최상단 유지 강화
- [x] 싱글 ↔ 멀티 에이전트 UI 전환 및 안전한 DOM 관리
- [x] 화면 경계 스냅
- [x] 활성 파일/타임스탬프 필터 (30분 이내 파일만 감시)
- **(NEW)** [x] **대용량 파일 역방향 읽기 (`tailFile`)**
- **(NEW)** [x] **`pendingBuffer`로 JSON 경계 깨짐 복구**
- **(NEW)** [x] **터미널 포커스 (클릭 시 해당 CWD의 터미널 창 호출)**

---

## 🔧 수정 필요 (Phase 2 - 완료)

- [x] **P0-1** tailFile() 역방향 읽기 — 대형 파일 메모리 문제
- [x] **P0-2** 초기 로드 최적화 — sessionId별 마지막 상태만 1회 전달
- [x] **P0-3** 증분 읽기 pendingBuffer — 불완전한 JSON 줄 복구
- [x] **P1-4** 멀티→싱글 전환 시 DOM cleanup
- [x] **P1-5** IPC 리스너 누적 방지
- [x] **P1-6** 동적 윈도우 리사이징 (에이전트 수에 연동)
- [x] **P1-7** 사용하지 않는 CSS 규칙 제거
- [x] **P2-8** getAgentId() 통일
- [x] **P2-9** createElement → 안전한 DOM 구성
- [x] **P2-10** 상태 변경 시에만 emit (diff 비교)
- [x] **P2-11** logMonitor 이벤트 포워딩 데드코드 제거

---

## ❌ 미구현 / ⏸️ 계획 중 (Phase 3 - 기능 확장)

- [ ] 에이전트 별 별도 윈도우 분리 (스티커 뷰 모드)
- [ ] 에이전트별 위치 기억
- [ ] 프로젝트별 그룹화 라벨
- [ ] 커스텀 아바타 이미지
- [ ] 설정 UI (창 크기, 타임아웃 등)

---

## 🔧 실행 방법

```bash
# 1. 의존성 설치
npm install

# 2. 앱 실행
npm start
```

Claude CLI를 실행하면 `~/.claude/projects/` 폴더에 JSONL 로그가 자동 생성되고, Pixel Agent Desk가 이를 감지하여 상태를 시각화합니다.