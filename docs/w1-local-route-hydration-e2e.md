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

Claude Code의 `0b76eb1` 재반박은 fail-open 폐쇄를 인정했으나, 값 누락을 실제 미측정으로 단정하는 문구와 한영 혼합 질문 세트의 범위 오해를 추가 P2로 분리했다. 후속 문구는 `undefined`를 **기준선 상태를 확인하지 못함**으로, `false`를 **미측정 또는 일부 한국어 질문만 성공**으로 구별하고, 재측정 대상을 한국어 질문으로 명시한다. 네이버 검색 adapter가 blog→news→webkr 순서로 합친 뒤 상위 10개를 자르면 블로그 결과가 다른 채널을 밀어낼 수 있다는 별도 측정 편향, 기존 저장 카드의 소급 문구, runner 전체 실행·브라우저 hydration은 여전히 열린 검증 항목이다.

후속 로컬 반례: 실제 예정된 한국어 브랜드 질문이 2개인데 네이버 응답이 성공 1개만 저장된 경우, 이전 `hasCompleteNaverSearchBaseline`은 도착한 행만 검사해 전체 기준선으로 잘못 인정했다. 이제 runner가 예정 한국어 브랜드 질문 수를 전달하고 실제 네이버 행 수와 같으면서 모두 성공해야 완전 기준선으로 본다. 단위 테스트에서 해당 누락 반례 RED→GREEN, 전체 audit 139건·audit/database 타입 검사·Biome PASS. 개수 일치만으로 질문별 중복/누락의 상쇄까지 증명하지는 않으므로 프롬프트별 귀속·실제 runner 중단 복구 E2E는 W0-3과 함께 후속 검증한다.

추가 후보: 네이버 adapter는 블로그·뉴스·웹문서를 각각 최대 10개 읽지만, 이전에는 블로그 10개가 있으면 뒤 뉴스/웹문서가 전부 잘렸다. 실제 가짜 API 3채널×10건 테스트에서 블로그만 인용되는 RED를 확인하고, 각 채널의 내부 순위를 유지한 라운드로빈 상위 10개(4/3/3)로 GREEN 처리했다. `packages/ai` 전체 47건 및 audit 타입 검사·Biome PASS. `packages/ai` 자체 타입 검사는 이번 변경과 무관한 기존 `ai` 패키지의 `Message`/`ai/react` export 오류 두 건으로 실패했다. 이 변경은 검색 노출의 표본 정의를 바꾸므로 과거 회차와 무조건 직접 비교하면 안 된다. **RELEASE/고객 노출 전** 측정 버전·기존 리포트 호환성·효과 영수증 비교 정책을 정해야 하며 실제 네이버 API/고객 효과는 검증하지 않았다.

Claude Code의 정확 `8612f51` 재반박은 새 P0/P1은 없지만, 질문 A 응답 누락과 질문 B 응답 중복이 같은 개수로 상쇄될 수 있다고 지적했다. 실제 helper 테스트에서 RED를 재현했고, 이제 예정된 한국어 브랜드 질문의 `promptIndex` 집합과 도착한 네이버 행의 `promptIndex` 집합·중복 여부·오류 여부를 모두 확인한다. `runner`는 원본 응답 배열과 태그의 인덱스 정렬을 이용해 질문 ID를 전달한다. 전체 audit 139건, audit/database 타입 검사·Biome PASS. 이 순수 함수 결과가 실제 runner 전체 실행/중단 복구에도 같은 결과로 저장되는지의 통합 검증은 아직 없다. 표본 버전/채널별 개수·기존 저장 카드 소급도 별도 게이트다.
