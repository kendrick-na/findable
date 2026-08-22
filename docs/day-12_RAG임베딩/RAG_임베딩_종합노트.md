# Day12 종합 노트 — RAG 기본 + 문서 임베딩 (Findable)

> 2026-07-21 · Track A · 산출물 A-12-O1(설계) · A-12-O2(스코핑 명세) · A-12-O3(이 노트, Day13 입력)
> 방식: 블라인드 재검증. 코드 반영 경계: 설계·명세 확정 / 실코드·스키마 §7.3 고위험 보류.

## 오늘 한 것
Day11에서 확립한 **앱레벨 org 스코핑**을 **벡터 검색까지 확장**하는 RAG 슬라이스를 설계하고, 그 과정에서 **노트·Day03 계획과 실제 코드가 어긋나는 3건**을 실측으로 발견했다. "RAG 신규 도입"이 아니라 **"이미 정의만 된 임베딩 모델을 처음 실제 호출하는 슬라이스"**로 범위를 재정의.

## ★ 핵심 발견 3건 (블라인드 재검증)

1. **D12-1 모델 불일치**: 코드 = `text-embedding-3-**small**`(1536), 노트/Day03 = `**large**`(3072). 벡터 차원이 달라 **모델 확정이 스키마 게이트**. → large 채택 제안(한국어 GEO 근거 문서 유리), 실코드 미변경.
2. **D12-2 키 경로 불일치**: 코드 = `OPENAI_API_KEY` 직접, Day03 결론 = "렛서로 통일". RAG 켜면 OpenAI 직접 과금. 렛서 baseURL 치환 가능(호환) → 백로그.
3. **D12-3 반쪽 잇기**: `models.embeddings` 정의는 있으나 **사용처 0**. 없는 건 저장소·인덱싱·검색·주입. 오늘 작업 = 이 반쪽 설계.

## 실측 팩트 (근거)
- `models.embeddings` 이미 정의(models.ts) · 사용처 grep 0건
- `Document`·`Embedding` 모델 없음 · pgvector 코드 흔적 없음
- org 키 = 여전히 3/9모델(Brand·Report·User)뿐 → 신규 3테이블은 org 키 **직접**
- RAG 소비처 = crew 4에이전트(민지·Alex·수진·준호), 지식 하드코딩 → Day13에서 검색결과 주입
- [확인필요]: Neon `CREATE EXTENSION vector` 여부

## 스코핑 3층 (A-12-O2)
- L1 문서목록 / L2 청크 = Prisma `where:{organizationId}`
- **L3 벡터검색 = raw SQL → 자동주입 안 걸림 → `WHERE organizationId` 손 주입(최대 위험)**
- 증명 케이스 V4: 필터 빼면 유출 재현돼야 = 필터가 유일 방어선 확정

## 실행백로그 등록 (docs/_적용/실행백로그.md)
- BL-Day12-01 [P0] Document/DocumentChunk/Embedding 테이블 설계(org키 직접, vector차원=모델확정 후) — 🟡 보류(라이브 스키마, D12-1 게이트)
- BL-Day12-02 [P0] `scopedVectorSearch` raw SQL org 필터 헬퍼 — ⬜(저위험 신규, pgvector 준비 후)
- BL-Day12-03 [P1] 임베딩 모델 small→large 확정 + 렛서 baseURL 치환 — 🟡 보류(비용·차원 결정)
- BL-Day12-04 [P1] `indexDocument` 인덱싱 파이프라인(models.embeddings 첫 호출) — ⬜
- BL-Day12-05 [P0] Neon pgvector 확장 설치 확인 — ⬜ [확인필요]
- BL-Day12-06 [P1] org-A/B 검증 7케이스 실행(V4 유출재현 포함) — ⬜(Clerk 테스트 org)

## Day13 연결
Day13(Mastra crew 자기개선)이 `scopedVectorSearch` 결과를 컨텍스트로 소비. **Day12 org 스코핑이 뚫리면 Day13 AI 답변에 타 org 정보 인용** = 최악 유출. 주입 직전 orgId 재확인 + 청크 전부 동일 org 강제(A-12-O2 §5).

## 제출 (대시보드)
- A-12-O1 rag_embedding_design.md
- A-12-O2 vector_search_scoping_spec.md
- A-12-O3 RAG_임베딩_종합노트.md
- ⚠️ 파일명 영문(ASCII)로 복사 후 업로드
