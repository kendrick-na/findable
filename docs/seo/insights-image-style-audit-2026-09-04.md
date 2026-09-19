# Findable 인사이트 대표 이미지 대조 기록

검토일: 2026-09-04  
검토 범위: `apps/web/public/images/insights/`의 최신 4개 자산  
검토 목적: 신규 아티클 대표 이미지가 기존 Findable 인사이트 시리즈와 같은 브랜드 자산으로 보이는지 판정

## 대조한 기존 자산

| 파일 | 관찰된 핵심 구도 | 판정 |
|---|---|---|
| `seo-geo-difference-cover.png` | 좌측 검색 결과 패널 → 중앙 오렌지 연결점 → 우측 네이비 AI 답변 패널, 우측에 작은 문서 출처 | 기준 자산 |
| `seo-geo-difference-cover-v1.png` | 좌측 검색/문서 묶음 → 중앙 오렌지 연결선 → 우측 네이비 AI 답변, 바깥쪽에 소형 출처 카드 | 기준 자산 |
| `ai-search-citation-conditions.webp` | 좌측 겹친 출처 문서 → 단일 오렌지 라인과 중심 포인트 → 우측 네이비 답변 패널 | 기준 자산 |
| `ai-search-citation-diagnostic.webp` | 좌측 검색 화면과 하단 측정 레이어 → 중앙 진단 연결 → 우측 AI 결과와 출처 문서 | 기준 자산(정보 밀도 높은 변형) |

## 네 이미지에서 고정된 공통점

- 배경은 순백이 아닌 따뜻한 한지 계열 아이보리다. 다만 섬유가 거칠게 보이는 종이가 아니라, 표면에 아주 얕은 결만 있는 인쇄물 배경이다.
- 전체는 16:9 가로형이며, 오브젝트는 캔버스 가장자리에 붙지 않고 좌우 안전 여백을 둔다.
- 핵심 흐름은 거의 항상 `검색/질문 → 문서·출처 → AI 답변·판정`이다.
- 오렌지(`Findable`의 `#ff7a4d` 계열)는 연결선, 중심 포인트, 검색 결과 강조, 상태 마크처럼 흐름을 읽게 하는 중요한 시각 신호다. 장식용 작은 점 하나로 끝내지 않는다.
- 네이비는 AI 답변 또는 측정 결과의 기준 패널로 사용되고, 세이지·회색·베이지는 문서와 보조 정보에 사용된다.
- 형태는 얇은 선, 평면 패널, 종이 카드, 낮은 그림자의 2D 편집형 인포그래픽이다. 입체 제품 렌더나 추상 아트가 아니다.
- 카드와 문서 안의 줄은 정보 구조를 표현하는 빈 선이다. 읽을 수 있는 제목·회사명·URL·로고를 넣지 않는다.
- 요소 수는 적당히 제한한다. 주제에 따라 3~7개 정도의 구조적 요소만 사용하며, 랜덤 노드·무의미한 카드 나열은 금지한다.

## 이전 생성 시안과의 불일치 원인

이전에 생성된 시안의 문제는 규칙을 “한지 느낌의 AI 일러스트”로 넓게 해석한 데 있었다. 그 결과 거친 섬유 질감, 풍경 장식, 큰 추상 구체, 과도한 빈 공간 또는 랜덤 네트워크가 들어갔다. 이는 최신 4개 자산의 공통 스타일이 아니다. 특히 한지 질감은 배경의 미세한 표면감만 뜻하며, 그림의 주제가 되어서는 안 된다.

## 프롬프트 원문 회수 결과

Git 기록에서 이미지가 추가된 커밋(`713f08e`, `5f0d930`)과 저장소 전체의 `imagegen`, `prompt`, `한지`, `아이보리`, `cover prompt` 관련 텍스트를 확인했다. 해당 커밋에는 이미지 바이너리와 라우트·콘텐츠 연결만 있고, 당시 ImageGen에 입력한 프롬프트 원문은 저장소나 Git 이력에서 회수되지 않았다.

따라서 아래의 **대조 기반 canonical prompt**를 앞으로의 단일 기준으로 사용한다. 원문을 찾았다고 가정하지 않으며, 생성 전에는 최신 기준 자산을 참고 이미지로 함께 대조하고 생성 후에는 이 문서의 체크리스트로 반려 여부를 판단한다.

## 대조 기반 canonical prompt

```text
Create a 16:9 editorial infographic cover for a Findable Insights article.
Use a warm hanji-like ivory paper background with only very subtle fine paper grain,
not rough fibers. Use a calm flat 2D print/editorial infographic style matching the
reference Findable insight covers: thin dark navy outlines, restrained paper cards,
soft low shadows, dark navy result panels, muted sage and warm gray supporting
elements, and Findable orange #ff7a4d as a clearly visible structural accent.

Build one readable left-to-right information flow: a search/question or search-result
panel on the left, a small set of 2–4 source/document sheets in the middle or side,
and one dark navy AI answer or diagnostic panel on the right. Connect the stages with
one clean orange line, checkpoint, or highlighted route. Keep the main objects modest
in size with generous but balanced margins and enough visual density to feel like the
existing covers.

Use only article-relevant diagram objects. No scenery, mountains, plants, clouds,
moons, decorative landscape, giant sphere, random network, neon, glossy 3D render,
or abstract AI artwork. Do not include any readable text, Korean or English letters,
brand names, logos, URLs, watermark, fake company mark, or decorative typography.
Represent text only with blank lines, abstract blocks, and color marks. The result
must look like a member of the existing Findable Insights image series, not a new
illustration style.
```

## 다음 생성 전 승인 게이트

- [ ] 최신 4개와 같은 미세한 아이보리 종이결인가
- [ ] 좌측 검색/질문에서 우측 AI 답변/판정으로 읽히는가
- [ ] Findable 오렌지가 연결 구조의 핵심 신호로 보이는가
- [ ] 네이비 결과 패널·문서 카드·낮은 그림자가 기존과 같은가
- [ ] 16:9와 좌우 안전 여백을 지키는가
- [ ] 텍스트·로고·URL·워터마크가 전혀 없는가
- [ ] 풍경·큰 구체·랜덤 네트워크·거친 한지 그림이 없는가
- [ ] 사용자가 시안을 승인하기 전에는 게시물에 연결하지 않는가
