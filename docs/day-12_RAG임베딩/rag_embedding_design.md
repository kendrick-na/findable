# A-12-O1 — RAG 기본 + 문서 임베딩 설계 (Findable 치환)

> Findable · Day12 · 2026-07-21 · Track A(바이브코딩 고급)
> 커리큘럼: "RAG 기본 + 문서 임베딩". 입력 = A-11-O3(day12_access_note.md).
> 방식: 블라인드 재검증(§7.2) — 팩트 먼저 실측 → 독립 도출 → 노트/커리큘럼 결론과 대조 = 발견.
> 코드 반영 경계: 설계·명세 확정. 실코드/스키마 변경은 §7.3 확신도별 차등(라이브 서비스 = 고위험 보류).

---

## 0. 한 줄 요약

Findable은 **임베딩 모델을 이미 코드에 정의**(`models.embeddings`)해 뒀지만 **한 번도 안 쓰고 있다.** Day12는 "RAG를 새로 도입"이 아니라 **이미 있는 반쪽(모델 정의)에 나머지 반쪽(저장·검색·주입)을 잇는 설계** + **A-11-O3에서 확정한 org 스코핑을 벡터 검색까지 확장**하는 것이다. 단, 그 과정에서 노트·Day03 계획과 **실제 코드가 어긋나는 3건**을 발견했다.

---

## 1. 블라인드 재검증 — 팩트 실측 (2026-07-21)

노트(A-11-O3)의 결론을 잠시 덮고, 실제 코드에서 팩트만 수집했다.

| # | 실측 대상 | 결과 | 표기 |
|---|---|---|---|
| F1 | `packages/ai/lib/models.ts` | `embeddings: openai("text-embedding-3-small")` **이미 정의됨** | [확인사실] |
| F2 | `packages/ai/keys.ts` | 임베딩 키 = `OPENAI_API_KEY`(sk- 직접). `LETSUR_*` 흔적 코드에 **없음** | [확인사실] |
| F3 | `models.embeddings` 사용처 grep | **0건** — 정의만 되고 아무도 안 씀 = RAG 미구현 | [확인사실] |
| F4 | `Document`·`Embedding` 모델 (schema.prisma) | **없음**. pgvector 흔적도 코드에 없음 | [확인사실] |
| F5 | RAG 컨텍스트 소비처 | `packages/ai/lib/crew`(민지·Alex·수진·준호 4에이전트). 지식은 instructions **하드코딩**뿐 | [확인사실] |
| F6 | Neon pgvector 확장 | Neon 콘솔에서 `CREATE EXTENSION vector` 여부 코드로 확인 불가 | [확인필요] |

## 2. 노트/커리큘럼 결론과 대조 → 발견 3건

### 🔍 발견 D12-1 — 임베딩 모델 불일치 (small vs large)
- **노트/Day03 계획**: 렛서 게이트웨이 `text-embedding-3-**large**` 사용(Day03 확보).
- **실제 코드(F1)**: `text-embedding-3-**small**`.
- **의미**: large(3072차원)와 small(1536차원)은 **벡터 차원이 다르다.** Embedding 테이블의 `vector(N)` 컬럼 차원은 모델 선택에 **종속** → 스키마 설계 전에 모델을 먼저 확정해야 한다. 지금 코드대로 small이면 `vector(1536)`, large면 `vector(3072)`.
- **판단**: 저위험 아님(스키마 차원 결정). 아래 §5에서 large로 통일 **제안**(GEO 근거 문서는 한국어 뉘앙스가 많아 large가 유리)하되, **모델 확정 = 명세 게이트**로 등록. 실코드는 안 건드림.

### 🔍 발견 D12-2 — 임베딩 키 경로 불일치 (OpenAI 직접 vs 렛서)
- **Day03 결론**: "렛서가 대체 → OpenAI/Anthropic 직접 발급 불필요."
- **실제 코드(F2)**: 임베딩은 `OPENAI_API_KEY`로 **OpenAI 직접** 호출.
- **의미**: RAG를 실제로 켜는 순간 임베딩 비용이 **OpenAI 직접 과금**으로 나간다(렛서 월100유닛 무료 밖). Day03이 세운 "렛서로 통일" 원칙과 코드가 아직 안 맞음.
- **판단**: 렛서는 OpenAI 호환(baseURL만 교체)이므로 `createOpenAI({ baseURL: LETSUR_BASE_URL, apiKey: LETSUR_API_KEY })`로 치환 **가능**. 저위험 편에 가깝지만 임베딩이 아직 미사용(F3)이라 급하지 않음 → 백로그 등록, RAG 켤 때 함께.

### 🔍 발견 D12-3 — "RAG 도입"이 아니라 "반쪽 잇기"
- **커리큘럼 프레이밍**: RAG 기본을 새로 배운다.
- **실제(F1·F3)**: 임베딩 모델은 이미 배선돼 있고 **호출만 안 됨.** 없는 건 ①저장소(Document·Embedding 테이블) ②인덱싱 파이프라인 ③검색 함수 ④crew 주입.
- **의미**: 오늘의 실제 작업 단위는 "RAG 학습"이 아니라 **"models.embeddings를 실제로 처음 호출하는 슬라이스 설계"**. 범위가 좁아지고 명확해짐.

---

## 3. 왜 검색 결과도 org별로 분리해야 하나 (A-11-O3 계승)

- 임베딩·벡터 검색도 결국 **DB 조회**. pgvector `<=>` 쿼리에 org 필터가 없으면 **다른 조직 문서가 검색 결과에 섞인다.**
- Findable엔 DB-level RLS가 없다(F4, `relationMode="prisma"`) → **앱레벨 org 스코핑이 유일 격리선**(Day11 확립).
- 일반 목록은 `where` 빼먹으면 "빈 목록"으로 티가 나지만, **벡터 검색은 "유사한 남의 문서"를 그럴듯하게 섞어** 반환해 유출을 눈치채기 어렵다.
- RAG가 **AI 답변 컨텍스트**(crew 4에이전트, F5)로 쓰이면 → 남의 org 문서가 컨텍스트에 들어가 **AI 답변에 타 조직 정보가 인용**되는 최악의 유출.

## 4. Tracking 교훈 재확인 → 신규 테이블은 org 키 직접

Day04·Day11에서 확인: org 키 보유 = **9모델 중 3개(Brand·Report·User)뿐**. Tracking은 org 키가 없어 brand 경유 강제 → 복잡·위험. **Day12 신규 테이블은 이 실수를 반복하지 않는다.**

| 신규 테이블(Day12) | 소유자 컬럼 | 이유 |
|---|---|---|
| `Document` (원문/메타) | **`organizationId` 직접** | 목록·삭제 org 필터 즉시 |
| `DocumentChunk` (청크) | **`organizationId` 직접** + `documentId` | 조인 없이 org 필터 |
| `Embedding` (벡터) | **`organizationId` 직접** + `chunkId` | 벡터 검색 `WHERE`에 바로 붙임(성능) |

> 임베딩 테이블에 org 키를 **직접** 두면 벡터 검색 시 조인 없이 `WHERE "organizationId" = $orgId` 한 줄로 격리 + 인덱스 활용.

## 5. RAG 슬라이스 설계 (설계만, 실코드 X)

```
[문서 등록]  더미 org 문서 10~30개 (Findable GEO 근거)
     ↓ 청킹 (문단/토큰 단위)
[DocumentChunk 저장]  organizationId 직접
     ↓ models.embeddings 호출 (★F3 = 처음 실제 호출)
[Embedding 저장]  vector(N) — N은 모델 차원(D12-1 게이트)
     ↓
[검색]  scopedVectorSearch(orgId, query)  ← §6, org 필터 필수
     ↓ Top-K 청크
[주입]  crew 4에이전트 instructions 컨텍스트로 (F5)
```

- **모델 확정 게이트(D12-1)**: large(3072) 채택 **제안** → `Embedding.vector(3072)`. 확정 전까지 차원 미정 = 스키마 미작성.
- **키 경로(D12-2)**: 켤 때 렛서 baseURL로 치환 검토(백로그).
- **pgvector(F6)**: Neon에서 `CREATE EXTENSION vector` 선행 [확인필요].

## 6. org 스코핑 벡터 검색 (A-11-O3 scoped.ts 패턴 계승)

```ts
// ⚠️ raw SQL — Prisma where 자동주입(Extension) 안 걸림 → org 필터 손으로 필수
async function scopedVectorSearch(orgId: string, queryEmbedding: number[], k = 5) {
  return database.$queryRaw`
    SELECT c.id, c.content,
           1 - (e.embedding <=> ${queryEmbedding}::vector) AS score
    FROM "Embedding" e
    JOIN "DocumentChunk" c ON c.id = e."chunkId"
    WHERE e."organizationId" = ${orgId}        -- ★ 여기 빠지면 타 org 유출
    ORDER BY e.embedding <=> ${queryEmbedding}::vector
    LIMIT ${k}
  `;
}
```

- **최대 위험 지점**: raw SQL이라 Day11 BL-Day11-03(Extension 자동주입)이 **안 걸린다.** `WHERE organizationId`를 사람이 반드시 넣어야 함 → 검증 케이스로 강제(§ A-12-O2).
- Embedding에 org 키 직접(§4)이라 JOIN은 청크 내용 표시용일 뿐 격리는 `e."organizationId"` 단독으로 성립.

## 7. Day12 준비물 체크리스트 (노트 + 실측 반영)

- [ ] org 컨텍스트 = Day11 `requireOrg()`(userId·orgId)
- [ ] 신규 테이블 = `Document`·`DocumentChunk`·`Embedding`(전부 organizationId 직접)
- [ ] **모델 차원 확정**(D12-1) — large(3072) 제안, 확정 후 `vector(N)`
- [ ] **키 경로 확정**(D12-2) — 렛서 baseURL 치환 여부
- [ ] pgvector 확장(F6) — Neon `CREATE EXTENSION vector` [확인필요]
- [ ] 더미 문서 10~30개(실 고객 문서 금지, 더미 org만)
- [ ] 캡처 안전: 임베딩 키·DATABASE_URL·실 문서 노출 금지

## 8. Day11 → Day12 → Day13 한 줄 연결

Day11에서 **"내 데이터가 내게만 보인다"**(org 스코핑)를 목록 조회에서 확정했다. Day12는 그 경계를 **벡터 검색까지 확장**(raw SQL 손 주입) + **이미 정의만 된 임베딩 모델을 처음 실제 호출**한다. Day13(Mastra crew 자기개선)이 이 검색 결과를 **컨텍스트로 소비**한다 — 즉 Day12 org 스코핑이 뚫리면 Day13 AI 답변에 타 org 정보가 인용된다.
