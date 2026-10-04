# W1 무료진단 가이드 — 로컬 DB·브라우저 검증

기준: RELEASE `cdb34fb`의 별도 detached worktree. 이 절차는 일회용 로컬 PostgreSQL과 가짜 무료 링크 Job만 사용한다. Preview/운영 DB, 고객 데이터, 실제 메일·결제·AI 제공자는 사용하지 않는다.

## 재현 입력

- 빈 PostgreSQL을 로컬 loopback에서 만들고 `packages/database`의 현재 Prisma schema를 `prisma db push`로 적용한다. 운영 migration 검증이 아니다.
- `apps/web/__tests__/fixtures/w1-route-hydration.sql`을 `psql -v ON_ERROR_STOP=1 -f`로 넣는다. 고정 Job ID는 `00000000-0000-4000-8000-000000000041`, 가짜 주소는 `example.invalid`다. SQL은 이 ID에만 upsert한다.
- `DATABASE_URL`과 `DATABASE_URL_UNPOOLED`을 **그 로컬 DB에만** 연결하고, `NEXT_PUBLIC_APP_URL`/`NEXT_PUBLIC_WEB_URL`을 로컬 주소로 설정한 `apps/web` Next dev server를 띄운다. `localhost` 호스트로 접속한다. 환경변수 누락 상태에서 서버가 시작된 것처럼 보여도 `next.config.ts` 로딩에 실패할 수 있으므로 실제 HTTP 응답을 확인한다.

## 실제로 확인한 경로 — 2026-10-04

1. `GET /ko/audit/<고정 ID>`가 200이고, `GET /api/audit/<고정 ID>`가 `completed`, action 2건을 반환했다.
2. Chrome 실제 페이지에서 client hydration 후 `질문 10개`, 신규 카드 `네이버 검색에 잡힐 글을 올리세요`, `수정 위치`, `검증 방법`, `적용 채널: 네이버 검색 노출`, 근거 등급 및 `효과를 입증하지 않습니다`를 확인했다.
3. 저장된 구 카드 `네이버 블로그에 꾸준히 글을 올리세요`를 펼치면 원본 fixture의 `네이버 AI 브리핑·HyperCLOVA X 답변` 검증 문구가 보이지 않고, `같은 질문에 네이버 검색 노출이 있었는지 확인` 및 `AI 답변 변화는 보조 관찰`로 표시됐다.
4. `/en/audit/<고정 ID>`에서도 `Measurement channels`, `Naver search exposure`, `How to verify`, `Evidence: weak`, `do not prove an effect` 및 같은 구 카드 보정을 확인했다. 제목/실행 설명처럼 DB에 저장된 한국어 텍스트 자체는 번역되지 않는다.

## 증거 경계

이는 **일회용 로컬 DB의 무료 공개 링크 route→API→실제 브라우저 hydration** 검증이다. 첫 SQL fixture는 사람이 만든 카드 2개이며, 지표는 ChatGPT 10/10 확인인데 네이버 카드 2개가 들어 있어 **제품 생성기에서는 나올 수 없는 조합**이다. 따라서 첫 브라우저 검증은 표시 경로만 증명한다. 저장 구 카드도 실제 AG-1 생성기의 `게시·색인 확인: … 재측정: …` 형태가 아니다. 생성기→저장→화면, 과거 실제 형태의 표시 투영을 증명했다고 읽지 않는다.

## 후속 생성기→DB→공개 API 검증 — 2026-10-04

`packages/database/scripts/seed-w1-generated-action-e2e.ts`는 명시적 `FINDABLE_W1_E2E_SEED_CONFIRM=local-disposable`과 loopback·`findable_w1_` DB 이름을 강제한다. 빈 일회용 PG에 Prisma schema를 적용한 뒤 이 스크립트를 실행하면 가짜 AI 판정 10건(확인 2·부재 8), 네이버 검색 10건(노출 0)을 같은 결과에 넣고 실제 `summarizeVerdicts`→`buildGeoActions`→JSON 저장 경로를 실행한다. 고정 Job ID는 `00000000-0000-4000-8000-000000000042`다. 6개 생성 카드 중 `naver_blog`가 포함됐고 `GET /api/audit/<ID>`는 200/`completed`, AI 판정 10건·검색 판정 10건과 6개 카드 반환을 확인했다. HTML GET도 200이었다.

이 후속 시나리오의 **Chrome hydration 검증은 아직 아니다**. 앱 브라우저 제어가 두 차례 시간 초과돼 DOM/카드 펼침을 확인하지 못했다. API의 저장·표시 필터와 실제 브라우저 렌더를 같은 증거로 합치지 않는다. 또한 실제 AI·네이버 제공자 호출, 고객 데이터, 인과 효과·구매·반복 사용이 아니다. 인증 조직 route, Preview/운영 schema·환경, 과거 고객 Job/Report/PDF, 실효과 영수증은 별도 게이트다. 링크 발송·고객 연락은 하지 않았다.

이번 수정에서 네이버 검색 응답이 **하나도 성공하지 않은** 회차에도 AI 인지 저하만으로 네이버 카드가 생기는 문제를 RED 테스트로 확인했다. 이제 runner가 성공 검색 여부를 전달하고, 검색 기준선이 없으면 카드가 먼저 기준선 수집을 안내한다. 이는 가이드의 비교 가능성 수정이지 SEO/GEO 효과 입증이 아니다.

Claude Code의 `6ff082f` 재반박에서 기본값 누락·일부 검색 성공·seed의 하드코딩을 추가로 확인했다. 후속 후보는 runner와 seed가 같은 `hasCompleteNaverSearchBaseline` 함수를 사용하며, 네이버 브랜드 질문의 검색 응답이 **모두 성공**할 때만 전체 기준선을 인정한다. 값 누락·전체 실패·부분 성공은 성공/실패 증감 판단 대신 먼저 동일 질문 전체의 기준선을 확보하라고 표시한다. seed 검색 행에는 실제 현재 adapter의 `naverSource: search_results`와 한국어 질의를 넣었다. 이는 단위 함수·seed 재실행의 증거이며, 유료/실제 제공자 측정이나 runner 전체 실행·새 브라우저 hydration까지 증명하지는 않는다. 기존 저장 카드의 소급 보정·과거 PDF도 미해결 범위다.
