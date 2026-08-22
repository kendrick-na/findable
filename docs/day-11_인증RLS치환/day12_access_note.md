# A-11-O3 — Day12 RAG 검색 결과 org 분리 노트

> Findable · Day11 단계6 · 2026-07-19 · Track A
> 오늘 확정한 앱레벨 org 스코핑 패턴을 Day12(RAG·임베딩)에 그대로 잇는 준비 노트.

## 왜 검색 결과도 org별로 분리해야 하나

- **임베딩·벡터 검색도 결국 DB 조회.** Day12에서 문서를 벡터로 저장하고 유사도 검색(pgvector `<=>`)을 하는데, 이 쿼리에 org 필터가 없으면 **다른 조직의 문서가 검색 결과에 섞인다.**
- Findable에 RLS가 없다는 사실이 Day12에서 더 위험해진다: 일반 목록은 `where:{organizationId}`를 빼먹어도 "빈 목록"으로 티가 나지만, **벡터 검색은 "유사한 남의 문서"를 그럴듯하게 섞어 반환**해 유출을 눈치채기 어렵다.
- 특히 RAG를 **AI 답변 생성의 컨텍스트**로 쓰면(Findable의 GEO 진단 근거), 남의 org 문서가 컨텍스트에 들어가 **AI 답변에 타 조직 정보가 인용**되는 최악의 유출.

## 문서 소유자 컬럼 후보 (오늘 RLS 패턴과 동일)

오늘 확인한 대로 org 키 보유 모델은 Brand·Report·User뿐. Day12 문서/임베딩 테이블은 **처음부터 `organizationId`를 직접** 넣는다(Tracking처럼 경유 강제하면 벡터 검색 조인이 복잡·느림):

| 신규 테이블(Day12) | 소유자 컬럼 | 이유 |
|---|---|---|
| `Document` (원문/청크) | **`organizationId` 직접** | 벡터 검색 `where`에 바로 붙임 |
| `Embedding` (벡터) | **`organizationId` 직접** + `documentId` | 조인 없이 org 필터 → 성능 |

> Tracking의 교훈(org 키 없어 brand 경유 강제 = 복잡·위험)을 반복하지 않는다. **임베딩 테이블엔 org 키를 직접.**

## RLS 정책 후보 = 앱레벨 스코핑 (오늘 패턴 재사용)

```ts
// Day12 벡터 검색 — org 스코핑 필수 (오늘 scoped.ts 패턴 계승)
async function scopedVectorSearch(orgId: string, queryEmbedding: number[]) {
  return database.$queryRaw`
    SELECT id, content, 1 - (embedding <=> ${queryEmbedding}::vector) AS score
    FROM "Embedding"
    WHERE "organizationId" = ${orgId}        -- ★ org 필터를 raw SQL에도 반드시
    ORDER BY embedding <=> ${queryEmbedding}::vector
    LIMIT 5
  `
}
```

- ⚠️ **raw SQL 주의**: pgvector는 `$queryRaw`를 쓰게 되는데, 이때 Prisma의 where 자동주입(BL-Day11-03 Extension)이 **안 걸린다.** raw 쿼리엔 `WHERE organizationId` 를 사람이 직접 반드시 넣어야 함 → Day12 최대 위험 지점으로 등록.
- 교재의 "문서 SELECT를 auth.uid()로 제한 + 임베딩 테이블에도 동일 적용" = Findable에선 **문서·임베딩 두 테이블 모두 `where:{organizationId}`**(raw 포함).

## Day12 준비물 체크리스트

- [ ] 로그인 사용자 org 컨텍스트 = 오늘 만든 `requireOrg()` (userId·orgId)
- [ ] org 스코핑 적용 테이블 = 신규 `Document`·`Embedding`(organizationId 직접)
- [ ] 도메인 문서 10~30개 = Findable 브랜드/경쟁사 GEO 진단 근거 문서 (더미 org로)
- [ ] 임베딩 키 = **렛서 게이트웨이 `text-embedding-3-large`**(Day03 확보, OpenAI 직접 발급 불필요) — 서버 전용
- [ ] pgvector 확장 = Neon에서 `CREATE EXTENSION vector` [확인필요]
- [ ] 캡처 안전 기준 = 임베딩 키·DATABASE_URL·실 고객 문서 노출 금지, 더미 org만

## Day11 → Day12 한 줄 연결

**"내 데이터가 내게만 보인다"(org 스코핑)를 목록 조회에서 확정했으니, Day12는 그 경계를 벡터 검색까지 확장한다** — 단, raw SQL이라 자동주입이 안 걸리므로 org 필터를 손으로 반드시 넣는다.
