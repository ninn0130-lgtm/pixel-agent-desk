# PRD 업데이트 요약
## Integration Roadmap 기반 Phase 3-5 개선안

**작성일:** 2026-03-05
**버전:** PRD v5.4.0 (제안)
**참고 문서:** integration_roadmap.md

---

## 📋 개요

본 문서는 `integration_roadmap.md`에서 분석한 Mission Control 아키텍처와 Claude Hooks 데이터를 바탕으로 PRD의 Phase 3-5를 구체화하고 업데이트하는 내용을 요약합니다.

### 핵심 변경사항

1. **Phase 3을 3개 서브 단계로 세분화**
   - Phase 3A: 데이터 구조 개선 (2주)
   - Phase 3B: 훅 데이터 활용 확대 (2주)
   - Phase 3C: Mission Control 고도화 (2주)

2. **신규 기능 추가**
   - 4개 신규 Claude 훅 도입
   - 놓치고 있던 훅 필드 활용
   - 생산성 분석 기능 확장

3. **기술 부채 해결 우선순위 재정비**
   - 이중 sessionId 필드 통일 (P0)
   - JSON 파싱 에러 로깅 (P0)
   - Ajv 스키마 강화 (P0)

---

## 🔄 Phase 3 세분화 상세

### Phase 3A: 데이터 구조 개선 (2주)

#### 목적
시스템 안정성 확보 및 기술적 부채 해결

#### 주요 변경사항

**1. 이중 sessionId 필드 통일 (P0, 4시간)**
```javascript
// 문제: session_id와 sessionId 혼재 사용
// 해결: normalizeSessionId() 헬퍼 함수 도입

// 영향 파일
- agentManager.js
- missionControlAdapter.js
- sessionend_hook.js
- utils.js
```

**2. JSON 파싱 에러 로깅 (P0, 2시간)**
```javascript
// 문제: hook.js silent failure
// 해결: parse-errors.log 파일에 기록

const errorLogPath = path.join(os.homedir(), '.pixel-agent-desk', 'parse-errors.log');
fs.appendFileSync(errorLogPath, `[${timestamp}] Parse Error: ${e.message}\n`);
```

**3. Ajv 스키마 강화 (P0, 6시간)**
```javascript
// 신규 필드 추가
{
    transcript_path: string,      // 세션 로그 경로
    permission_mode: "auto|manual", // 권한 모드
    tool_use_id: string,          // 툴 호출 ID
    error: object                 // 에러 상세 정보
}
```

**4. state.json 백업 메커니즘 (P1, 4시간)**
```javascript
// 안정성 강화
- 쓰기 전 백업
- 실패 시 자동 복구
- 롤백 계획
```

#### PRD 업데이트 항목

**P0 항목 추가:**
- [x] 필드명 통일 (4시간) - **신규**
- [x] JSON 파싱 로깅 (2시간) - **신규**
- [x] Ajv 스키마 강화 (6시간) - **신규**

**P1 항목 추가:**
- [x] state.json 백업 (4시간) - **신규**

**기존 항목 수정:**
- 메모리 누수 재검증 (8시간) - 유지
- main.js 단위 테스트 (16시간) - 유지

---

### Phase 3B: 훅 데이터 활용 확대 (2주)

#### 목적
Claude Hooks의 풍부한 데이터 모델 활용으로 기능 확장

#### 주요 변경사항

**1. UserPromptSubmit 훅 도입 (P0, 8시간)**

**용도:** 사용자 프롬프트 품질 검증

```javascript
// hooks/userPromptSubmit.js (신규)
function validatePrompt(prompt) {
    const checks = {
        length: prompt.length > 0 && prompt.length < 100000,
        hasInstructions: /\b(can you|please|help|create|fix|debug)\b/i.test(prompt),
        hasContext: /\b(in|at|for|with|from)\b/i.test(prompt)
    };

    return {
        valid: Object.values(checks).every(v => v),
        score: Object.values(checks).filter(v => v).length / 3
    };
}
```

**UI 통합:**
- 낮은 품질 프롬프트 알림
- 개선 제안 표시
- 품질 점수 표시

**2. PermissionRequest 훅 도입 (P1, 6시간)**

**용도:** 권한 요청 모니터링 및 자동 승인

```javascript
function shouldAutoApprove(permission) {
    const safeReads = ['read_file', 'list_directory', 'search_files'];
    return safeReads.includes(permission.tool_name) &&
           permission.permission_mode === 'auto';
}
```

**UI 통합:**
- 권한 모드 표시 (auto/manual)
- 자동 승인 로그
- 수동 승인 요청 UI

**3. PostToolUseFailure 훅 도입 (P1, 6시간)**

**용도:** 툴 실패 모니터링 및 재시도

```javascript
function categorizeError(error) {
    if (error.message.includes('ENOENT')) return 'file_not_found';
    if (error.message.includes('EACCES')) return 'permission_denied';
    if (error.message.includes('timeout')) return 'timeout';
    return 'unknown';
}
```

**UI 통합:**
- 에러 분류 표시
- 재시도 가능 여부 표시
- 에러 추적

**4. transcript_path 활용 (P2, 4시간)**

**용도:** 세션 로그 분석

```javascript
async function analyzeTranscript(transcriptPath) {
    // {
    //     totalMessages: 0,
    //     userMessages: 0,
    //     assistantMessages: 0,
    //     toolCalls: 0,
    //     totalTokens: 0,
    //     duration: 0
    // }
}
```

#### PRD 업데이트 항목

**P0 항목 추가:**
- [x] UserPromptSubmit 훅 (8시간) - **신규**

**P1 항목 추가:**
- [x] PermissionRequest 훅 (6시간) - **신규**
- [x] PostToolUseFailure 훅 (6시간) - **신규**

**P2 항목 추가:**
- [x] transcript 분석 (4시간) - **신규**

---

### Phase 3C: Mission Control 고도화 (2주)

#### 목적
단일 HTML 구조를 모듈화하고 대시보드 기능 확장

#### 주요 변경사항

**1. 파일 구조 재설계 (P0, 4시간)**

```
Before:
mission-control.html (693줄 단일 파일)

After:
mission-control/
├── index.html          # 진입점
├── js/
│   ├── api.js          # API 클라이언트
│   ├── state.js        # 상태 관리
│   ├── dashboard.js    # 대시보드 렌더링
│   └── utils.js        # 헬퍼 함수
└── css/
    └── dashboard.css    # 스타일
```

**2. API 엔드포인트 확장 (P0, 8시간)**

```javascript
// 신규 엔드포인트
GET  /api/timeline         // 타임라인 조회
POST /api/agents/dismiss   // 에이전트 제거
GET  /api/analytics        // 분석 데이터
GET  /api/snapshot         // 상태 스냅샷
```

**3. SSE 실시간 업데이트 (P1, 6시간)**

```javascript
// WebSocket → 단순화된 SSE
app.get('/api/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    // ... SSE 구현
});

// 지연 목표: 100ms 이하
```

**4. 필터링 및 정렬 (P1, 4시간)**

```javascript
class DashboardFilter {
    // 프로젝트 필터
    // 상태 필터
    // 타입 필터
    // 시간/프로젝트/활동 정렬
}
```

#### PRD 업데이트 항목

**P0 항목 추가:**
- [x] 파일 구조 재설계 (4시간) - **신규**
- [x] API 확장 (8시간) - **신규**

**P1 항목 추가:**
- [x] SSE 실시간 업데이트 (6시간) - **신규**
- [x] 필터링/정렬 (4시간) - **신규**

**기존 항목 수정:**
- 타임라인 시각화 (16시간) - 유지
- 대시보드 UI 개선 - 통합

---

## 📊 Phase 4: 생산성 분석 (4주)

### 추가 기능

**1. 시간대별 작업 패턴 분석 (P0, 12시간)**
```javascript
class TimeAnalyzer {
    getPeakHours()          // 피크 시간대
    getWorkSchedule()       // 업무/비업무 시간 비율
}
```

**2. 병목 발견 (P0, 8시간)**
```javascript
class BottleneckDetector {
    checkTaskDuration()     // 10분 초과 작업 탐지
    getBottlenecks()        // 프로젝트별 병목
    getAlerts()             // 알림 생성
}
```

**3. 생산성 지표 (P1, 8시간)**
```javascript
class ProductivityMetrics {
    completionRate          // 완료율
    avgTaskTime            // 평균 작업 시간
    activeTimeRatio        // 활동 시간 비율
    throughput             // 처리량
}
```

**4. 일일/주간 리포트 (P2, 8시간)**
```javascript
class ReportGenerator {
    generateDailyReport()   // 일일 리포트
    generateWeeklyReport()  // 주간 리포트
    generateInsights()      // 인사이트 생성
}
```

### PRD 업데이트 항목

**P0 항목 추가:**
- [x] 시간대별 패턴 분석 (12시간) - **신규**
- [x] 병목 발견 (8시간) - **신규**

**P1 항목 추가:**
- [x] 생산성 지표 (8시간) - **신규**

**P2 항목 추가:**
- [x] 일일/주간 리포트 (8시간) - **신규**

---

## 👥 Phase 5: 팀 협업 (8주)

### 추가 기능

**1. 사용자 인증 시스템 (P0, 16시간)**
```javascript
class UserAuth {
    createUser()            // 사용자 생성
    authenticate()          // 인증
    validateSession()       // 세션 검증
    hashPassword()          // 비밀번호 해시
}
```

**역할:**
- viewer: 읽기 전용
- operator: 읽기 + 쓰기
- admin: 전체 접근

**2. 팀 대시보드 (P1, 20시간)**
```javascript
class TeamDashboard {
    getTeamView()           // 팀 전체 보기
    getUserSummary()        // 사용자 요약
    getTeamStats()          // 팀 통계
}
```

**3. 사용자별 필터링 (P1, 8시간)**
```javascript
class UserFilter {
    toggleUser()            // 사용자 토글
    filter()                // 필터 적용
}
```

**4. 상태 비교 기능 (P2, 12시간)**
```javascript
class UserComparison {
    compareUsers()          // 사용자 비교
    getMostActive()         // 가장 활발한
    getHighestCompletion()  // 가장 높은 완료율
}
```

### PRD 업데이트 항목

**P0 항목 추가:**
- [x] 사용자 인증 시스템 (16시간) - **신규**

**P1 항목 추가:**
- [x] 팀 대시보드 (20시간) - **신규**
- [x] 사용자별 필터링 (8시간) - **신규**

**P2 항목 추가:**
- [x] 상태 비교 기능 (12시간) - **신규**

---

## 📈 성공 기준 정량화

### Phase 3A (데이터 구조)
- [ ] 테스트 커버리지 35% 이상
- [ ] sessionId 혼재 0%
- [ ] JSON 파싱 실패 100% 로깅
- [ ] state.json 복구 성공률 100%

### Phase 3B (훅 활용)
- [ ] 프롬프트 검증 정확도 90%
- [ ] 권한 자동 승인률 60%
- [ ] 에러 분류 정확도 90%
- [ ] transcript 분석 성공률 95%

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

## 💰 예산 변경사항

### 기존 PRD 예산
- Phase 3: 92시간 (4주)
- Phase 4: 92시간 (4주)
- Phase 5: 152시간 (8주)
- **총계:** 336시간

### 업데이트된 예산
- Phase 3A: 24시간 (2주)
- Phase 3B: 24시간 (2주)
- Phase 3C: 24시간 (2주)
- Phase 4: 36시간 (4주)
- Phase 5: 56시간 (8주)
- **총계:** 164시간

**절감:** 172시간 (51% 감소)

### 예산 절감 이유
1. SQLite 도입 제외 (12시간 절감)
2. 플랫폼 추상화 간소화 (16시간 절감)
3. 머신러닝 기능 제외 (40시간 절감)
4. OAuth2 간소화 (8시간 절감)
5. 고급 시각화 범위 축소 (20시간 절감)

---

## 🎯 우선순위 재조정

### P0 (긴급, 6주)
1. Phase 3A 전체 (2주)
2. UserPromptSubmit 훅 (1주)
3. Phase 3C 파일 분리 + API (1주)
4. Phase 4 시간 분석 + 병목 (1.5주)
5. Phase 5 인증 시스템 (1주)

### P1 (중요, 7주)
1. Phase 3B 나머지 훅 (1주)
2. Phase 3C SSE + 필터링 (1주)
3. Phase 4 생산성 지표 (1주)
4. Phase 5 팀 대시보드 (2.5주)
5. Phase 5 필터링 (0.5주)

### P2 (선택, 4주)
1. Phase 3B transcript 분석 (0.5주)
2. Phase 4 리포트 (0.5주)
3. Phase 5 상태 비교 (1주)
4. Phase 5 내보내기 기능 (1주)
5. Phase 5 통합 기능 (1주)

---

## 🚀 구현 일정

### Week 1-2: Phase 3A (기반 안정화)
- Day 1: sessionId 통일
- Day 2: JSON 로깅
- Day 3-5: Ajv 스키마
- Day 6-8: 백업 시스템
- Day 9-10: 테스트 작성

### Week 3-4: Phase 3B (훅 활용)
- Day 11-14: UserPromptSubmit
- Day 15-17: PermissionRequest
- Day 18-20: PostToolUseFailure
- Day 21-22: transcript 분석

### Week 5-6: Phase 3C (대시보드)
- Day 23-24: 파일 분리
- Day 25-28: API 확장
- Day 29-32: SSE 구현
- Day 33-35: 필터링/정렬

### Week 7-10: Phase 4 (분석)
- Day 36-41: 시간 분석
- Day 42-47: 병목 발견
- Day 48-53: 생산성 지표
- Day 54-59: 리포트 생성

### Week 11-18: Phase 5 (협업)
- Day 60-69: 인증 시스템
- Day 70-85: 팀 대시보드
- Day 86-91: 필터링
- Day 92-101: 상태 비교

---

## 📋 PRD 업데이트 체크리스트

### Phase 3A
- [x] 개요 섹션 업데이트
- [x] 기술적 목표 섹션 추가
- [x] 우선순위별 기능 목록 수정
- [x] 예상 소요 시간 표 업데이트
- [x] 성공 기준 추가

### Phase 3B
- [x] 개요 섹션 업데이트
- [x] 훅 도입 목록 추가
- [x] UI 통합 계획 추가
- [x] 예상 소요 시간 표 업데이트
- [x] 성공 기준 추가

### Phase 3C
- [x] 개요 섹션 업데이트
- [x] 파일 구조 재설계 추가
- [x] API 엔드포인트 목록 추가
- [x] SSE 구현 계획 추가
- [x] 예상 소요 시간 표 업데이트
- [x] 성공 기준 추가

### Phase 4
- [x] 개요 섹션 업데이트
- [x] 시간대별 분석 추가
- [x] 병목 발견 추가
- [x] 생산성 지표 추가
- [x] 리포트 기능 추가
- [x] 예상 소요 시간 표 업데이트
- [x] 성공 기준 추가

### Phase 5
- [x] 개요 섹션 업데이트
- [x] 사용자 인증 추가
- [x] 팀 대시보드 추가
- [x] 필터링 기능 추가
- [x] 상태 비교 추가
- [x] 예상 소요 시간 표 업데이트
- [x] 성공 기준 추가

---

## 📚 참고 자료

1. **integration_roadmap.md** - 전체 로드맵 상세
2. **mission-control-main/README.md** - Mission Control 참조 아키텍처
3. **현재 프로젝트 구조** - agentManager.js, hook.js, main.js
4. **Claude Hooks 문서** - 훅 데이터 모델 분석

---

## ✅ 결론

본 업데이트는 Mission Control의 성숙한 패턴과 Claude Hooks의 풍부한 데이터를 활용하여 Pixel Agent Desk를 4개월 내에 현대화하는 구체적인 계획을 제시합니다.

### 핵심 성과
1. **데이터 안정성:** sessionId 통일, 검증 강화
2. **훅 활용:** 4개 신규 훅으로 데이터 풍부화
3. **대시보드:** 단일 파일 → 모듈화, API 확장
4. **분석:** 생산성 인사이트 제공
5. **협업:** 팀 기능 도입

### 다음 단계
1. PRD Phase 3-5 섹션 업데이트
2. 팀 리뷰 및 승인
3. Phase 3A 착수 (sessionId 통일)

---

**문서 버전:** 1.0
**마지막 수정:** 2026-03-05
**상태:** PRD 업데이트 제안 완료
