# 📋 PRD: Pixel Agent Desk v2

## 목표
Claude CLI 사용 중인 세션을 픽셀 캐릭터로 시각화하고 세션의 생명주기(시작/종료)를 안정적으로 관리

## 핵심 기능
1. **JSONL 파일 감시**: `~/.claude/projects/*/` 폴더의 `.jsonl` 파일 실시간 모니터링
2. **멀티 에이전트**: 여러 Claude CLI 세션 동시 표시
3. **상태 시각화**: Working/Done/Waiting/Error 상태에 따른 애니메이션
4. **터미널 포커스**: 에이전트 클릭 시 해당 터미널로 포커스
5. **서브에이전트**: `subagents/agent-*.jsonl` 파일 감지 → 별도 아바타 (보라색 작은 캐릭터)
6. **실시간 종료 감지**: HTTP 훅과 시스템 프로세스 스캔을 결합한 하이브리드 종료 감지

## 상태 정의
| 상태 | 조건 | 애니메이션 |
|------|------|-----------|
| Working | `stop_reason` 없음 | 일하는 포즈 (frames 1-4) |
| Done | `stop_reason: "end_turn"` | 춤추는 포즈 (frames 20-27) |
| Waiting | 초기 상태 (에이전트 없을 때) | 앉아 있는 포즈 (frame 32) |
| Error | 에러 발생 | 경고 포즈 (frames 0, 31) |

## 에이전트 생명주기 (삼중 보호 시스템)
1. **HTTP 콜백 (1순위)**:
   - Claude CLI가 시작/종료 시 `localhost:47821`로 POST 요청을 보냄
   - 정상 종료(`/exit`) 시 즉시 아바타 제거 (가장 빠르고 정확함)
2. **시스템 프로세스 스캔 (2순위/백업)**:
   - 터미널 강제 종료(X버튼) 시 훅이 실행되지 않는 문제를 해결하기 위해 도입
   - 5초마다 시스템의 모든 `node.exe` 중 `claude-code` 관련 프로세스 수를 스캔
   - 에이전트 수보다 프로세스 수가 적으면, 활동성(mtime)이 낮은 에이전트부터 순차적 제거
3. **활성 시간 타임아웃 (3순위)**:
   - JSONL 파일의 mtime 기준 30분 이상 변화가 없으면 최종적으로 제거 (매 5분 체크)

## 아키텍처
```
[Claude CLI] ─── (HTTP POST) ───┐
      │                         │
(JSONL write)             [HTTP Hook Server] (Port: 47821)
      │                         │
      ▼                         ▼
[LogMonitor] ───────► [AgentManager] ◄────── [ProcessScanner] (5s interval)
      │               (State Engine)
      └───────────────────► │
                           ▼
                    [IPC] ──► [Renderer/UI]
```

## 파일 구조
- `main.js`: Electron 메인 프로세스, HTTP 훅 서버 및 프로세스 스캔 로직 포함
- `logMonitor.js`: JSONL 파일 감시 및 변경 사항 감지
- `jsonlParser.js`: 로그 데이터 파싱 및 상태 추출
- `agentManager.js`: 에이전트 객체 관리 및 상태 변경 이벤트 발행
- `sessionstart_hook.js`: Claude CLI 시작 시 실행되는 커맨드 훅 (현재는 로깅 용도)
- `sessionend_hook.js`: Claude CLI 종료 시 실행되는 커맨드 훅 (JSONL에 세션 종료 기록)

## 구현 현황
- ✅ JSONL 파일 감시 및 실시간 상태 업데이트
- ✅ 멀티 에이전트 동적 레이아웃 (Electron 윈도우 리사이징)
- ✅ 서버리스(HTTP Hook Server 내장) 방식의 세션 종료 감지
- ✅ Windows 환경의 단명 프로세스(Wrapper) 문제를 극복한 시스템 스캔 백업 로직
- ✅ 서브에이전트 시각적 구분 및 별도 상태 관리
- ✅ Atomic File Write를 통한 `agent_pids.json` 무결성 확보

## 향후 과제
### Offline 상태 (흐림 표시)
터미널이 닫혔을 가능성이 있는 상태(mtime 5분 초과)에서 아바타를 흑백+반투명으로 표시하여 사용자에게 알림. 30분 초과 시 완전 제거.

## 실행 방법
```bash
# 1. 의존성 설치
npm install

# 2. 앱 실행 (앱 실행 시 ~/.claude/settings.json에 훅이 자동 등록됨)
npm start

# 3. Claude CLI 실행
claude
```

## 테스트 방법
1. 터미널에서 `claude` 실행 → 아바타 등장 확인
2. 대화 진행 → `Working` 애니메이션 확인
3. 터미널에서 `/exit` 입력 → 아바타 즉시 사라짐 확인 (HTTP 훅 테스트)
4. 새 터미널에서 `claude` 실행 후 창 강제 종료(X버튼) → 약 15초 내에 아바타 사라짐 확인 (프로세스 스캔 테스트)
