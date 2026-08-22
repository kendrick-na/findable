# K-뷰티 AI 응답 가시성 파일럿

Findable 명의 첫 자체 리서치를 위한 재현 가능한 측정기다. 고객사 계정·비공개 측정값은 사용하지 않는다.

## 조사 질문

한국어 비브랜드 구매 질문에 답할 때 ChatGPT·Perplexity·Gemini가 어떤 K-뷰티 브랜드를 얼마나 반복적으로 언급하는가?

## 표본과 해석

- 20개 공개 브랜드 목적표본
- 구매·비교·문제 해결·제품·선물 의도의 질문 12개
- 엔진별 질문당 3회 반복
- 핵심 지표: 응답 등장률, 후보군 내 경쟁 점유율, 평균 등장 순서, 질문 커버리지, 3회 반복 안정성
- 시장점유율이나 인과효과를 주장하지 않는다.
- API 응답은 소비자용 웹 UI와 다를 수 있다.

## 실행

먼저 1개 질문 파일럿으로 인증·응답·파서를 검증한다.

```bash
FINDABLE_ENGINE_GROUNDING=1 bun --env-file=apps/web/.env.local scripts/kbeauty-benchmark/run.ts --limit=1 --repeats=1
bun scripts/kbeauty-benchmark/analyze.ts
```

검증 후 전체 측정을 실행한다.

```bash
FINDABLE_ENGINE_GROUNDING=1 bun --env-file=apps/web/.env.local scripts/kbeauty-benchmark/run.ts
bun scripts/kbeauty-benchmark/analyze.ts
```

기본 출력은 `/tmp/findable-kbeauty-benchmark`에 저장한다. 원시 응답은 검증 후에도 자동으로 저장소에 커밋하지 않는다.
