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

이는 **일회용 로컬 DB의 무료 공개 링크 route→API→실제 브라우저 hydration** 검증이다. SQL fixture는 제품 엔진의 실측이 아니며, 가이드 내용의 시장 효과·인과·실제 고객 사용을 증명하지 않는다. 인증 조직 route, Preview/운영 schema·환경, 과거 고객 Job/Report/PDF, 실효과 영수증은 여전히 별도 게이트다. 링크 발송·고객 연락은 하지 않았다.
