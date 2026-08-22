# A-04-O3 — 자동화 후보 3개

> Findable · Day04 · 2026-07-08 · Track A
> ⚠️ 치환: 커리큘럼 = Supabase DB trigger/Edge Function/Cron. Findable = **Vercel Functions(Fluid Compute) + Vercel Cron + Prisma trigger(@updatedAt) + Mastra 에이전트**. 아래는 그 종류 매핑.
> 후보 식별만. 실제 구현은 Day08(Skill)·Day13(에이전트)·Day14(운영)·Day17(로그/알림).

## 후보 3개

| # | 후보 | 종류 | PRD/Risk 연결 | 대상 모델 | 이번 주 구현 |
|---|---|---|---|---|---|
| 1 | **AuditJob 상태 전이 + 완료시각 자동 기록** (queued→processing→completed, completed_at·updated 갱신) | **DB trigger 성격**(Prisma `@updatedAt`, 상태 전이는 앱 로직) | Must "무료 도메인 진단"(PLG 핵심) / Risk "GEO 엔진 실동작 미검증" | AuditJob | **가능**(간단·DB 내부값). 단 진단 실행 자체는 후보2 |
| 2 | **도메인 진단 실행 파이프라인** (도메인→7엔진 호출→인용파싱→SoV→Tracking·result 적재) | **Edge Function/서버리스**(Vercel Function) | Must "7엔진 SoV 측정" / Risk "AI Gateway·HyperCLOVA 비용·레이턴시" | Tracking·AuditJob·Report | **보류** — 외부 API·비밀키(렛서 게이트웨이) 필요 → trigger 안 직접 호출 금지. Day07 Vertical Slice에서 첫 관통 |
| 3 | **주간 SoV 배치 + weekly Report/PDF 생성 + 알림** | **Cron**(Vercel Cron 주1회) | Must "SoV 대시보드"(리텐션) / Risk "1인 운영 병목" | Tracking·Report | **보류** — Day17(로그·이벤트·알림) 이후. 관측 가능성·비용 캐싱 선행 |

## 종류 구분 규칙 (지킴)
- **DB trigger 성격**: DB 내부 값 갱신만(updated_at·상태). Claude/렛서 호출·결제·외부알림 **직접 금지**.
- **Edge Function/서버리스**: 외부 API·비밀키 필요한 일(진단 엔진 = 렛서 게이트웨이 호출). 후보2가 여기.
- **Cron**: 정기 실행(주간 배치·리포트). 후보3.

## Mastra 연계 (Findable 고유)
- 후보2의 "강화 모드"(AuditJob.crew_result 4에이전트: 민지·Alex·수진·준호)는 **Mastra 에이전트 워크플로** → Day13에서 반영.
- 즉 후보2 = 빠른 휴리스틱(서버리스 즉시) + 강화 4에이전트(Mastra, 옵션) 2단.

## 왜 이 3개
PRD Must 4개(무료진단·7엔진SoV·인증·대시보드) 중 **사람이 반복하는 일**을 뽑음:
- 진단 요청마다 상태 갱신 = 반복 → 후보1 자동화.
- 도메인마다 7엔진 호출·파싱 = 반복·핵심가치 → 후보2(단 외부호출이라 서버리스).
- 매주 브랜드별 SoV 재측정·리포트 = 정기 반복 → 후보3(Cron).
> 인증(Clerk)·대시보드(읽기 UI)는 자동화 대상 아님(사용자 인터랙션).
