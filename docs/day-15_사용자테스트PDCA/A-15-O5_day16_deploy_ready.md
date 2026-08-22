# A-15-O5 · Day16 배포 준비 점검 (day16_deploy_ready)

> 2026-07-24 · Day15 단계6 · 4주차(자동 배포) 진입 전 안정성 점검
> 원칙: 환경변수는 **이름만** 기록(값·토큰 절대 금지). 직접 확인 못 한 항목은 **미실행**으로 정직 표기(교재 "안 해본 항목은 지어내지 마").

---

## 1. 4영역 + Vercel 안정성 점검 결과

| 영역 | 점검 방법 | 통과 여부 | 메모 (실측 근거) |
|------|-----------|-----------|------------------|
| **Auth** | 일반 창 + 시크릿 창 로그인·로그아웃 세션 독립 유지 | **미실행 (코드 준비 확인)** | Clerk 완비: `apps/app/proxy.ts`(Clerk Core 3 `clerkMiddleware` 방식), `packages/auth`(server·client·provider). 브라우저 2창 실테스트는 미실행 → Day16 전 수행 필요 |
| **RLS** | 계정 A로 로그인 상태에서 계정 B 데이터 접근 차단 | **미실행 (설계 확정)** | DB-level RLS 불가(`relationMode="prisma"`) → **앱레벨 `where:{organizationId}` 스코핑**이 유일 격리선(Day11). ⚠️Tracking은 org키 없이 brandId만 → brand 경유 필터 필수(Day11/12 최대 위험). org-A/B 교차 실행 검증 미실행(실행백로그 P1) |
| **관리자 콘솔** | 일반 계정으로 `/admin`(studio) 접근 차단 | **해당 없음 (미구현)** | `apps/studio` = 빈 껍데기(tsx 0개, Day14 D14-2). 콘솔 자체가 없어 접근 통제 대상 없음. ⚠️구현 시 org 스코핑 아닌 **admin 역할 게이트**(크로스-org 정당하되 admin만) |
| **RAG** | 질문 10개 vs 기대 근거 문서, 민감정보 노출 없음 | **해당 없음 (미구현)** | Document/DocumentChunk/Embedding 모델 없음(Day12 D12-3). RAG 미구현이라 점검 대상 없음. 구현 시 벡터검색 raw SQL org 필터 손주입 필수(Day12 최대 위험) |
| **Vercel 준비** | 환경변수 이름 목록·배포 연결 상태 | **통과 (연결 정상)** | 배포 라이브(www.findable.co.kr 200). 환경변수 이름 목록 §2. 값은 미기록 |

---

## 2. 환경변수 이름 목록 (값 절대 미기록)

> `apps/web/.env.local` 기준. **이름만** — 값·토큰·키는 문서에 적지 않음.

- 인증: `CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- DB(Neon): `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `NEON_PROJECT_ID`, `PGHOST`, `PGHOST_UNPOOLED`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`, `POSTGRES_*`(URL/HOST/USER/PASSWORD/DATABASE/PRISMA_URL/NON_POOLING/NO_SSL)
- AI: `AI_GATEWAY_API_KEY`, `LETSUR_API_KEY`, `LETSUR_BASE_URL`, `CLOVA_STUDIO_API_KEY`, `REPLICATE_API_TOKEN`
- 한국 채널: `KAKAO_REST_API_KEY`, `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET`
- 결제(PortOne): `NEXT_PUBLIC_PORTONE_CHANNEL_KEY`, `NEXT_PUBLIC_PORTONE_STORE_ID`, `PORTONE_API_SECRET`
- 메일: `RESEND_TOKEN`, `RESEND_FROM`
- 스토리지/기타: `BLOB_READ_WRITE_TOKEN`, `VERCEL_OIDC_TOKEN`, `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_WEB_URL`

> ⚠️ Day16 자동 배포 시 위 이름들이 Vercel 프로젝트 환경변수(Production)에 모두 등록됐는지 이름 대조 필요. `NEXT_PUBLIC_` 접두사는 공개용에만(비밀키 금지, CLAUDE.md §3).

---

## 3. 오늘 commit(A-15-O4) 배포 안전성

- 변경 = `apps/web/app/api/audit/[jobId]/crew/route.ts` + `crew-runner.ts`, crew stuck 방지. **스키마·저장 흐름 무변경** → 배포 후 롤백 필요성 낮음.
- web tsc 0 / biome 통과 → 빌드 게이트 통과 예상.
- ⚠️ 자동 배포 켜기 전 위 Auth·RLS 실런타임 점검(미실행분)을 먼저 완료 권장 — "점검 후 commit이 원칙"(교재).

---

## ✅ 완료 기준 자기 점검
- [x] 4영역(Auth·RLS·콘솔·RAG) + Vercel 통과 여부
- [x] 환경변수 **이름만** 기록 (값 미기록)
- [x] 배포 연결 상태(라이브 200)
- [x] 미실행·미구현 정직 표기 (지어내지 않음)
