# Pixel Agent Desk v2.0 - Implementation Summary

## Overview
Pixel Agent Desk v2.0는 Claude CLI의 JSONL 로그 파일을 실시간으로 파싱하여 여러 에이전트를 픽셀 아바타로 시각화합니다. 훅(Hook) 시스템을 사용하지 않고 로그 파일 감시(Log Tailing)만으로 동작합니다.

## Core Components

### 1. `jsonlParser.js` - JSONL 파싱 엔진
- `~/.claude/projects/` 폴더 스캔
- JSONL 파일에서 에이전트 정보 추출 (sessionId, agentId, slug, projectPath)
- 4단계 상태 결정:
- **Idle**: `stop_reason: "end_turn"`
  - **Thinking**: `type: "assistant"` + `thinking` 필드
  - **Working**: `type: "progress"` 또는 `tool_use`
  - **Reporting**: `type: "assistant"` + `text` 출력
  - **Offline**: 해당 `cwd`에서 실행 중인 `claude.exe`를 찾지 못함
- Smart Tailing: 파일 끝에서 역방향 32KB 읽기 (`fs.readSync`) 방식으로 최적화

### 2. `agentManager.js` - 멀티 에이전트 관리자
- 최대 10개 에이전트 동시 추적
- 10분 idle 타임아웃 후 자동 퇴근
- EventEmitter 기반 상태 업데이트
- 에이전트 통계 제공

### 3. `logMonitor.js` - 로그 파일 감시자
- `fs.watch` 기반 실시간 파일 변경 감지
- 5초 간격으로 새 JSONL 파일 발견
- 증분 읽기: 변경된 바이트만 읽어 파싱
- `pendingBuffer`를 사용하여 JSON 객체 중간 잘림 복구 처리

### 4. `processWatcher.js` - 프로세스 및 터미널 관리자 (NEW)
- PowerShell WMI(`Get-CimInstance`)를 통한 `claude.exe` 프로세스 주기적 스캔
- 에이전트 경로(`cwd`)와 매칭하여 Offline 상태 부여
- `SetForegroundWindow` API를 통한 터미널 (Windows Terminal, pwsh, cmd) 포커스 기능

### 5. `main.js` - Electron 메인 프로세스
- 윈도우 생성 및 관리 (동적 리사이징 지원, 최대 3열 레이아웃)
- AgentManager & ProcessWatcher 연동 (`checkProcesses` 10초 스캔)
- `focusable: false`로 다른 창 선택 시에도 항상 위에 표시되는(가려지지 않는) 기능 구현
- 작업표시줄 클릭 시 포커스 뺏김 현상을 250ms 폴링으로 우회 해결
- IPC 핸들러: `focus-terminal`, `get-all-agents` 등 API 노출

### 5. `renderer.js` - UI 렌더러
- **싱글 에이전트 모드**: 에이전트가 1개 이하일 때
- **멀티 에이전트 모드**: 2개 이상일 때 그리드 레이아웃
- 애니메이션 루프 (requestAnimationFrame)
- 컨텍스트 메뉴 (우클릭)

### 6. `preload.js` - IPC 브릿지
- 안전한 contextBridge API 노출
- 멀티 에이전트 이벤트 리스너

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    main.js                              │
│  ┌──────────────┐  ┌──────────────┐                    │
│  │ AgentManager │  │  LogMonitor  │                    │
│  │  (Events)    │  │  (JsonlParser)│                    │
│  └──────┬───────┘  └──────┬───────┘                    │
│         │                 │                              │
│         └─────────────────┘                              │
│                           │                              │
│                    IPC (Renderer)                       │
└───────────────────────────┼──────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────┐
│                   renderer.js                           │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │ Single Agent │  │ Multi-Agent  │  │  Animations  │  │
│  │  (Big View)  │  │ (Cards Grid) │  │(CSS & frame) │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  │
└─────────────────────────────────────────────────────────┘
```

## Key Features

### 1. No Hook System Required
- Claude CLI 설정 파일 수정 없음
- 로그 파일 읽기만으로 동작 (Read-Only)

### 2. Memory Efficient
- Incremental Reading: 변경된 바이트만 읽음 (fs.watch + lastSize 추적)
- 새 파일 발견: 5초 주기 스캔으로 CPU 부담 최소화

### 3. Auto-Cleanup
- 10분간 활동 없는 에이전트 자동 제거
- 최대 10개 에이전트 제한

### 4. Responsive UI
- Single ↔ Multi 모드 자동 전환
- requestAnimationFrame으로 부드러운 애니메이션

## Log Format

JSONL 파일 각 줄의 형식:
```json
{
  "sessionId": "uuid",
  "agentId": "agent-uuid",
  "slug": "toasty-sparking-lecun",
  "cwd": "/path/to/project",
  "type": "user|assistant|progress",
  "message": { ... },
  "timestamp": "2026-03-03T...",
  "uuid": "message-uuid"
}
```

## State Detection Logic

```javascript
// 1. Working (highest priority)
if (type === 'progress' || toolUseResult) return "Working";

// 2. Content array analysis
if (type === 'assistant' && message.content) {
  if (content.some(c => c.type === 'tool_use')) return "Working";
  if (content.some(c => c.type === 'thinking')) return "Thinking";
  if (content.some(c => c.type === 'text')) return "Reporting";
}

// 3. Finished/Idle
if (subtype === 'turn_duration') return "Idle";
if (message.stop_reason === 'end_turn') return "Idle";

// Default
return "Idle";
```

## Testing

1. **단일 에이전트**: 하나의 Claude Code 세션 시작 → 싱글 아바타
2. **멀티 에이전트**: 여러 터미널에서 Claude Code 실행 → 그리드 레이아웃
3. **상태 전환**: 작업 시작/종료로 상태 변화 확인
4. **자동 퇴근**: 10분간 활동 없으면 에이전트 사라짐

## Future Enhancements

- 에이전트별 위치 기억
- 프로젝트별 그룹화
- 커스텀 아바타 이미지
- 활동 내역 시각화

---

**Version**: 2.0.0 (Log Mode Only)
**Date**: 2026-03-03
