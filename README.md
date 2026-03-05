# Pixel Agent Desk v2.0 👾

Claude CLI의 Hook 이벤트를 실시간으로 수신하여 여러 에이전트의 상태를 픽셀 아트로 시각화하는 데스크톱 대시보드입니다.

## 🌟 주요 기능

- **PID 기반 정교한 생명주기 관리**: 3초마다 프로세스 신호를 체크하여 Claude 종료 시 즉시 아바타를 제거합니다.
- **실시간 상태 시각화 (Total Hooks)**:
  - ⚙️ **Working**: `UserPromptSubmit` 혹은 도구 사용 중 (일하는 포즈)
  - ✅ **Done**: `Stop` 혹은 작업 종료 (춤추는 포즈)
  - 💤 **Waiting**: 초기 대기 및 입력 대기 상태 (앉아있음)
  - ❓ **Help**: 권한 요청 및 알림 감지 (도움 요청 포즈)
  - ⚠️ **Error**: 도구 실행 실패 시 표시
- **인터랙티브 대시버드**:
  - **터미널 자동 포커스**: 아바타 클릭 시 해당 Claude 세션이 실행 중인 터미널 창을 최상단으로 가져옵니다.
  - **자동 복구 (Resume)**: 앱을 껐다 켜도 현재 실행 중인 모든 Claude 세션을 자동으로 찾아 아바타를 복구합니다.
  - **Dashboard**: 웹 대시보드로 팀 전체 현황을 모니터링할 수 있습니다 (REST API + WebSocket 지원).
- **자동 훅 등록**: 앱 시작 시 Claude CLI의 `settings.json`에 Hook 스크립트를 자동 등록합니다.

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
### 3. 사용
Claude Code가 실행되면 앱이 이를 즉시 감지하여 화면에 픽셀 캐릭터를 띄웁니다.
- **캐릭터 클릭**: 해당 터미널 창을 활성화합니다.
- **X 버튼**: 화면에서 아바타를 수동으로 제거합니다 (프로세스는 유지됨).
- **종료**: 터미널에서 `exit`하거나 창을 닫으면 아바타도 수 초 내에 사라집니다.

## 📁 프로젝트 구조

```
pixel-agent-desk/
├── main.js                    # Electron 메인 프로세스, HTTP 훅 서버, 동적 윈도우 리사이징
├── hook.js                    # 범용 훅 스크립트 (Claude CLI → HTTP 서버)
├── sessionend_hook.js         # 세션 종료 시 JSONL에 SessionEnd 기록
├── agentManager.js            # 멀티 에이전트 데이터 관리 (EventEmitter)
├── renderer.js                # 애니메이션 엔진, 에이전트 0개일 때 대기 아바타 표출
├── preload.js                 # IPC 통신 브릿지
├── utils.js                   # 유틸리티 함수
├── dashboard-server.js  # Dashboard 웹 서버 (REST API + WebSocket)
├── dashboard.html       # Dashboard 대시보드 페이지
├── missionControlPreload.js   # Dashboard IPC 브릿지
├── index.html                 # UI 뼈대 구조
├── styles.css                 # 디자인 시스템
└── package.json               # 의존성 관리
```

## 📋 기술적 특징

### Hook 기반 이벤트 수신
- Claude CLI의 모든 주요 이벤트를 Hook으로 수신:
  - `SessionStart`, `SessionEnd`: 세션 생명주기 관리
  - `PreToolUse`, `PostToolUse`: 작업 상태 감지
  - `TaskCompleted`: 작업 완료 상태 전환
  - `PermissionRequest`: 권한 요청 상태
  - `SubagentStart`, `SubagentStop`: 서브에이전트 관리

### 정교한 PID 관리
- `process.kill(pid, 0)` 신호를 통해 프로세스 생존을 3초마다 체크합니다.
- 앱 시작 시 살아있는 Claude PID를 조회하여 기존 활성 세션을 100% 복구합니다.

### 2.5초 자동 완료 전환
- Claude CLI가 간혹 `TaskCompleted` 훅을 보내지 않는 경우를 대비하여, 마지막 활동 후 2.5초가 지나면 자동으로 `Done` 포즈로 전환합니다.
