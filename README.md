# Pixel Agent Desk v2.0 👾

Claude CLI의 JSONL 로그 파일을 실시간으로 감시하여 여러 에이전트의 상태를 픽셀 아트로 시각화하는 데스크톱 대시보드입니다.

![Pixel Agent Demo](avatar_00.png)

## 🌟 주요 기능

- **Log-Only 아키텍처**: Hook 없이 JSONL 로그 파일만 감시 (Read-Only)
- **실시간 감지**: `fs.watch` + 증분 읽기 — 변경된 바이트만 즉시 파싱
- **멀티 에이전트 지원**: 최대 10개의 동시 작업 중인 에이전트를 각각의 픽셀 아바타로 표시 (동적 윈도우 리사이징)
- **5단계 상태 시스템**:
  - 💤 **Idle**: `stop_reason: "end_turn"` 또는 활동 없음
  - 🧠 **Thinking**: `type: "assistant"` + `content[].type === "thinking"` (말풍선 ... 깜빡임)
  - ⚙️ **Working**: `type: "progress"` 또는 `tool_use`
  - 💬 **Reporting**: `type: "assistant"` + `content[].type === "text"`
  - 🔴 **Offline**: `claude.exe` 프로세스가 해당 경로에서 종료됨 (흑백 캐릭터)
- **터미널 포커스**: 에이전트 카드를 클릭하면 해당하는 터미널 창을 최상위로 가져옵니다.
- **자동 퇴근**: 10분간 활동이 없는 에이전트 자동 제거 (Offline은 5분)
- **최상단 유지 (Always on Top)**: 화면 최상단에 고정 (`focusable: false`로 포커스 뺏김 방지)
- **드래그 가능**: 마우스로 화면 내 원하는 위치로 이동

## 🚀 시작하기

### 1. 설치
```bash
npm install
```

### 2. 실행
```bash
npm start
```

### 3. 사용
Claude Code를 실행하면 `~/.claude/projects/`에 JSONL 로그가 자동 생성되고, Pixel Agent Desk가 이를 감지하여 상태를 시각화합니다.

## 🛠 기술 스택

- **Framework**: Electron 32.0.0
- **Runtime**: Node.js
- **Log Monitoring**: `fs.watch` + 증분 읽기 (실시간)
- **Log Parsing**: JSONL 상태 판별 엔진
- **Frontend**: Vanilla JS, CSS (Pixel Art Sprite Sheet)

## 📁 프로젝트 구조

```
pixel-agent-desk/
├── main.js           # Electron 메인 프로세스, IPC 핸들러, 동적 리사이징
├── logMonitor.js     # JSONL 파일 감시 (fs.watch + 증분 읽기 + pendingBuffer)
├── jsonlParser.js    # JSONL 파싱 엔진, 역방향 tail 읽기
├── agentManager.js   # 멀티 에이전트 관리 (EventEmitter)
├── processWatcher.js # Claude 프로세스 감지 및 터미널 포커스
├── renderer.js       # 애니메이션 엔진, 싱글/멀티 UI (가상 DOM 구조)
├── preload.js        # IPC 통신 브릿지
├── index.html        # UI 구조
├── styles.css        # 디자인 시스템 (상태 컬러링)
├── package.json      # 의존성 관리
└── avatar_00.png     # 픽셀 캐릭터 스프라이트 시트 (48x64)
```

## 🔧 아키텍처

```
~/.claude/projects/*.jsonl
       ↓ fs.watch
logMonitor.js → jsonlParser.js → agentManager.js
       ↓ IPC (preload.js)
renderer.js (애니메이션 + 상태 라벨)
```

## 📊 에이전트 상태

| 상태 | 조건 | UI |
|------|------|-----|
| 💤 Idle | `stop_reason: "end_turn"` | 가만히 서 있기 (회색 말풍선) |
| 🧠 Thinking | `assistant + thinking` | "..." 점 깜빡임 (파란 테두리) |
| ⚙️ Working | `progress / tool_use` | 바쁘게 움직임 8fps (주황 진동) |
| 💬 Reporting | `assistant + text` | 가만히 서 있기 (초록 말풍선) |
| 🔴 Offline | 프로세스 없음 (PS WMI) | 흑백 캐릭터 (빨간 말풍선) |

## 📋 구현 현황

### ✅ 구현 완료
- JSONL 로그 파일 실시간 감시 (fs.watch + 증분 읽기 완전 최적화)
- 대용량 파일 역방향 읽기 (`tailFile`) 및 `pendingBuffer` 복구
- 5단계 상태 시스템 (Offline 프로세스 감시 등)
- 멀티 에이전트 지원 및 동적 창 리사이징
- 싱글 ↔ 멀티 에이전트 UI 자동 전환
- 터미널 포커스 (클릭 시 해당 터미널 창 호출)
- 10분/5분 idle 프로세스 기반 자동 퇴근
- 드래그 지원 및 `focusable: false`로 창숨김 완전 방지

## 📄 라이선스
MIT License
