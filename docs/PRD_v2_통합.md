# PRD v2 (통합·현황서) — Findable

> **성격**: 이 문서는 "만들 것을 정의하는 예언서(Forward PRD)"가 아니라, **이미 배포된 Findable MVP의 실제 상태 + 여기서 무엇을 개선하는지를 정의하는 현황서(Living / Reverse PRD)**다.
> **작성 기준**: 실제 코드(`schema.prisma` 9모델·라이브 라우트·배포)를 **진실의 원천(Source of Truth)**으로 두고 역설계했다.
> **재료**: 구 `docs/PRD.md`(v1.0, 2026-04~05) + KAIST OverEdge 실습 Day01~11 산출물 + 2026-07-20 코드 실측.
> **작성일**: 2026-07-20 · KAIST OverEdge 베이스캠프 PRD 발표용.
> **표기**: `[확인사실]`=코드/웹 실측 · `[가정]`=검증필요 · `[확인필요]`=근거미확보. (실습 블라인드 재검증 규칙 계승)
> ⚠️ 구버전 `docs/PRD.md`는 삭제하지 않고 히스토리로 보존한다.

---

## 0. 이 PRD가 특별한 이유 (발표 핵심)

일반적인 PRD는 아직 없는 제품을 상상해서 쓴다. **이 PRD는 반대다.**

```
구 PRD(예언서) ─┐
Day01~11 실습  ─┼─→  실제 배포된 Findable 코드  ─→  PRD v2 (검증된 현황서)
코드 실측      ─┘         (= Source of Truth)          "실제로 이렇다 + 여기서 개선한다"
```

- **남들**: PRD(기획서)만 있음 → "만들 예정"
- **Findable**: PRD + **실배포 서비스(www.findable.co.kr)** → "이미 만들었고, 실측으로 문서를 교정한다"
- 실습 발견 중 **저위험**(구조화 데이터 등)은 이미 실제 코드에 반영했고, **방향 결정**(North Star·타깃 순위)은 실고객 검증 전이므로 §8 로드맵에 가설로만 둔다.

---

## 1. Goal

- **Target User** `[확인사실 세그먼트 / 가정 순위]`
  한국 시장을 노리는 브랜드의 **마케팅/그로스 담당자**. 세부 4세그먼트:
  1. 외국 브랜드 한국법인 마케터 (Apple코리아·SK-II·LV 등, ~3,500곳, **경쟁사 한국 고객 0곳**) — 본사가 "한국 AI 가시성"을 KPI로 강제, 강제 수요
  2. 글로벌 K-뷰티 D2C (메디큐브·아누아 등, ~650곳) — 인바운드 접근 용이
  3. 국내 D2C (무신사·올영셀러 등, ~6,500곳)
  4. K-패션/IP 글로벌
  > 🔍 [Day02 재검토 — 미확정] 문제강도는 세그먼트 ①이 최상(경쟁0+본사 KPI)이나, **판매 용이성은 ②가 우위**. 세일즈 1순위는 실영업 데이터로 확정. 문제강도 ≠ 판매 용이성.

- **Problem** `[확인사실]`
  AI 검색(ChatGPT·Perplexity·HyperCLOVA·Claude·Gemini·네이버·다음)이 답변을 생성할 때 **자사 브랜드를 인용하는지 확인할 방법도, 인용되게 만들 방법도 없다.** 한국어 학습 비중이 극히 낮아(GPT-3 기준 ~0.017%) 한국 브랜드는 특히 불리하다. 외국법인은 본사가 "한국 AI 가시성"을 KPI로 강제하는데 측정 도구가 전무하다.

- **Value Proposition** `[확인사실]`
  글로벌 GEO 도구가 **못 보는 한국어 AI 엔진(HyperCLOVA X·네이버·다음)까지** 측정하고, "이번 주 뭘 할지" 액션까지 제시한다. **글로벌 GEO 4개사 중 한국 AI 엔진을 커버하는 곳은 0곳** → 12~18개월 선점 창.

- **Success Metrics**
  - *제품 North Star (현행 유지)*: **유료 ARR** `[확인사실 = 현 PRD 지표]`
  - *구현 완료 기준*: 무료 도메인 진단 1회 → 7엔진 SoV 결과 1건 반환 → 리포트 1건 생성 (`[확인사실]` 라이브 동작)
  > 🔍 [Day02·03 재검토 — 미확정] North Star를 "주간 실행 액션 × SoV 상승"(선행지표)으로 재정렬 제안. 근거: "측정만"으로는 리텐션 약함(Profound ROI 사례). **단, 실고객 검증 전이라 확정 보류** → §8 로드맵. ARR은 결과지표, 액션실행은 선행지표로 분리하는 방향.

- **핵심 가정 1개** `[확인필요]`
  **"한국 마케터가 AI 답변 인용(GEO)을 SEO와 별개의 지불 가치로 인식한다."** 이게 거짓이면 전체가 성립하지 않는다. → §7 스모크테스트로 검증 예정(회사 단일 장애점).

---

## 2. Scope (MoSCoW) — 실제 구현 상태 대조

> 구 PRD가 "만들 것"으로 적은 Must를 **실제 코드와 대조**해 상태를 표기한다. 이게 현황서의 핵심.

| 기능 | MoSCoW | 실제 구현 상태 `[확인사실]` |
|---|---|---|
| 무료 도메인 진단 (로그인 없이 1회) | **Must** | ✅ 라이브 — `apps/web` `/audit` + `/api/audit` |
| 7엔진 SoV 측정 (한국어 3 + 글로벌 4) | **Must** | ✅ 엔진 구조 존재 (`Engine`·`Tracking` 모델, `packages/ai/lib/crew`) / ⚠️ HyperCLOVA 단일 슬라이스 실비용·레이턴시 실측은 P0 미완 |
| 인증 1흐름 (Clerk) | **Must** | ✅ 라이브 — `packages/auth`(Clerk), `apps/app` 로그인 |
| 브랜드 SoV 대시보드 | **Must** | ✅ 라이브 — `apps/app/(authenticated)` |
| 경쟁사 벤치마크 | Should | ◐ `Brand.competitors`(JSON) 존재 |
| 커스텀 프롬프트 | Should | ✅ `Prompt` 모델 존재 |
| 주간 액션 카드 | Could | ⬜ 미구현 (차별점이나 v1 범위 압박, §8) |
| 결제 자동화 | (부가) | ✅ 라이브 — **PortOne V2**(`checkout` + `/api/payments/verify`) |
| 다국어 | (부가) | ✅ 라이브 — **7개 언어**(ko·en·es·fr·de·pt·zh) |
| 구조화 데이터(JSON-LD) | (신규) | ✅ **2026-07-20 반영** — 홈 `SoftwareApplication`+`Organization` (도그푸딩) |

- **Won't (v1)**: CMS 1클릭 발행 · API/SSO · 모바일 앱 · B2B SaaS 세그먼트 영업

---

## 3. Non-Scope

| 제외 항목 | 이유 | 다시 검토할 조건 |
|---|---|---|
| CMS 1클릭 발행(Cafe24·스마트스토어) | 워크플로 기능, 4주 초과 복잡도 | v1.5 (측정→개선 확장 시) |
| API·SSO | 엔터프라이즈용, 초기 고객 불필요 | Enterprise 계약 발생 시 |
| B2B SaaS 세그먼트 영업 | 워크플로 기능 선행 필요 | v1.5 |
| 네이버 AI Briefing 직접 스크래핑 | ToS 위반 법적 리스크 (구 Cue:는 2026-04-09 종료 → 현행 추적 대상은 AI Briefing) | 공식 제휴/합법 경로 확보 시 | <!-- [확인사실 2026-07-22] Cue: 종료일 2026-04-09로 통일(일부 자료 2025.3), 대상명 AI Briefing으로 정리 -->

---

## 4. Architecture & Constraints (실측)

### 4.1 실제 데이터 모델 `[확인사실 = schema.prisma 9모델]`

> ⚠️ 구 PRD 전달표의 추상 6엔티티는 **실제 스키마와 이름·구조가 다르다**(Day04 발견). 실제는 다음 9모델:

```
Organization ─┬─ User          (Clerk org 연동, 워크스페이스 격리 단위)
              ├─ Brand ─┬─ Prompt
              │         ├─ Tracking  (엔진별 SoV 측정 — org 키 없이 brandId만 ⚠️)
              │         └─ Report
              ├─ Report
              └─ (competitors = Brand.competitors JSON, 별도 테이블 아님)
Engine        (7개 AI 엔진 정의)
AuditJob      (무료 진단 — 익명, org 없음)
Lead          (전환 리드)
```

- **격리 경계** `[확인사실]`: org 키를 직접 보유한 모델은 **9개 중 3개(Brand·Report·User)뿐**. `Tracking`은 org 키 없이 `brandId`만 → **`trackingId` 직접 조회 시 org 격리 우회 가능**. 유일 방어 = `scopedTracking(orgId, id)`가 `brand:{organizationId}` 경유로 필터(Day11 설계, 코드 반영은 §8).

### 4.2 Constraints

| 항목 | 값 | 확인 |
|---|---|---|
| 스택 | Next.js(App Router) · TypeScript strict · pnpm+Turbo 모노레포(앱7·패키지20) | `[확인사실]` |
| 인증 | **Clerk** (Supabase Auth 아님) | `[확인사실]` |
| DB | **Neon PostgreSQL + Prisma** (`relationMode="prisma"` → DB-level RLS 불가 → **앱레벨 org 스코핑**이 유일 격리선) | `[확인사실]` |
| 배포 | **Vercel** (라이브 www.findable.co.kr) | `[확인사실]` |
| AI | Vercel/렛서 AI Gateway(글로벌 4) + HyperCLOVA X·네이버·다음(한국어 3) | `[확인사실]` 게이트웨이 확보 / HyperCLOVA 실비용 `[확인필요]` |
| 결제 | PortOne V2 | `[확인사실]` |
| 인력 | 1인 + 4 AI 에이전트(Mastra) | `[확인사실]` |
| 경쟁 가격(참고) | Otterly $29~489 (Lite/Std/Prem) | `[확인사실]` 2026-07-07 |

---

## 5. Risks · Assumptions

| 분류 | 위험 | 확률 | 영향 | 완화 | 재확인 |
|---|---|---|---|---|---|
| **가정(회사 단일 장애점)** | 한국 마케터가 GEO를 별도 지불가치로 인식 안 함 | 중 | **상** | 지불의사 스모크테스트(§7) | P0 |
| 기술 | GEO 진단 엔진 실동작·실비용 미검증 (Day01 최대 리스크) | 중 | 상 | HyperCLOVA 단일 Vertical Slice end-to-end 실측 | P0 |
| 보안 | org 키 없는 모델(Tracking) 조직 간 데이터 우회 노출 | 중 | 상 | `scopedTracking` 헬퍼 + Clerk org 스코핑 강제 | §8 |
| 유닛이코노믹스 | CAC·전환율·COGS·Churn 미정의 | 중 | 상 | 스모크테스트에서 전환·클로징 실측 | P0 |
| 비용 | HyperCLOVA·AI Gateway 호출 비용 초과 | 중 | 중 | 캐싱 + 저가 모델(HCX-DASH) | 진행 |
| 운영 | 1인 운영 병목 | 중 | 중 | Mastra 에이전트 자동화 | 진행 |

**핵심 미검증 3종** `[확인필요]`: ①외국법인 실지불의사 ②측정 vs 개선 지불 지점 ③무료→유료 전환율.

---

## 6. 실습(Day01~11) → 코드 반영 추적표 ⭐

> PRD 발표의 증거. "실습에서 발견 → 실제로 뭘 했나"를 확신도별로 구분. **저위험은 반영, 방향 결정은 로드맵**.

| # | 실습 발견 | 출처 | 처리 |
|---|---|---|---|
| 1 | 랜딩에 GEO 구조화 데이터 없음 | Day06 | ✅ **코드 반영**(2026-07-20) — 홈 `SoftwareApplication` JSON-LD. GEO 회사가 자기 GEO 공백을 메움 = 도그푸딩 |
| 2 | metadata ↔ 포지셔닝 문구 | Day06 | ✅ **이미 일치** — dictionary "한국 최초 Agentic GEO Platform"·7엔진·한국어. 본문·메타·JSON-LD 3자 일치 |
| 3 | USP "1/3 가격" 오류(Otterly $29 반례) | Day02 | ✅ **문서 실수정** — 가격이 아닌 "한국어 독점"을 1순위 USP로 |
| 4 | 전달표 6엔티티 ≠ 실제 9모델 | Day04 | ✅ **PRD 정정 반영**(§4.1) |
| 5 | Tracking org 키 없음 → 격리 우회 | Day11 | 🟡 **설계 확정, 코드 반영 §8** — `scopedTracking` 헬퍼(저위험 신규) |
| 6 | North Star: ARR → 액션×SoV | Day02·03 | 🟡 **로드맵 가설**(§8) — 실고객 검증 전, 방향 결정이라 보류 |
| 7 | 타깃 순위: 외국법인 상향 | Day02 | 🟡 **로드맵 가설**(§8) — 실영업 데이터 후 |
| 8 | 주간 액션 카드 v1 승격 | Day02 | 🟡 **로드맵**(§8) — 차별점이나 4주 범위 압박 |

**반영 원칙**: 저위험·확신(문구·구조화데이터·헬퍼) = 실제 반영 / 고위험·방향결정(North Star·타깃·DB migration) = 로드맵 가설로만. **AI 분석으로 라이브 제품 방향을 즉시 덮지 않는다.**

---

## 7. 다음 검증 (P0 — 코드보다 실고객 먼저)

4명 페르소나 팀리뷰(CTO·CMO·CFO·악마의 대변인)가 **"지불의사부터 검증"으로 수렴**. 코드 확장 전 필수:

1. **지불의사 스모크테스트** — K-뷰티/D2C 그로스 10~15명에 수동 SoV 리포트 → "월 ₩99K 결제?" + 결제링크 클릭 관찰 (측정만 vs 액션 A/B)
2. **HyperCLOVA 단일 Vertical Slice** — 도메인→API→인용 파싱→SoV 1건 관통 + 호출당 실비용·레이턴시 실측

---

## 8. 로드맵 (검증 후 반영 — 발표에선 "가설")

> 🟡 방향 결정 항목. 실고객/데이터 검증 후 확정. 라이브 서비스라 성급히 코드 반영하지 않는다.

| 항목 | 조건 | 대상 코드 |
|---|---|---|
| `scopedTracking` 스코핑 헬퍼 | 저위험, 반영 가능 | `apps/app/lib/db/scoped.ts` (신규) |
| Clerk Core 3 미들웨어 마이그레이션 | `clerkMiddleware()` 교체 | `apps/app/middleware.ts` |
| North Star 재정렬(액션×SoV) | 스모크테스트 후 | `apps/*` 이벤트 계측 |
| 타깃 세일즈 1순위(외국법인) | 실영업 데이터 후 | (전략) |
| 주간 액션 카드 v1 승격 | 팀 논의 후 | `apps/app` |
| Brand.assigneeUserId migration | ⚠️고위험(라이브 DB) | `schema.prisma` — 보류 |

---

## 9. 성과·검증 (외부 트랙션)

- ✅ **KAIST OverEdge 2026 최종 합격** (서류→2차 인터뷰, 2026.06.29) — 8주 베이스캠프 진행 중
- ✅ 실배포 라이브 (www.findable.co.kr) — 앱7·패키지20·7개 언어·결제·진단 엔진
- 지원사업 트랙: D2SF 캠퍼스 기술창업 / IBK창공 14기 / 충북 ICT융합 발표 등

---

> **한 줄 요약**: 이 PRD는 상상이 아니라 **이미 배포된 코드를 실측해 역설계한 현황서**다. 실습 발견 중 저위험은 실제로 반영했고(JSON-LD·문구·스키마 정정), 방향 결정은 실고객 검증 후로 미뤘다. "기획만 하는 남들"과의 차이가 이 문서 전체에 증거로 남아 있다.
