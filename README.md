# Findable — 한국 최초 Agentic GEO Platform

**AI 답변(ChatGPT·네이버 등) 속 브랜드 가시성을 측정하는 데서 멈추지 않고, 안 보이는 원인을 진단하고 AI가 추천하도록 직접 고치는 처방까지 하는 Agentic GEO 플랫폼.**

🔗 **라이브 서비스: [www.findable.co.kr](https://www.findable.co.kr)** — 도메인을 입력하면 7개 AI가 실시간으로 호출되고 30초~3분 뒤 진단 PDF가 나옵니다. (데모가 아니라 프로덕션)

---

## 무엇을 하는가

검색의 정의가 바뀌고 있습니다. 사람들은 이제 링크를 클릭하지 않고 AI 답변 한 줄을 읽고 결정합니다. 그 답변에 안 보이는 브랜드는 존재하지 않는 것과 같습니다.

Findable은 **7개 AI 엔진**에서 브랜드 가시성을 측정하고, 안 보이는 원인을 진단해, AI가 추천하도록 콘텐츠를 고치는 처방까지 합니다.

| 단계 | 내용 |
|---|---|
| **진단** | 7엔진(ChatGPT·Claude·Perplexity·Gemini·HyperCLOVA X·네이버·다음)에서 점유율·인용·감성 측정 |
| **처방** | 안 보이는 원인을 식별하고, AI가 읽기 좋은 구조화 콘텐츠를 생성 (8~10월 빌드) |
| **학습** | 효과를 재측정·기억해 다음 진단을 개선 (한국어 데이터 플라이휠) |

## 아키텍처

- **4개 자율 에이전트** — 한국 GEO 분석가 / 글로벌 벤치마크 / 인용 출처 분석가 / 액션 전략가
- **7엔진 병렬 호출** — 글로벌 4(AI Gateway) + 한국 3(CLOVA Studio·검색 API 합성)
- **Princeton GEO 알고리즘** — KDD'24·ICLR'26 학술 룰의 한국어 구현
- 1인 풀스택, 기획부터 배포까지 5일

## 기술 스택

`Next.js` · `next-forge (모노레포)` · `Mastra (에이전트 오케스트레이션)` · `Vercel` · `Neon Postgres` · `AI Gateway` · `CLOVA Studio` · `Clerk (OAuth 4종)` · `Toss Payments` · `GA4 · PostHog`

## 구조

```
apps/
  web/    — 마케팅·진단 (www.findable.co.kr)
  app/    — 대시보드·인증 (app.findable.co.kr)
packages/
  ai/         — 7엔진 어댑터 + 에이전트 오케스트레이션
  database/   — Prisma 스키마
  ...
```

## 빠른 시작 (개발자)

```bash
pnpm install
cp apps/web/.env.example apps/web/.env.local   # 환경변수 채우기
pnpm dev
```

---

**나현덕** · Founder & CEO · kendrick@indigochild.kr
SparkClaw Cohort 01 신청 (2026.06)
