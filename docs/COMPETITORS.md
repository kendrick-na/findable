# Findable 경쟁사 분석

**문서 버전**: v1.0 (2026.04.30)
**소스**: `docs/inputs/01_research_A_competitors.md`, `docs/inputs/06_research_F_competitor_customers.md`

---

## 1. 글로벌 GEO 직접 경쟁사 4곳

| 회사 | 라운드·밸류 | 가격 | 엔진 수 | 한국 엔진 | 주요 고객 |
|---|---|---|---|---|---|
| **Profound** | $96M Series C / $1B (2026.02, Lightspeed) | $99 / $399 / $2K~5K+ | 9개 | ❌ | MongoDB, Indeed, DocuSign, Zapier, Ramp, Chime, US Bank, Plaid, Brex, Figma, Mercury, Clay, Wayfair, Charlotte Tilbury, Mejuri, Omnilux, OpusClip, LG |
| **Bluefish AI** | $43M Series B (2026.04, Threshold + NEA) | 커스텀 (연 $50K~$200K+) | 주요 | ❌ | Adidas, American Express, Hearst, LVMH, Ulta Beauty, Tishman Speyer |
| **Peec AI** (Berlin) | $21M Series A (2025.11, Singular) | €89 / €199 / 커스텀 | 3+α | ❌ | Wix, Attio, n8n, ElevenLabs, Glide, Merge, Graphite, Chanel, TUI, Axel Springer, HomeToGo, DEPT, Peak Ace |
| **AthenaHQ** (YC) | $2.2M Seed (2025.06) | $270~$295 / $545 / $2K+ | 6개 | ❌ | Twilio, RingCentral, SoFi, Coinbase, Slalom, PagerDuty, Nextiva, Motion, Checkr, Grüns, Popl, Lago, DeVry, Delta, Toyota |

---

## 2. 상장사 진입자 (저가 위협)

| 회사 | 출시 | 가격 | 엔진 | 위협도 |
|---|---|---|---|---|
| **HubSpot AEO** | 2026.04.14 | $50/월 | 3개 (ChatGPT·Gemini·Perplexity) | ⚠️ 저가 진입 |
| **Semrush AI Visibility** | 2025 | $99/월 add-on | 5개 | ⚠️ |
| **Ahrefs Brand Radar** | 2025.09 | 기존 플랜 포함 | 6개 | ⚠️ |
| **Similarweb GenAI Toolkit** | 2025.07 | Enterprise | 가시성 + AI 리퍼럴 | ⚠️ |

---

## 3. 한국 시장 = 무경쟁 공백

### 3.1 4개사 모두 한국 고객 공개 0건
- 한국어 네이티브 지원 0건
- 한국 결제·세금계산서·KISA 보안 미지원

### 3.2 한국어 GEO SaaS 기관 투자 0건 (2026.04 웹 검증)
- Findable이 선점 가능

### 3.3 네이버·카카오 자체 도구는 자사 데이터만
- HyperCLOVA X·Naver Cue:·Kakao i 통합 도구 부재

---

## 4. Findable USP 5가지

### 4.1 한국 AI 엔진 독점 커버리지
- HyperCLOVA X (CLOVA Studio 공식 API)
- Naver 검색 (공식 API + HyperCLOVA 합성으로 Cue: 90% 재현)
- Daum (Kakao 검색 API)
- → 11개 글로벌 GEO 경쟁사 중 한국 엔진 커버 = Findable 유일

### 4.2 Korean Entity Grounding
- 한·영·혼용 표기 통합 추적 (예: "아모레 / Amorepacific / 아모레퍼시픽")
- Ahrefs Brand Radar 한국어 버전 세계 최초

### 4.3 한국어 + 영어 동시 7개 엔진
- Profound 9개 / Peec 3개 / HubSpot 3개 모두 영어만
- Findable: 한국 3 + 글로벌 4 = 7개

### 4.4 무료 한국어 Audit
- HubSpot AEO Grader가 유일한 무료 도구이나 영어 한정
- 한국어 도메인·인용 분석 = Findable 유일

### 4.5 가격 1/3
- Profound $99 → Findable ₩99K (~$70)
- AthenaHQ $295 대비 1/4

---

## 5. 산업별 고객 분포 (4개사 합산)

| 산업 | 비중 추정 | 함의 |
|---|---|---|
| **B2B SaaS** | ~38% | 압도적 1위. "GEO는 D2C 뷰티만" 통념 반대 |
| **핀테크/금융** | ~18% | Mercury·Ramp·Brex 등 |
| **D2C/소비재** | ~15% | 정량 효과는 가장 강함 (Omnilux 3배·Grüns 6배) |
| 럭셔리·패션·리테일 | ~10% | Bluefish 강점 (Adidas·LVMH) |
| 미디어·여행 | ~8% | Peec 강점 |
| 에이전시 | ~5% | 의외로 적음 (in-house 도입) |
| HR·교육·헬스 | ~6% | - |

---

## 6. Findable이 가져야 할 기능 7개 (v1.0)

(상세는 PRD Part B 참조)

| # | 기능 | 경쟁사 보유 | 5일 구현 |
|---|---|---|---|
| 1 | 무료 도메인 Audit | HubSpot AEO Grader만 | 중 |
| 2 | 3개+ 엔진 동시 추적 | 4개사 전부 | 중 |
| 3 | Brand Sentiment + SoV | 4개사 전부 | 중 |
| 4 | Custom Prompt + 자동 추천 | 4개사 전부 | 하 |
| 5 | 경쟁사 벤치마크 | 4개사 전부 | 하 |
| 6 | Citation Source + 도메인 권위 | 4개사 전부 | 중 |
| 7 | CSV/엑셀 Export | Profound·Peec 상위 티어만 | 하 |

---

## 7. v1.5 이연 기능 (경쟁사 보유)

| 기능 | 경쟁사 보유 | Findable 구현 시기 |
|---|---|---|
| AI Referral 트래픽 추적 | Profound, AthenaHQ | v1.5 |
| CMS 자동 발행 | Profound, AthenaHQ | v1.5 |
| 컨텐츠 자동 생성 Action Agent | Profound Actions, AthenaHQ Action Center, HubSpot Breeze | v1.5 |
| API 외부 공개 + SSO | 4개사 Enterprise | v1.5 |
| Prompt Volume 추정치 | Profound | v2.0 |

---

## 8. 핵심 케이스 스터디 (영업 무기)

| 회사 | 고객 | 산업 | 정량 결과 |
|---|---|---|---|
| Profound | OpusClip | B2B SaaS (영상편집) | AI 응답 가시성 45%, AEO 트래픽 +20%, 구독 +40% |
| Profound | Hone | HR/교육 SaaS | AI 검색 가시성 +800% |
| Profound | Omnilux | D2C 뷰티 | LLM 기여 매출 1%→3% |
| Bluefish | Adidas | 글로벌 스포츠웨어 | "double·triple-digit performance gains" |
| Peec | Merge | B2B SaaS | 데모 요청 7배, LLM 트래픽 10배, AI 검색 전환 6배 |
| Peec | Wix | 웹빌더 | "어떤 콘텐츠가 어느 LLM에 surface되는지 정확히 짚어준다" |
| AthenaHQ | Popl | D2C 디지털 명함 | 18일 1561% ROI, AI 랭킹 5위→1위 |
| AthenaHQ | Grüns | D2C 비타민 | 60일 SoV 6배 |

→ Findable 영업 시 "Omnilux 매출 3배·Popl ROI 1561%" 글로벌 사례 + Findable 한국 고객 사례 (확보 후) 조합

---

## 9. 영업 첫 5초 페인 차트 (영업 무기)

| 영업 대상 | 시연 케이스 |
|---|---|
| K-뷰티 D2C | "메디큐브 vs Beauty of Joseon" — 영문 ChatGPT 5~7번째 vs 1번째 |
| 한국 진출 외국 브랜드 | "LV·Apple Korea 한국어 ChatGPT 노출 0" |
| 한국 내수 D2C | "무신사 인기 브랜드 한국어 AI 검색 노출 비교" |
| K-패션 | "마뗑킴 vs ADER Error" — 5번째 vs 1번째 |
| K-콘텐츠 | "Kakao Entertainment vs Naver Webtoon" |
| (v1.5+) B2B SaaS | "Channel Talk vs Intercom" — Top 10에 0건 |

---

## 10. 결론

### 글로벌 시장은 검증됨
- 4개사 합산 누적 펀딩 ~$160M+
- 다양한 산업 (B2B SaaS·핀테크·D2C·럭셔리)에서 작동

### 한국 시장은 공백
- 4개사 모두 한국 고객 0건
- Findable의 First-mover 기회 12~18개월

### Findable 차별점은 명확
- 한국 AI 엔진 독점 커버리지
- Korean Entity Grounding
- 한국어 + 영어 동시 7개 엔진

### 주요 리스크
- 한국 시장 교육 필요 (글로벌 진출형은 이미 페인 인지)
- 빅테크 (Microsoft·Google·Naver 자체) 진입 시 빠른 대응 필요
- B2B SaaS 영업은 v1.5 워크플로 기능 확보 후
