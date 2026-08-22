# A-12-O2 — 벡터 검색 org 스코핑 명세 + 오류 설계 + 검증 케이스

> Findable · Day12 · 2026-07-21 · Track A
> A-11-O3 scoped.ts 패턴을 pgvector 검색으로 확장. 교재의 "임베딩 테이블에도 auth.uid() 제한" = Findable에선 **문서·청크·임베딩 3테이블 모두 앱레벨 org 스코핑**(raw 포함).
> 명세 확정. 실코드/스키마/실행은 §7.3 고위험(라이브) 보류.

---

## 1. 스코핑 계층 (3층 방어)

| 층 | 대상 | 강제 방법 | 자동주입? |
|---|---|---|---|
| L1 | 문서 목록·삭제 (`Document`) | `where:{ organizationId }` (Prisma) | Extension 시 O (BL-Day11-03, 🟡) |
| L2 | 청크 조회 (`DocumentChunk`) | `where:{ organizationId }` (Prisma) | O |
| L3 | **벡터 검색 (`Embedding`, raw SQL)** | **`WHERE "organizationId" = $orgId` 손 주입** | **X — 최대 위험** |

> L3가 이 Day의 핵심. L1·L2는 Prisma라 Day11 패턴 그대로지만, L3는 `$queryRaw`라 자동주입이 안 걸려 **사람이 빼먹으면 그대로 유출**.

## 2. 함수 명세 (설계 확정, 미구현)

### 2.1 `scopedVectorSearch(orgId, queryEmbedding, k)`
- **입력**: `orgId`(requireOrg에서), `queryEmbedding`(number[], 질의 임베딩), `k`(Top-K, 기본 5)
- **출력**: `{ id, content, score }[]` — score = 코사인 유사도(1 - 거리)
- **불변식(반드시)**:
  1. `WHERE e."organizationId" = ${orgId}` 항상 포함 — 누락 시 타 org 유출
  2. `queryEmbedding` 차원 = `Embedding.vector(N)` 차원 일치 (D12-1 모델 확정 종속)
  3. 파라미터 바인딩(`${}`)만 사용 — 문자열 결합 금지(SQL 인젝션)
  4. `orgId`는 신뢰 경로(requireOrg)에서만 — 클라이언트 입력을 orgId로 절대 안 씀

### 2.2 `indexDocument(orgId, doc)` (인덱싱)
- 문서 → 청킹 → `models.embeddings` 호출(★F3 첫 실제 호출) → Embedding 저장
- **쓰기 시 org 주입(WITH CHECK 등가)**: 저장 레코드의 `organizationId`는 **서버가 requireOrg의 orgId로 세팅** — 클라이언트가 준 값 신뢰 안 함

## 3. 오류 설계 (Day10 6유형 패턴 계승 → RAG 맥락)

| 코드 | 상황 | 처리 | 비고 |
|---|---|---|---|
| **AUTH-401** | 미로그인 검색 시도 | requireOrg에서 차단 | Day11 계승 |
| **AUTH-403** | orgId 불일치(다른 org 문서 접근 시도) | 빈 결과(404 아님) — 존재 노출 금지 | 벡터 검색은 애초 org 필터로 안 나옴 |
| **RAG-404** | 해당 org에 인덱싱된 문서 0건 | 빈 배열 + "문서 없음" 안내 | 크래시 금지 |
| **RAG-422** | queryEmbedding 차원 불일치 | 400 + 명시 메시지 | D12-1 모델 확정 안 되면 발생 |
| **RAG-424** | 임베딩 API 실패(렛서/OpenAI 다운·rate limit) | 재시도 후 폴백, 부분 실패 로깅 | 외부 의존, observability |
| **RAG-500** | pgvector 확장 미설치·쿼리 오류 | 500 + 런북 링크 | F6 [확인필요] 미해결 시 |

> **핵심 안전장치**: AUTH-403을 "빈 결과"로 처리 = **타 org 문서의 존재 자체를 노출하지 않음**. 목록 API의 404와 다르게, 벡터 검색은 org 필터로 애초에 후보에서 빠지므로 "없는 것과 구분 불가"가 오히려 올바름.

## 4. 검증 케이스 (org-A/B, ⚠️ 미실행 — 명세만)

> Day11 account_ab_test 패턴. Clerk 테스트 org 2개(org-A·org-B) 전제. **아래는 기대 결과 명세이며 아직 실행하지 않음**(정직 표기, 교재 규칙).

| # | 시나리오 | 기대 결과 | 실행 |
|---|---|---|---|
| V1 | org-A 로그인 → org-A 문서로 검색 | org-A 청크만 Top-K 반환 | ⬜ 미실행 |
| V2 | org-A 로그인 → org-B에만 있는 내용 검색 | **빈 배열**(org-B 청크 절대 안 섞임) | ⬜ 미실행 |
| V3 | org-A·org-B 동일 문장 인덱싱 → org-A 검색 | org-A 것만(중복 아닌 격리 확인) | ⬜ 미실행 |
| V4 | **WHERE org 필터 의도적 제거 후 V2** | (회귀 테스트) org-B 섞여 나옴 = 유출 재현 → 필터의 필요성 입증 | ⬜ 미실행 |
| V5 | 미로그인 검색 | AUTH-401 | ⬜ 미실행 |
| V6 | 차원 틀린 queryEmbedding | RAG-422 | ⬜ 미실행 |
| V7 | 문서 0건 org 검색 | RAG-404 빈 배열(크래시 X) | ⬜ 미실행 |

> V4가 이 명세의 **증명 케이스**: 필터를 빼면 실제로 유출이 재현돼야 "org 필터가 유일 방어선"이 사실로 확정된다. 실행은 Clerk 테스트 org + Neon pgvector 준비 후.

## 5. crew 주입 시 org 경계 (Day13 예고)

- `scopedVectorSearch` 결과를 crew 4에이전트(민지·Alex·수진·준호) instructions 컨텍스트로 주입 시:
  - 주입 직전 **한 번 더 orgId 확인** — 검색과 주입 사이 org 전환 방지
  - crew 프롬프트에 들어간 청크는 **전부 동일 orgId**여야 함(혼입 시 답변 유출)
- 이건 Day13 자기개선 루프의 전제 = Day12 스코핑이 Day13의 안전 토대.

## 6. 점검표 (Day12 마감)

- [x] 3층 스코핑 계층 정의(L1·L2·L3)
- [x] L3 raw SQL 손 주입 = 최대 위험 명시
- [x] 오류 6유형(AUTH-401/403·RAG-404/422/424/500)
- [x] 검증 7케이스 명세(전부 미실행 정직 표기)
- [x] 쓰기 시 서버 org 주입(WITH CHECK 등가)
- [ ] 실행: Clerk 테스트 org + Neon pgvector (별도 세션, 실환경)
