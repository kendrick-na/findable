# A-16-O1 — Day16 배포·CI 설계 (Vercel 자동배포 + GitHub Actions)

> 2026-07-27 · 4주차(프로덕션) 시작 · Track A 바이브코딩 고급
> 실습 규칙: 산출물=문서/설계. 코드(apps/) 미변경(라이브 서비스, §7.3 고위험 보류).
> 블라인드 재검증: 커리큘럼 개념 → Findable 실측 대조 → 발견.

## 0. 커리큘럼 vs 실측 (블라인드 재검증)

커리큘럼 Day16 = "Vercel 자동배포 · GitHub Actions". 교재는 GitHub Actions로 lint/test/build 게이트를 세우고 main 머지 시 배포하는 그림을 전제한다. Findable 실측은 다르다.

| 항목 | 커리큘럼 전제 | Findable 실측 (2026-07-27) | 판정 |
|------|--------------|---------------------------|------|
| CI 워크플로 | `.github/workflows/*.yml` | **`.github/` 자체 없음** | D16-1 gap |
| 배포 방식 | Actions→Vercel 배포 | Vercel Git 연동 자동배포(push 감지) | 이미 동작 |
| 빌드 게이트 | Actions에서 lint/test | 각 앱 `vercel.json`의 `ignoreCommand: node scripts/skip-ci.js` | 부분 존재 |
| 앱별 선택 빌드 | 모노레포 turbo affected | Vercel 프로젝트별 root=`apps/web`·`apps/app`·`apps/api` 분리 | 이미 동작 |
| cron | (범위 밖) | `apps/api/vercel.json` crons = **keep-alive 1개뿐** | D16-2 gap |

**★핵심 발견 D16-1 — CI가 "없다"기보다 "Vercel에 위임돼 있다"**
Findable은 GitHub Actions 없이도 배포가 돌아간다. Vercel이 Git push를 직접 감지해 빌드·배포하기 때문이다. 즉 커리큘럼의 "GitHub Actions 도입"을 그대로 따르는 건 **없는 문제를 만드는 것**에 가깝다. 다만 지금 구조엔 **머지 전 품질 게이트가 없다** — `skip-ci.js`는 커밋 메시지에 `[skip ci]`가 있으면 빌드를 건너뛸 뿐(아래 D16-3), lint/typecheck 실패를 배포 전에 잡아주지 않는다. 빌드가 깨지면 Vercel 빌드 단계에서야 실패한다. 그래서 Day16의 실질 과제는 "Actions를 새로 깐다"가 아니라 **"배포 전에 실패를 당길 최소 게이트가 필요한가"를 판단**하는 것이다.

**★발견 D16-3 — `skip-ci.js`는 게이트가 아니라 스킵 스위치**
```js
// apps/*/scripts/skip-ci.js (4개 앱 동일)
const commitMessage = execSync("git log -1 --pretty=%B").toString().trim();
if (commitMessage.includes("[skip ci]")) process.exit(0); // Vercel 빌드 스킵
process.exit(1); // 계속 빌드
```
이건 "이 커밋은 빌드하지 마라"는 수동 스위치일 뿐, 품질 검증이 아니다. 문서 전용 커밋 등에서 배포를 아끼는 용도. → 품질 게이트(lint/tsc)는 별개로 있어야 한다.

## 1. 배포 아키텍처 실측도 (as-is)

```
git push (feature/* 또는 main)
  → Vercel Git 연동이 감지 (프로젝트 3개: web·app·api 각각 root 지정)
  → 각 프로젝트: ignoreCommand(skip-ci.js) 실행
        [skip ci] 커밋? → 빌드 스킵
        아니면 → bun install → next build → 배포
  → Preview URL(비-main) 또는 Production(main) 배포
  → apps/api: Vercel Cron이 매일 01:00 keep-alive 호출(Neon 보온)
```

- **함수 타임아웃 실측**(`apps/web/vercel.json`): `api/audit/route.ts`·`api/audit/[jobId]/crew/route.ts` = **maxDuration 300초**, `[jobId]/route.ts` = 30초.
- **★발견 D16-4 — 타임아웃 불일치가 stuck의 물리적 원인**: crew-runner의 `CREW_TIMEOUT_MS`(Day13/15 반영분)가 **12분(720초)**인데 함수 상한은 **300초**다. 즉 crew가 720초까지 못 간다 — 함수가 300초에 먼저 강제 종료된다. `after()` 백그라운드 작업이 이렇게 끊기면 crewStatus는 "processing"으로 굳는다. **crew-runner 내부 타임아웃 가드만으로는 stuck을 못 막는다**는 게 실측으로 확인됐다. → 사용자 조회에 비의존하는 **cron 스윕이 2차 안전망으로 반드시 필요**(Day14 P0 정당성 재확인).

## 2. Day16 판단 — 무엇을 할 것인가

### (A) GitHub Actions 최소 CI 게이트 — 신규 도입 "제안"(🟡 미확정)
`.github/workflows/ci.yml`: PR·push 시 `bun install → turbo lint typecheck`(빌드는 Vercel이 하므로 중복 배제). 목적 = 배포 전에 lint/tsc 실패를 당김.
- **왜 미확정**: Vercel이 이미 빌드 실패를 잡는다. Actions 게이트는 "더 빨리·PR에서" 잡는 개선이지 결함 수정이 아니다. 1인 개발·feature 브랜치 직접 배포 현황에선 과投資일 수 있음. → 팀 규모/기여자 늘면 도입. **지금은 설계만.**

### (B) stuck 스윕 cron — 실코드 반영 최우선 후보(⬜, 저위험·스키마 무변경)
Day13(crew stuck) + Day14(cron 승격) P0 통합. keep-alive 인증 패턴 재사용. 상세 명세 = A-16-O2.
- **왜 이게 우선**: (A)는 개발 편의(가설), (B)는 핵심 가치(AI 액션)를 죽이는 실재 결함의 2차 안전망(D16-4로 물리적 필요성 확인). 저위험·스키마 무변경. **단, 라이브 서비스라 실코드 반영은 사용자 확인 후(§7.3).**

### (C) 배포 롤백·프리뷰 운영 규칙 — 문서화(저위험)
Vercel 대시보드 Instant Rollback·Preview URL·Production 승격 흐름을 런북에 정리(Day18 보안/런북 연계). 신규 코드 아님.

## 3. 확신도별 반영 계획

| 항목 | 확신도 | 조치 | 위치 |
|------|--------|------|------|
| D16-1 CI 위임 구조 문서화 | 확인사실 | 이 문서 | docs |
| D16-4 타임아웃 불일치 | 확인사실 | 백로그 갱신(crew stuck 물리원인 확정) | 실행백로그 |
| (B) stuck 스윕 cron | 저위험·미반영 | 명세확정(A-16-O2), 실코드는 확인 후 | apps/api(보류) |
| (A) GitHub Actions 게이트 | 🟡 고위험판단 | 제안 병기, 미도입 | 실행백로그 |
| (C) 롤백 런북 | 저위험 | Day18 연계 초안 | docs |

## 4. [확인필요]
- Vercel 플랜별 cron 개수·최소 주기 제한(Hobby=하루1회 제약 여부) — stuck 스윕을 15분 주기로 돌리려면 Pro 필요할 수 있음. **A-16-O2에서 주기 대안 설계.**
- crew route 함수 300초 vs crew-runner 720초 타임아웃 — 어느 쪽을 맞출지(함수를 늘리나 CREW_TIMEOUT을 줄이나)는 별도 판단(Day17 연계).
- Vercel 프로젝트 3개(web·app·api)의 Production 브랜치가 각각 무엇인지(현재 feature/login-branding-2026-07 작업 중, main 아님).
