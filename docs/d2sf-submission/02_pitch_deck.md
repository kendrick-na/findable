# Findable IR PDF — D2SF 2026 (10~15p 초안)

작성일: 2026-05-08
타겟: D2SF 캠퍼스 기술창업 공모전 평가관 + 양상환 센터장
파일명: Findable_D2SF_2026.pdf

---

## 페이지 구성 (15p)

| # | 제목 | 핵심 메시지 | 평가 시그널 |
|---|---|---|---|
| 1 | 표지 | "AI 에이전트가 진단하는 한국 최초 Agentic GEO 플랫폼" + 라이브 QR | B1·B2·B3 |
| 2 | Why Now | 5 데이터 + AI 브리핑 20% | ① + D1 |
| 3 | 풀고자 하는 문제 | 한국 광고주의 AI 시대 가시성 공백 | ① + D1·D2 |
| 4 | 솔루션 개요 | 광고주 7엔진 라이브 + 데이터셋 8엔진 정밀 + 4 AI 에이전트 | ④ + B6 |
| 5 | 차별화 Top 5 | 한국 엔진 / Entity / Princeton / Crew / 가격 | ④ + G3 |
| 6 | 라이브 베타 — 5/4 출시 D+5 | 베타 화면 + 카운터 | B1·B2·B3 |
| 7 | 라이브 측정 — 메디큐브·라운드랩 | jobId + SoV 93 | ② + G1 |
| 8 | K-뷰티 5사 Before/After | Princeton 시뮬레이션 | ② + ④ |
| 9 | 시너지 8 Pillar | 합격팀 5패턴 + 네이버 4니즈 | C1~C5 + D1~D4 |
| 10 | 합격팀 패턴 미러 | 무빈·비닷두·포자랩스·Hello Max | B8 + C |
| 11 | 팀 + 합류 계획 | 나현덕 + 6개월 합류 | ③ + G2·G4 |
| 12 | 6개월 인큐베이팅 활용 | 마일스톤·KPI | E1·E2 + G5 |
| 13 | 글로벌·CES 시나리오 | v2.0 + CES 2027 | B5 + E1·E2 |
| 14 | 위험 + 대응 | G1·G2·G3 정직 인정 | G 모두 |
| 15 | 마무리 + 5개 라이브 URL | 종합 | 종합 |

---

## p1. 표지

```
[Logo Findable]

AI 에이전트가 진단하는, 한국 최초 Agentic GEO 플랫폼.

ChatGPT · Claude · Perplexity · Gemini · HyperCLOVA X · 네이버 · 다음
— 7 AI 엔진 라이브 측정. AI 답변에서 우리 브랜드의 위치.

(K-GEO-Bench 데이터셋·GEO Report는 +AI 브리핑 8엔진 정밀)

[QR] findable.co.kr  ←  지금 라이브 베타 운영 중
[QR] findable.co.kr/en ←  영문 베타 (5/8 출시, 글로벌 진출)

D2SF 캠퍼스 기술창업 공모전 — 2026.05.08 · D+5
30세 청년 창업가 나현덕 · 인디고차일드 · kendrick@indigochild.kr

▷ 5/4 한국 베타 → 5/8 영문 베타 + K-GEO-Bench + GEO Report
   = 8일간 8 라이브 자산 (양상환 "빠르고 집요한" 직접 사례)
```

---

## p2. Why Now — 시장은 이미 움직였다

```
1️⃣ 2024.11 ChatGPT Search 정식 출시 — 검색의 정의가 답변으로 전환

2️⃣ 2026.02 Profound (GEO 카테고리) — Series C $96M / 첫 GEO 유니콘 ($1B)

3️⃣ 2026.04 HubSpot AEO $50/월 출시 — 카테고리 커머디티화 시작

4️⃣ 2025.12 ChatGPT 한국 검색 점유 54.5%
   네이버 AI 브리핑 도입 — 검색의 20%, 곧 40%로 확대

5️⃣ GEO 시장 CAGR 45.5% — $1.48B (2026) → $17.02B (2034)

→ a16z·Sequoia·Lightspeed·NEA 모두 베팅한 카테고리.
   다만 "한국어 GEO 측정 도구"는 0건. 이 빈자리가 Findable.
```

---

## p3. 풀고자 하는 문제

```
[헤드라인]
한국 광고주는 두 채널에서 동시에 발견되어야 합니다.

[현황]
네이버 검색 64% 점유 + ChatGPT 한국 점유 54.5%
+ 네이버 AI 브리핑 20%→40% 확대

[페인]
• 메디큐브 같은 K-뷰티 D2C가 ChatGPT 영문에선 잘 나오지만
  HyperCLOVA X 한국어에선 뜻밖에 묻힘
• 광고주는 "내 브랜드가 AI에서 어떻게 보이는지" 알 수 없음
• 한국어 LLM 학습 풀은 영문 대비 50배 좁음 (D-019 리서치)

[기회]
한국어 GEO 측정 도구 = 한국 0건. Findable이 첫 케이스.
```

---

## p4. 솔루션 개요

```
[Findable = 4 AI 에이전트 × 8 엔진 측정·분석·최적화 (분리 운영)]

광고주 audit (라이브 7엔진, 30초~3분 진단):
  • 글로벌 4 — ChatGPT · Claude · Perplexity · Gemini
  • 한국 3 — HyperCLOVA X · 네이버 검색 · 다음

K-GEO-Bench 데이터셋 + GEO Report (정밀 8엔진):
  • 7엔진 + 네이버 AI 브리핑 (한국 첫 통합 모듈, 로컬 라이브)
  • audit 통합은 인큐베이팅 1개월차 라이브 예정

4 AI 에이전트 (Crewmate/Mastra 패턴):
  민지 (한국 GEO) · Alex (글로벌 벤치마크) ·
  수진 (인용 출처 분석) · 준호 (액션 전략)

핵심 출력:
  Share of Voice · Citation Rank · Sentiment ·
  Naver vs Global AI Gap · Korean Entity Grounding 추적
```

---

## p5. 차별화 Top 5 (Moat)

```
1. 한국 AI 엔진 독점 통합 ⭐⭐⭐⭐⭐
   웹 검증: 한국어 GEO 기관 투자 경쟁자 0건
   네이버 AI 브리핑 측정 — 한국 0건

2. Korean Entity Grounding ⭐⭐⭐⭐
   한·영·혼용 표기 변형 통합 (예: 메디큐브/Medicube/메디 큐브)
   Ahrefs Brand Radar의 한국어판

3. Princeton KDD'24 + ICLR'26 GEO 알고리즘 ⭐⭐⭐⭐
   학술 검증 visibility +40% 룰셋 한국어 적용

4. 4 자율 AI 에이전트 워크플로우 ⭐⭐⭐⭐
   D2SF 2026 신규 베팅 카테고리 (시냅스AI·반달AI 동급)

5. 1인 팀 친화 가격 ₩99K/30 프롬프트 ⭐⭐⭐⭐
   Profound $399 대비 1/5 (한국 PLG 글로벌 표준)
```

---

## p6. 라이브 베타 — 5/4 출시 D+5

```
[베타 라이브 화면 캡처]

🟢 Live · 운영 중

D+5         X건            Y개
베타 운영    진단 완료      추적 브랜드

[메인 화면]
"AI 에이전트가 진단하는, 한국 최초 Agentic GEO 플랫폼"

→ 5일 압축 출시 (D-001~D-046)
→ 광고주 7엔진 라이브 + 4 AI 에이전트 + Naver vs AI Gap 라이브
   (8엔진 정밀 데이터는 K-GEO-Bench 데이터셋)

라이브 검증: findable.co.kr (지금 무료 진단 가능)
```

---

## p7. 라이브 측정 — K-뷰티 5사 8일 검증 (5/1~5/8)

```
[5사 jobId 직링크 QR]

5/6 메디큐브 (medicube.co.kr) — SoV 93/100
5/7 라운드랩 (roundlab.kr) — SoV 93/100
5/8 아누아 (anua.kr) — SoV 96/100 ⭐ 1위 (Amazon 토너 1위 영향)
5/8 조선미녀 (beautyofjoseon.com) — SoV 92/100
5/8 달바 (dalba.com) — SoV 92/100

→ 8일 동안 K-뷰티 5사를 빠르고 집요하게 측정·검증.

[광고주 Use-Case 시나리오 — 메디큐브 마케팅팀 가정 ⚠️ 시뮬레이션]

Step 1. Findable로 측정
  → 다음(Daum) 50% 약세 발견 (5사 공통 패턴)
Step 2. 액션
  → 다음 검색 친화 콘텐츠 (브런치·카카오뷰) 6주간 도입
Step 3. 6주 후 재측정
  → 다음 인용률 50% → 80% 예상 (Princeton +40% 검증치)
Step 4. 매출 임팩트 (시뮬)
  → 다음 검색 유입 +X% / 카카오 광고 ROI 보호

→ Findable의 Use-Case = 측정→액션→재측정→매출 보호
   광고주가 진짜로 받는 가치 = "AI 답변 채널 다각화" 인프라

[Naver vs Global AI Gap 카드 캡처]
→ 베타 도구가 진짜 측정·진짜 분석함을 라이브로 증명.
```

---

## p8. K-뷰티 5사 Before/After 시뮬레이션

```
[5사 — 카테고리 균형]

메디큐브 (더마) · 라운드랩 (클린) · 아누아 (진정) ·
조선미녀 (한방) · 달바 (글로벌 D2C)

[Before — 실측]
공통 패턴 발견:
• 글로벌 4엔진: 100% 인용 (K-뷰티 영문 강세 확정)
• HyperCLOVA X: 100% 인용 (한국어 LLM 친화)
• 다음(Daum): 50% 약세 (카카오 검색 인덱스 갭)

[After — Princeton GEO 적용 시 시뮬레이션 ⚠️]
S1 Cite Sources         +40% (KDD'24 검증)
S2 Quotation            +40% (KDD'24 검증)
S3 Statistics           +40% (KDD'24 검증)
S4 Korean Entity        +25% (Findable 추정)
S5 AI 브리핑 최적화      +30% (Findable 추정)

* "After" 수치는 학술 검증치 기반 시뮬레이션. 실제 결과는
  인큐베이팅 6개월 동안 50사로 확장하며 종단 검증 예정.

[QR] findable.co.kr/ko/case/a-brand
```

---

## p9. 시너지 8 Pillar — 네이버와 같이 크기

```
[2x4 그리드 카드]

① AI 브리핑 측정 (로컬 라이브, 데이터셋 8엔진) | D1 점유율 방어
② Naver vs Global AI Gap (라이브 5/8)    | D2 광고주 lock-in
③ K-GEO-Bench v0.1 (라이브 5/8) ⭐      | D3 R&D / 무빈 패턴
④ Acqui-hire SDK (Long-term)            | D2 광고센터 / 비닷두 패턴
⑤ 클로바 스튜디오 마켓플레이스 (v1.5)    | D3 B2B 2,000사
⑥ JSONL 데이터셋 export (라이브 5/8) ⭐ | D3 / 무빈 보강
⑦ 글로벌 SaaS 진출 (영문 베타 5/8 라이브) ⭐ | D4 / D2SF 미국 거점
⑧ CES 2027 출전 (v1.5)                  | D2SF KPI / 양상환 80%

▷ 5/8 라이브 격상: ③·⑥·⑦ — 약속에서 라이브 자산으로 전환

[Pillar ④ 인수 가치 명세서 — Acqui-hire SDK]
인수 시 네이버에 즉시 통합 가능한 가치 3가지:
  • 광고주 6,500사 풀 + GEO 측정 모듈 즉시 추가
  • 한국어 GEO 데이터셋 (5사 → 50사 → 200사 누적) 흡수
  • Findable 광고주 = 네이버 광고주 100% 겹침 = 매출 시너지

[Pillar ⑤ 클로바 스튜디오 양방향 통합]
양방향 워크플로 (단순 입점 아님):
  Findable 측정 → 클로바 스튜디오 콘텐츠 생성 → 재측정
  클로바 스튜디오 사용 2,000개 기업이 자체 GEO 측정 가능

[QR] findable.co.kr/ko/synergy
```

---

## p10. 합격팀 패턴 미러

```
[D2SF 직접 투자 8팀의 5 패턴]

A 인수 (비닷두 → 네이버웹툰)
  → Findable: SDK 분리 설계 (Pillar ④)

B R&D 인프라 (무빈 → 1784 모션 데이터셋)
  → Findable: K-GEO-Bench 공동 발표 (Pillar ③·⑥)

C 콘텐츠 공급 (포자랩스 → 네이버TV BGM)
  → Findable: 광고주 교육 콘텐츠 + 네이버 검색 광고센터 블로그

D 매출 직접 기여 (Hello Max → 네이버 검색 광고)
  → Findable: AI 브리핑 측정 (데이터셋 라이브, audit 1개월차 라이브 예정) + Gap Report (Pillar ①·②)

E B2B SaaS (클로바 스튜디오 2,000사)
  → Findable: 마켓플레이스 입점 (Pillar ⑤)

→ 5 패턴 모두 Findable에 매칭됨.
   양상환 무빈 선정 사유 "차별화 + 빠른 실행 + 젊은 에너지" 3박자
   Findable이 갖춤.
```

---

## p11. 팀 + 합류 계획

```
[현재 — 30세 청년 창업가, 1인 단독]
나현덕 (Founder & CEO)
• 동국대학교 핀테크블록체인학과 석사 (휴학 — 창업 집중)
• 동국대 경영전문대학원 핀테크블록체인학과 최고위자 과정 수료 (2021)
• 인디고차일드(2019.11~) 6년 K-콘텐츠·IP 마케팅
• 이터널에디션즈(2022.03~) CMO — 워터밤 공식 커뮤니티 앱 +
  티켓 리셀 서비스. 기획부터 앱스토어·구글플레이스토어 출시까지
  C레벨 경영진으로 직접 참여 = 앱·서비스 풀스택 출시 경험 검증
• 2024.11 고용노동부 생성형 AI 활용 경진대회 최우수상

▷ 학생 자격 + 산업 경험 양립: 휴학은 창업 집중을 위한 선택,
  6년 광고 에이전시 운영 자체가 실전 학습

[검증된 트랙 레코드 — "8일 7+ 브랜드 측정" 빠른 집요함]
• 서울특별시 서울윈터페스타 — AI 에이전트 마케팅 총괄
• 남양주시 오르빛 Re:member (광복 80주년 공식 행사)
• 워터밤 페스티벌 (인플루언서 + NFT 통합 캠페인)
• 5/4 한국 베타 → 5/6 메디큐브 → 5/7 라운드랩 → 5/8 아누아·
  조선미녀·달바 + K-GEO-Bench + GEO Report + 영문 베타 출시
  = 8일 동안 라이브 자산 8개 발행

[외부 협업 네트워크 — 검증된 자산]
• 인디고차일드 6년 운영으로 검증된 400개 이상 브랜드 협업 풀
  (디자인·개발·콘텐츠·마케팅 외부 풀)
• 이터널에디션즈 CMO 경험 = 앱·서비스 풀스택 출시 외부 협업 검증
• 동국대 핀테크블록체인학과 대학원 네트워크 = CTO 후보 풀
• 인큐베이팅 시 즉시 활용 가능

[합류 계획 — 인큐베이팅 6개월]
• AI Engineer 1명 (한국어 LLM·GEO 알고리즘 — 2026.07~08)
• CTO 후보 1명 (동국대 핀테크블록체인학과 네트워크)
• 법인 전환 (2026.06)
```

---

## p12. 6개월 인큐베이팅 활용 계획

```
[D2SF 신청 시점 = 5/8 / 인큐베이팅 시작 = 7/1 (예상)]

▷ 5/8 시점 이미 라이브 자산:
  영문 베타 (글로벌 진출 시작) · K-GEO-Bench v0.1 (R&D 자산) ·
  GEO Report v0.1 (콘텐츠 자산) · K-뷰티 5사 광고주 7엔진 측정 ·
  AI 브리핑 모듈 로컬 라이브 (데이터셋 8엔진 정밀, audit 통합 1개월차)
  ⭐ 이미 인큐베이팅 0개월차 자산

[월별 마일스톤]

M1 (2026.07)
  • 법인 전환 + AI Engineer 1명 합류 (한국어 LLM·GEO 알고리즘)
  • D2SF 포트폴리오 115팀 중 D2C/B2C 60팀 무료 Audit 제공 시작
  • K-뷰티 50사 측정 확장 → K-GEO-Bench v0.5 (50사 데이터셋)
  • 영문 베타 1차 콜드 영업 (글로벌 K-뷰티 D2C 300사 풀)

M2 (2026.08)
  • Crew 4 에이전트 → 6 에이전트 (한국어 GEO·Brand Guardrails 추가)
  • Korea Export Benchmark 정식 모듈 GA
  • 첫 유료 고객 5사 (월 ₩99K~₩390K)
  • 월 1회 K-뷰티 GEO Report 정기 발행 시작

M3 (2026.09)
  • K-GEO-Bench v0.5 공개 (네이버 R&D 공동 발표 검토)
  • AI 브리핑 audit 통합 정식 GA (1개월차 → 안정화 완료)
  • 유료 20사 → ₩7.8M MRR (₩94M 연환산 ARR 페이스)

M4 (2026.10)
  • CTO 합류 (동국대 핀테크블록체인학과 네트워크)
  • Stagehand → Browserbase 클라우드 전환 (확장성 확보)
  • 유료 35사 → ₩13.7M MRR

M5 (2026.11)
  • 클로바 스튜디오 마켓플레이스 입점 신청
  • 네이버 클라우드 그린하우스 입주 신청
  • 유료 50사 → ₩19.5M MRR · 연환산 ₩234M ARR 페이스
  • Seed 라운드 IR 시작 (IBK + 외부 VC + D2SF 직접 투자 검토)

M6 (2026.12)
  • K-GEO-Bench v1.0 (200사 K-뷰티·K-패션·K-콘텐츠)
  • Seed 라운드 클로징 (3~5억, IBK + 외부 VC + D2SF)
  • TIPS 신청 (씨엔티테크 추천)
  • CES 2027 한국관 출전 신청 진입
```

---

## p13. 글로벌·CES 시나리오

```
[v2.0 — 2027.Q2 글로벌 진출]

영문 도메인 리브랜딩 → 미국·일본·동남아 동시 진출
D2SF 미국 실리콘밸리 거점 (2024.10 설립) 활용

타겟 ICP:
  • 일본 SMB 700만 (K-뷰티 일본 침투 진행 중)
  • 동남아 SMB 7,000만
  • 미국 K-뷰티 글로벌 D2C 300사

[CES 2027 한국관 출전 목표]
  D2SF 포트폴리오 패턴:
    CES 2026 — 8팀 출전, 4팀 혁신상
    Findable v1.5 (2026.Q4) → CES 2027 출전 신청
    한국어 GEO 카테고리 첫 글로벌 데뷔
```

---

## p14. 위험 + 정직한 대응

```
[Q1] "GEO 입증 사례 없는데?"
A: GEO는 2024년 말 개화한 신시장으로 12개월 종단 데이터를 가진
   곳이 글로벌에 0건 (Profound·Athena·Goodie 포함). 입증 부재는
   시장 진입 타이밍의 증거. Findable의 목표는 한국에서 입증할 수
   있는 첫 번째 회사가 되는 것.

[Q2] "1인 단독으로 다 만드세요?"
A: 양상환 센터장이 강조한 "적은 인원으로도 제품 제작·실험 가능"의
   정확한 사례. 객관적 증거 4가지:

   ① 5/4 한국 베타 출시 (D-001~D-046 일별 결정 로그 보유)
      - 7 엔진 라이브 어댑터 + AI 브리핑 데이터셋 모듈 직접 구현
        (광고주 audit 7엔진 / 데이터셋 8엔진 분리 운영)
      - 4 AI 에이전트 + Crew 병렬화 (-53% 처리 시간) 직접 설계
   ② 5/4~5/8 8일간 라이브 자산 8개 발행
      - 한국 베타 + 영문 베타 + 시너지 페이지 + 케이스 페이지 +
        K-GEO-Bench + GEO Report + 메디큐브·라운드랩 jobId
   ③ 풀스택 통합 (대표 1인 직접):
      Stagehand · Mastra · Prisma · Vercel · Toss · Clerk · Resend ·
      AI Gateway · CLOVA Studio · Browserbase · Recharts · next-forge
   ④ 인큐베이팅 6개월 합류 약속:
      AI Engineer (M1) + CTO (M4) + 외부 협업 400+ 브랜드 풀

[Q3] "CrewAI는 오픈소스라 moat 약하지 않나?"
A: CrewAI 자체가 moat 아님. moat 3가지는 ① 한국 AI 엔진 독점 통합
   (한국 0건) ② Korean Entity Grounding ③ 메디큐브·라운드랩에서
   시작된 한국어 GEO 측정 데이터셋 (시간 누적 시 기관 투자가
   따라올 수 없는 자산).

[Q4] "법인 미설립인데?"
A: 2026.06 전환 예정. D2SF FAQ Q4: 법인 설립 여부 무관.

[Q5] "매출 미약?"
A: 5/4 베타 출시 D+5 시점이라 정상. 인큐베이팅 6개월 KPI:
   유료 50사 / ₩6M ARR / 11~12월 Seed 3~5억.
```

---

## p15. 마무리 — 5개 라이브 URL

```
[Findable이 D2SF에 합류한다면]

한국 광고주의 AI 시대 가시성 인프라가 만들어집니다.
네이버 검색 매출 방어 + 하이퍼클로바X B2B 확장 + K-뷰티 글로벌
진출 — 세 영역에 동시 기여합니다.

지금 라이브로 검증 가능합니다.

[1] 메인 베타 (한국어)    findable.co.kr
[2] 영문 베타 (5/8)       findable.co.kr/en
[3] 시너지 8 Pillar       findable.co.kr/ko/synergy
[4] K-GEO-Bench v0.1      findable.co.kr/ko/research/k-geo-bench-v0_1
[5] K-뷰티 GEO Report     findable.co.kr/ko/report/k-beauty-geo-2026q2
[6] K-뷰티 5사 시뮬       findable.co.kr/ko/case/a-brand
[7] 메디큐브 측정         findable.co.kr/ko/audit/57fbfad0...
[8] 라운드랩 측정         findable.co.kr/ko/audit/257c1723...

[연락]
나현덕 · Founder & CEO
kendrick@indigochild.kr
010-8958-2547

"AI는 우리 브랜드를 추천하고 있나요?"
이 질문에 가장 정직하게 답하는 회사가 되겠습니다.
```

---

# PDF 디자인 가이드 (Claude Design 활용 시)

## 톤
- 메모리 D-005: Linear DESIGN.md + Resend Serif 풀 카피
- 메인 색: var(--findable-primary) #5e6ad2 (라벤더 인디고)
- 다크/라이트: 라이트 모드 + 액센트 다크
- 폰트: Pretendard Variable + Domaine Display Narrow

## 페이지 레이아웃
- A4 세로 (1240×1754 @ 150dpi)
- 좌상단 페이지 번호 + Findable 로고
- 우하단 라이브 URL QR 코드

## 자산
- 라이브 베타 화면 스크린샷 5장
- jobId 결과 페이지 스크린샷 2장
- 시너지 페이지 카드 스크린샷
- /case/a-brand 시뮬레이션 차트
