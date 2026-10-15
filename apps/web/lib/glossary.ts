/**
 * Findable 검색·AI 가이드(용어집) 데이터 — 한국어·영어.
 *
 * 🔴 2026-10-15 원인조사: 구글이 한글 용어집 3개(seo·geo·ai-search-visibility)를
 *   "크롤링됨-색인 안 함"으로 보류했다(본문 약 1,100자, 모든 용어 페이지가 같은 FAQ 반복).
 *   → 용어마다 **고유한 설명·FAQ·관련 용어 링크**를 갖도록 확장했다.
 *
 * ⚠️ 사실 규칙: 통계·고객·실적·수상 같은 **새 사실을 쓰지 않는다.** 일반 개념과
 *   Findable 이 이미 공개한 측정 방식만 쓴다. 외부 서비스 동작(AI 크롤러·llms.txt 등)은
 *   "각 사 공식 문서가 기준"이라고 단서를 단다.
 * ⚠️ 페이지 내용을 고치면 `GLOSSARY_UPDATED`(사이트맵 lastmod)도 같이 고친다.
 */

export const GLOSSARY_UPDATED = "2026-10-15";

export const GLOSSARY_SLUGS = [
  "seo",
  "geo",
  "aeo",
  "ai-search-visibility",
  "ai-citation",
  "share-of-voice",
  "brand-entity",
  "brand-name-collision",
  "structured-data",
  "llms-txt",
  "ai-crawlers",
  "eeat",
  "naver-ai-briefing",
] as const;

export type GlossarySlug = (typeof GLOSSARY_SLUGS)[number];

export interface GlossaryTerm {
  faqs: readonly (readonly [string, string])[];
  lead: string;
  sections: readonly (readonly [string, string])[];
  /** 목록 카드에 보이는 한 줄 설명 */
  short: string;
  title: string;
}

/** 용어 페이지 아래 "관련 용어"로 연결할 슬러그. 서로 가까운 개념끼리 묶는다. */
export const GLOSSARY_RELATED: Record<GlossarySlug, readonly GlossarySlug[]> = {
  seo: ["geo", "aeo", "structured-data", "eeat"],
  geo: ["seo", "aeo", "ai-citation", "brand-entity"],
  aeo: ["geo", "seo", "structured-data"],
  "ai-search-visibility": ["ai-citation", "share-of-voice", "geo"],
  "ai-citation": ["ai-search-visibility", "share-of-voice", "eeat"],
  "share-of-voice": ["ai-search-visibility", "ai-citation"],
  "brand-entity": ["brand-name-collision", "structured-data", "geo"],
  "brand-name-collision": [
    "brand-entity",
    "structured-data",
    "ai-search-visibility",
  ],
  "structured-data": ["brand-entity", "seo", "aeo"],
  "llms-txt": ["ai-crawlers", "geo", "structured-data"],
  "ai-crawlers": ["llms-txt", "seo", "geo"],
  eeat: ["ai-citation", "seo", "brand-entity"],
  "naver-ai-briefing": ["ai-search-visibility", "geo", "ai-citation"],
};

export const GLOSSARY_KO: Record<GlossarySlug, GlossaryTerm> = {
  seo: {
    title: "SEO란 무엇인가",
    short: "검색엔진이 웹페이지를 발견하고 이해하도록 돕는 최적화의 기본 개념.",
    lead: "SEO(Search Engine Optimization)는 검색엔진이 웹페이지를 발견하고 이해하도록 돕고, 검색 결과에서 적절한 사용자에게 노출되도록 개선하는 방법이다.",
    sections: [
      [
        "무엇을 해결하는가",
        "사용자가 검색하는 질문과 페이지의 내용이 정확히 연결되도록 웹사이트의 정보와 기술 구조를 개선한다. 좋은 글이 있어도 검색엔진이 찾거나 이해하지 못하면 사용자에게 닿지 않는다.",
      ],
      [
        "무엇을 최적화하는가",
        "페이지의 내용과 제목, 구조, 링크, 이미지, 기술적 접근성을 개선한다. 크게 세 가지로 나뉜다. 첫째, 검색엔진이 읽을 수 있는지(크롤링·색인). 둘째, 질문에 맞는 내용인지(콘텐츠). 셋째, 다른 곳에서 믿을 만한 출처로 연결되는지(링크·평판).",
      ],
      [
        "어떻게 측정하는가",
        "검색 노출, 클릭, 유입 검색어, 색인 상태와 전환을 함께 확인한다. 구글 서치 콘솔과 네이버 서치어드바이저처럼 검색엔진이 직접 제공하는 도구가 기본이다.",
      ],
      [
        "색인이 안 될 때",
        "페이지가 검색엔진에 발견되었는데도 색인되지 않는 경우가 있다. 내용이 짧거나 다른 페이지와 겹치거나, 사이트가 새로 생겨 신뢰 신호가 적을 때 흔하다. 접속이 막힌 것이 아니라 가치 판단의 문제이므로, 주제가 겹치는 글을 정리하고 각 페이지가 고유한 답을 갖게 만드는 것이 먼저다.",
      ],
      [
        "GEO와의 관계",
        "검색 순위가 높아도 AI 답변에 반드시 언급되는 것은 아니다. SEO는 검색 결과를, GEO는 생성형 AI 답변을 다룬다. 두 영역은 겹치는 부분이 있으므로 함께 관리하되 지표는 따로 본다.",
      ],
      [
        "간단한 예시",
        "‘AI 검색 최적화 방법’이라는 질문을 다룬다면 페이지 제목, 본문 구조, 관련 용어와 출처를 해당 질문에 맞게 구성한다.",
      ],
    ],
    faqs: [
      [
        "SEO를 하면 AI 답변에도 나오나요?",
        "도움이 될 수는 있지만 보장하지 않는다. AI 서비스는 검색 결과뿐 아니라 자체 지식과 여러 출처를 함께 쓰므로 검색 노출과 AI 답변 노출은 따로 확인해야 한다.",
      ],
      [
        "새 사이트는 얼마나 지나야 색인되나요?",
        "정해진 기간은 없다. 사이트 규모와 신뢰 신호, 페이지 품질에 따라 다르다. 색인 요청은 도움이 되지만 요청만으로 색인이 보장되지는 않는다.",
      ],
    ],
  },
  geo: {
    title: "GEO란 무엇인가",
    short: "생성형 AI 답변에서 브랜드와 콘텐츠가 발견되고 인용되는 구조.",
    lead: "GEO(Generative Engine Optimization)는 생성형 AI 서비스가 브랜드나 주제에 답변할 때 특정 콘텐츠를 발견하고 설명·인용하도록 정보를 구성하는 방법이다.",
    sections: [
      [
        "SEO와의 차이",
        "SEO가 검색 결과의 노출과 클릭을 주로 다룬다면, GEO는 AI 답변의 언급·설명·출처를 함께 살핀다. 사용자가 링크를 클릭하지 않고 답변만 읽고 끝나는 경우가 많아, ‘답변 안에 우리가 있는가’가 별도의 문제가 된다.",
      ],
      [
        "무엇을 최적화하는가",
        "AI가 읽고 요약하기 쉬운 사실 정보, 설명 구조, 출처 연결, 작성 주체와 최신성을 명확하게 만든다. 특히 ‘이 브랜드가 무엇이고 누가 운영하는가’가 여러 곳에서 같은 표현으로 확인되는지가 중요하다.",
      ],
      [
        "AI가 답을 만드는 두 가지 방식",
        "AI는 학습된 지식으로 답하거나, 웹 검색으로 최신 페이지를 읽고 답한다. 새 브랜드는 학습 지식에 없을 가능성이 크므로 웹 검색이 켜진 답변에서 발견되는지가 현실적인 첫 목표다. 어느 방식으로 답했는지에 따라 같은 질문의 결과가 달라진다.",
      ],
      [
        "어떻게 측정하는가",
        "동일한 질문을 반복 제시해 브랜드 언급 여부, 답변 내용, 인용 출처와 변화 추이를 기록한다. 브랜드 이름을 넣은 질문과 이름 없이 카테고리만 묻는 질문을 나누어 본다.",
      ],
      [
        "실행 순서",
        "① 우리 브랜드를 설명하는 한 문장을 정한다. ② 공식 사이트와 외부 프로필에 같은 문장·같은 이름을 쓴다. ③ 고객이 실제로 묻는 질문에 직접 답하는 페이지를 만든다. ④ 반복 측정으로 변화를 본다.",
      ],
      [
        "간단한 예시",
        "같은 브랜드 질문을 여러 AI 서비스에 제시하고, 브랜드가 언급됐는지와 어떤 페이지가 출처로 인용됐는지를 비교한다.",
      ],
    ],
    faqs: [
      [
        "GEO와 AEO는 같은 말인가요?",
        "겹치지만 같지는 않다. AEO는 질문에 대한 답변으로 선택되는 것 전반을, GEO는 생성형 AI 답변에서의 발견·인용에 더 초점을 둔다. 현업에서는 섞어 쓰기도 한다.",
      ],
      [
        "GEO 효과를 보장할 수 있나요?",
        "어떤 서비스도 AI 답변 노출을 보장할 수 없다. 답변은 질문·모델·시점에 따라 달라지므로 반복 측정으로 추이를 확인하는 것이 현실적이다.",
      ],
      [
        "GEO를 하려면 무엇부터 해야 하나요?",
        "먼저 지금 AI가 우리 브랜드를 어떻게 설명하는지 측정한다. 이름을 잘못 알거나 다른 서비스와 혼동한다면 정보 정리가 우선이고, 아예 언급이 없다면 외부 출처와 답변형 페이지를 늘린다.",
      ],
    ],
  },
  aeo: {
    title: "AEO란 무엇인가",
    short: "검색엔진과 답변 엔진이 질문에 대한 콘텐츠를 선택하도록 돕는 방법.",
    lead: "AEO(Answer Engine Optimization)는 검색엔진과 답변 엔진이 사용자의 질문에 대한 답변으로 콘텐츠를 선택하고 제시하도록 최적화하는 방법이다.",
    sections: [
      [
        "핵심 원칙",
        "질문 의도에 맞는 직접적인 답변을 제공하고, 제목·소제목·FAQ로 정보 구조를 명확하게 만든다. 첫 문단에서 질문에 바로 답하고 이어서 근거를 제시하는 순서가 기본이다.",
      ],
      [
        "SEO와의 차이",
        "SEO는 검색 결과 전반의 발견과 순위를 다루고, AEO는 질문에 대한 답변으로 선택될 수 있는 정보 표현에 집중한다. 같은 페이지가 순위는 낮아도 답변 상자에 선택될 수 있다.",
      ],
      [
        "GEO와의 관계",
        "AEO는 답변 선택 전반을 다루며, GEO는 생성형 AI 답변에서의 발견과 인용에 특히 초점을 둔다.",
      ],
      [
        "답변 단위로 쓰는 법",
        "한 페이지에는 한 가지 질문을 끝까지 답한다. 용어는 처음 나올 때 풀어 쓰고, 수치는 출처와 측정일을 함께 적는다. 표와 목록은 사람과 AI 모두 구조를 파악하기 쉽게 한다.",
      ],
      [
        "간단한 예시",
        "‘GEO와 SEO의 차이는?’라는 질문에 한 문단 안에서 핵심 답변을 먼저 제시하고, 이어서 근거와 관련 링크를 제공한다.",
      ],
    ],
    faqs: [
      [
        "FAQ 스키마만 넣으면 AEO가 되나요?",
        "아니다. 구조화 데이터는 보이는 질문과 답변을 설명하는 보조 신호이며 노출을 보장하지 않는다. 먼저 사람이 읽어도 충분한 답이 페이지에 있어야 한다.",
      ],
      [
        "AEO 글은 짧을수록 좋은가요?",
        "아니다. 답은 짧고 앞에 두되, 근거와 맥락은 충분히 제공해야 AI와 사람이 신뢰할 수 있다.",
      ],
    ],
  },
  "ai-search-visibility": {
    title: "AI 검색 가시성이란 무엇인가",
    short: "AI 답변에서 브랜드가 언급·설명·인용되는 정도를 측정하는 개념.",
    lead: "AI 검색 가시성은 생성형 AI 답변에서 브랜드나 콘텐츠가 얼마나 자주 언급되고, 어떤 맥락과 출처로 제시되는지를 나타내는 개념이다.",
    sections: [
      [
        "주요 지표",
        "브랜드 언급률, 답변 내 위치, 설명의 정확성, 인용 출처와 질문별 편차를 활용할 수 있다. 언급은 됐지만 설명이 틀리면 가시성이 높아도 도움이 되지 않는다.",
      ],
      [
        "측정 단위",
        "브랜드·제품·주제별 질문 세트를 만들고, AI 서비스·모델·시점별 결과를 같은 조건에서 비교한다.",
      ],
      [
        "이름 있는 질문과 이름 없는 질문",
        "‘OO이 뭐야?’처럼 브랜드 이름을 넣은 질문은 인지도를, ‘이런 서비스 추천해줘’처럼 이름 없는 질문은 추천 후보에 드는지를 본다. 두 결과는 의미가 다르므로 합쳐서 평균 내지 않는다.",
      ],
      [
        "엔진마다 다르다",
        "같은 브랜드도 AI 서비스마다 결과가 크게 갈릴 수 있다. 웹 검색을 쓰는 서비스에서는 보이고, 학습 지식만 쓰는 서비스에서는 보이지 않는 일이 흔하다. 한 서비스의 결과를 전체로 일반화하지 않는다.",
      ],
      [
        "주의할 점",
        "한 번의 답변만으로 판단하지 않고 질문·모델·시점별로 반복 측정해야 한다. 계정의 대화 기록이나 메모리 같은 개인화도 결과에 영향을 줄 수 있다.",
      ],
      [
        "SEO와의 관계",
        "검색 순위가 높아도 AI 답변에 반드시 언급되는 것은 아니므로 검색 노출과 AI 답변 노출을 별도 지표로 관리한다.",
      ],
    ],
    faqs: [
      [
        "가시성이 낮으면 무엇부터 보나요?",
        "먼저 이름 있는 질문에서 정확히 설명되는지 본다. 틀리면 이름·설명 정리가, 맞는데 이름 없는 질문에서만 안 나오면 외부 출처와 답변형 콘텐츠 확대가 우선이다.",
      ],
      [
        "몇 번 측정해야 믿을 수 있나요?",
        "정해진 숫자는 없지만 같은 질문을 여러 번, 여러 날에 걸쳐 반복해야 한다. 한 번의 결과는 우연일 수 있다.",
      ],
    ],
  },
  "ai-citation": {
    title: "AI 인용이란 무엇인가",
    short: "AI 답변이 근거로 제시하는 출처 링크와 그 선택 기준.",
    lead: "AI 인용(AI citation)은 생성형 AI가 답변의 근거로 특정 웹페이지를 출처로 제시하는 것이다. 브랜드 이름이 답변에 나오는 ‘언급’과는 다른 개념이다.",
    sections: [
      [
        "언급과 인용의 차이",
        "언급은 답변 본문에 브랜드 이름이 나오는 것이고, 인용은 출처 카드나 링크로 우리 페이지가 연결되는 것이다. 언급은 되는데 인용이 없다면 AI가 우리 브랜드를 다른 사이트의 설명을 통해 알고 있다는 뜻일 수 있다.",
      ],
      [
        "무엇이 인용되기 쉬운가",
        "질문에 첫 문단에서 바로 답하고, 주장 옆에 출처가 있고, 작성 주체와 수정일이 보이는 페이지가 선택되기 쉽다. 한 페이지가 한 질문을 끝까지 답하는 구조도 유리하다. 다만 이는 경향이며 인용을 보장하는 규칙은 없다.",
      ],
      [
        "공식 사이트가 아닌 곳이 인용될 때",
        "블로그, 위키, 언론 기사, 커뮤니티가 대신 인용되는 일이 많다. 이때는 공식 사이트만 고치기보다 그런 외부 출처에 정확한 정보가 있는지 확인하는 편이 효과적이다.",
      ],
      [
        "어떻게 측정하는가",
        "같은 질문 세트를 반복해 답변마다 인용된 주소를 수집하고, 도메인별로 집계한다. 우리 도메인이 포함된 비율과 어떤 외부 도메인이 우리 대신 인용되는지를 본다.",
      ],
      [
        "서비스마다 인용 방식이 다르다",
        "출처를 항상 보여주는 서비스도 있고, 웹 검색을 켰을 때만 보여주는 서비스도 있다. 출처가 없다는 것이 곧 언급이 없다는 뜻은 아니다.",
      ],
    ],
    faqs: [
      [
        "인용을 늘리려면 링크를 많이 걸면 되나요?",
        "링크 수가 아니라 질문에 대한 답과 근거의 질이 중요하다. 출처가 분명하고 최신이며 작성 주체가 보이는 페이지를 만드는 것이 기본이다.",
      ],
      [
        "AI가 우리 글을 인용했는지 어떻게 아나요?",
        "답변의 출처 카드나 링크를 확인하거나, 반복 측정 도구로 인용 주소를 수집한다. 서버 로그에서 해당 AI 서비스의 크롤러 방문을 함께 보면 보조 증거가 된다.",
      ],
    ],
  },
  "share-of-voice": {
    title: "AI 답변 점유율(Share of Voice)이란 무엇인가",
    short: "같은 질문에서 우리 브랜드가 경쟁사 대비 얼마나 언급되는지의 비율.",
    lead: "AI 답변 점유율은 같은 질문 세트에서 AI가 언급한 브랜드 전체 중 우리 브랜드가 차지하는 비율이다. 절대 노출 횟수보다 경쟁사와의 상대 위치를 보여준다.",
    sections: [
      [
        "왜 필요한가",
        "‘언급됐다/안 됐다’만으로는 경쟁 상황을 알 수 없다. 같은 질문에서 경쟁사가 더 자주 추천된다면 우리의 노출이 있어도 기회를 잃고 있을 수 있다.",
      ],
      [
        "계산 방법",
        "질문 세트를 정하고 AI 서비스별로 답변을 모은다. 각 답변에서 언급된 브랜드를 추출해, 우리 브랜드의 언급 횟수를 전체 브랜드 언급 횟수로 나눈다. 비교 대상 브랜드 목록과 질문 세트를 고정해야 시점별 비교가 가능하다.",
      ],
      [
        "해석할 때 주의",
        "질문 세트를 바꾸면 점유율도 바뀐다. 경쟁사 후보를 넓게 잡을수록 우리 점유율은 낮아진다. 따라서 숫자 하나보다 같은 기준의 시간별 변화를 본다.",
      ],
      [
        "함께 보면 좋은 지표",
        "답변에서의 순서(몇 번째로 언급되는지), 설명의 정확성, 인용 출처를 함께 본다.",
      ],
    ],
    faqs: [
      [
        "점유율이 낮으면 무조건 나쁜가요?",
        "아니다. 틈새 질문에서 경쟁이 거의 없다면 낮은 점유율이 의미가 적을 수 있다. 어떤 질문에서 밀리는지 분해해서 봐야 한다.",
      ],
    ],
  },
  "brand-entity": {
    title: "브랜드 엔티티(개체)란 무엇인가",
    short: "AI와 검색엔진이 ‘하나의 대상’으로 인식하는 브랜드의 정체성 정보.",
    lead: "엔티티(entity)는 검색엔진과 AI가 이름·분야·운영 주체·공식 사이트 등을 묶어 ‘하나의 대상’으로 이해하는 단위다. 브랜드 엔티티가 분명해야 AI가 우리를 다른 대상과 혼동하지 않는다.",
    sections: [
      [
        "왜 중요한가",
        "AI는 글자 일치가 아니라 의미로 대상을 구분한다. 이름이 같거나 비슷한 대상이 여럿이면, 우리에 대한 정보가 흩어져 있을 때 다른 대상의 정보와 섞일 수 있다.",
      ],
      [
        "엔티티를 이루는 정보",
        "정식 이름과 표기 변형(한글·영문), 한 줄 설명, 분야, 운영 주체, 대표 도메인, 공식 프로필 주소, 로고 등이다. 이 정보가 사이트와 외부 프로필에서 일관되어야 한다.",
      ],
      [
        "어떻게 정리하는가",
        "① 브랜드를 설명하는 한 문장을 정하고 모든 곳에서 같게 쓴다. ② 사이트에 Organization 구조화 데이터를 넣고 이름, 대표 도메인, 로고를 적는다. ③ 실제로 운영하는 공식 프로필만 sameAs로 연결한다. ④ 제3자 출처(언론·디렉터리)에서 같은 이름·설명이 확인되는지 점검한다.",
      ],
      [
        "하지 말아야 할 것",
        "확인되지 않은 수상·고객·실적을 넣거나, 운영하지 않는 계정을 공식 프로필로 연결하는 것은 신뢰를 오히려 해친다. 사실로 확인되는 정보만 쓴다.",
      ],
      [
        "표기 변형 관리",
        "한글 표기와 영문 표기를 모두 쓰는 브랜드는 두 표기를 한 곳에서 연결해 주는 문장(예: ‘한글명(영문명)’)을 반복해서 사용한다.",
      ],
    ],
    faqs: [
      [
        "위키데이터나 위키백과에 등재해야 하나요?",
        "필수는 아니다. 등재에는 독립적인 제3자 출처가 필요하므로, 먼저 언론·디렉터리 같은 외부 출처를 쌓는 편이 순서상 맞다.",
      ],
      [
        "엔티티 정리 효과는 언제 나타나나요?",
        "검색엔진과 AI가 정보를 다시 수집해야 반영되므로 보통 수 주 이상 걸린다. 반복 측정으로 변화를 확인한다.",
      ],
    ],
  },
  "brand-name-collision": {
    title: "브랜드 이름 충돌이란 무엇인가",
    short: "같은 이름의 다른 서비스와 섞여 AI가 우리를 구분하지 못하는 문제.",
    lead: "브랜드 이름 충돌은 일반 단어이거나 다른 서비스가 같은 이름을 쓸 때, 검색엔진과 AI가 우리 브랜드를 다른 대상과 구분하지 못하는 문제다.",
    sections: [
      [
        "어떤 모습으로 나타나는가",
        "이름만 검색하면 호텔·다른 회사·다른 서비스가 먼저 나오거나, AI가 다른 대상을 설명하며 우리를 모른다고 답한다. 같은 분야의 동명 서비스가 있으면 더 심해진다.",
      ],
      [
        "먼저 확인할 것",
        "이름만, 이름+분야, 이름+도메인, 한글 표기, 영문 표기를 각각 검색해 상위 결과를 기록한다. 이름만으로 밀려도 분야나 도메인을 붙이면 잘 나오는 경우가 많다.",
      ],
      [
        "대응 방법",
        "① 이름 옆에 분야를 붙인 표현(예: ‘이름 + 서비스 분야’)을 첫 화면·소개·프로필에서 일관되게 쓴다. ② 한글·영문 표기를 한 문장 안에서 함께 보여 준다. ③ Organization 구조화 데이터에 이름, 대표 도메인, 공식 프로필을 넣는다. ④ 이름을 바꾸기 전에 먼저 이 정리부터 한다.",
      ],
      [
        "주의",
        "다른 서비스를 깎아내리거나 이름을 흉내 내는 방식은 쓰지 않는다. 우리가 누구인지를 사실대로 분명하게 밝히는 것이 목표다.",
      ],
    ],
    faqs: [
      [
        "이름을 바꿔야 하나요?",
        "대부분은 아니다. 분야·도메인·운영 주체를 일관되게 붙여 구분하는 것이 비용이 훨씬 적다. 이름 변경은 마지막 수단이다.",
      ],
    ],
  },
  "structured-data": {
    title: "구조화 데이터(JSON-LD)란 무엇인가",
    short: "페이지의 의미를 기계가 읽도록 표시해 두는 코드.",
    lead: "구조화 데이터는 페이지 안의 정보가 무엇인지(조직, 글, 제품, 질문과 답변 등) 검색엔진과 AI가 정확히 읽도록 표준 형식으로 적어 두는 코드다. 가장 흔한 형식이 JSON-LD이고 어휘는 schema.org를 쓴다.",
    sections: [
      [
        "무엇을 알려 주는가",
        "이 페이지가 글인지, 누가 썼는지, 언제 수정됐는지, 이 회사가 무엇인지 같은 사실을 사람이 보는 화면과 별개로 기계가 읽는 형태로 전달한다.",
      ],
      [
        "자주 쓰는 유형",
        "Organization(조직), WebSite(사이트), Article(글), BreadcrumbList(탐색 경로), FAQPage(질문과 답변), DefinedTerm(용어), Dataset(데이터셋) 등이다.",
      ],
      [
        "지켜야 할 원칙",
        "구조화 데이터의 내용은 화면에 실제로 보이는 내용과 같아야 한다. 화면에 없는 수치나 수상, 존재하지 않는 계정을 넣으면 신뢰를 잃는다. 문법이 틀리면 읽히지 않으므로 검증 도구로 확인한다.",
      ],
      [
        "효과의 한계",
        "구조화 데이터는 이해를 돕는 보조 신호이며 색인이나 노출을 보장하지 않는다. FAQ 같은 일부 유형은 검색 결과의 특별 표시가 제한되기도 한다. 본문 품질이 먼저다.",
      ],
      [
        "함께 쓰면 좋은 곳",
        "브랜드 엔티티 정리(Organization의 name·url·logo·sameAs)와 글 페이지(Article의 작성자·날짜)에서 효과가 크다.",
      ],
    ],
    faqs: [
      [
        "구조화 데이터를 넣으면 AI 답변에 나오나요?",
        "보장하지 않는다. 다만 AI와 검색엔진이 브랜드와 글의 정체를 더 정확히 이해하도록 돕는다.",
      ],
      [
        "어떻게 검증하나요?",
        "구글의 리치 결과 테스트와 schema.org의 검증 도구로 문법 오류를 확인하고, 화면 내용과 일치하는지 사람이 대조한다.",
      ],
    ],
  },
  "llms-txt": {
    title: "llms.txt란 무엇인가",
    short: "AI가 읽기 쉽도록 사이트의 핵심 페이지를 안내하는 텍스트 파일.",
    lead: "llms.txt는 사이트의 루트에 두는 텍스트 파일로, AI가 사이트를 이해할 때 먼저 읽을 만한 설명과 주요 페이지 링크를 사람이 읽기 쉬운 형식으로 정리한 제안된 관례다.",
    sections: [
      [
        "무엇을 담는가",
        "서비스를 설명하는 짧은 소개, 운영 주체, 핵심 페이지 링크와 각 페이지의 한 줄 설명을 적는다. 마크다운 형식이라 사람도 읽을 수 있다.",
      ],
      [
        "robots.txt와의 차이",
        "robots.txt는 크롤러에게 ‘어디에 들어와도 되는지’를 알리는 규칙이고, llms.txt는 ‘무엇을 먼저 보면 좋은지’를 안내하는 설명이다. 역할이 다르며 서로를 대체하지 않는다.",
      ],
      [
        "효과에 대한 현실적인 이해",
        "llms.txt는 공식 표준이 아니라 제안된 관례이며, 주요 검색·AI 서비스가 이를 기준으로 삼는다고 각 사가 공식 확인한 것은 아니다. 그래서 ‘넣으면 AI에 나온다’고 기대하면 안 된다. 만들기 쉽고 해가 없으니 보조 수단으로 둔다.",
      ],
      [
        "작성 요령",
        "과장 없이 사실만 쓴다. 링크는 실제로 열리는 주소만 넣고, 바뀌면 함께 고친다. 공식 소개와 사실 문서(운영 주체, 제품 범위)를 가장 위에 둔다.",
      ],
    ],
    faqs: [
      [
        "llms.txt가 없으면 불이익이 있나요?",
        "알려진 불이익은 없다. 사이트 본문과 구조화 데이터, 외부 출처가 훨씬 중요하다.",
      ],
    ],
  },
  "ai-crawlers": {
    title: "AI 크롤러란 무엇인가",
    short: "AI 서비스가 웹페이지를 읽어 가는 봇과 허용·차단 설정.",
    lead: "AI 크롤러는 AI 서비스가 웹페이지를 읽어 가는 자동화 프로그램이다. 서비스마다 학습용, 검색 결과용, 사용자 요청용으로 이름을 나눠 쓰는 경우가 많고, 허용 여부는 robots.txt로 정한다.",
    sections: [
      [
        "대표적인 예",
        "OpenAI는 모델 학습용 GPTBot, ChatGPT 검색용 OAI-SearchBot, 사용자 요청 시 방문하는 ChatGPT-User를 구분한다. Anthropic은 ClaudeBot 등, Perplexity는 PerplexityBot 등을 쓴다. 이름과 용도는 바뀔 수 있으므로 각 사의 공식 문서가 기준이다.",
      ],
      [
        "무엇을 정해야 하나",
        "브랜드가 AI 검색 답변에 나오게 하려면 검색용 크롤러가 공개 페이지를 읽을 수 있어야 한다. 반면 학습용 수집을 허용할지는 정책으로 따로 정할 수 있다. 로그인 후 화면, 결제, 개인 결과 페이지는 차단한다.",
      ],
      [
        "접근이 되는지 확인하는 법",
        "robots.txt에서 해당 크롤러를 막지 않았는지, 방화벽·봇 차단이 정상 크롤러를 막지 않는지, 서버 응답 코드가 200인지 확인한다. 이름만 흉내 낸 요청과 실제 서비스의 요청은 IP 범위로 구분해야 한다.",
      ],
      [
        "허용해도 노출이 보장되지는 않는다",
        "접근 가능은 필요조건일 뿐이다. 읽힌 뒤 답변에 쓰일지는 페이지의 품질, 출처, 질문과의 관련성이 결정한다.",
      ],
    ],
    faqs: [
      [
        "AI 크롤러를 막으면 검색 순위가 떨어지나요?",
        "일반 검색의 크롤러와 AI 크롤러는 별개다. 다만 AI 검색 답변에 나오기를 원한다면 해당 서비스의 검색용 크롤러까지 막지 않도록 주의한다.",
      ],
      [
        "서버 로그에서 무엇을 보나요?",
        "해당 AI 크롤러의 방문 여부, 응답 코드, 방문한 주소를 본다. 인용된 주소와 방문 기록이 맞아떨어지면 강한 증거가 된다.",
      ],
    ],
  },
  eeat: {
    title: "E-E-A-T란 무엇인가",
    short: "경험·전문성·권위·신뢰를 기준으로 콘텐츠 품질을 보는 관점.",
    lead: "E-E-A-T는 경험(Experience), 전문성(Expertise), 권위(Authoritativeness), 신뢰(Trustworthiness)의 약자로, 구글이 콘텐츠 품질을 평가할 때 쓰는 관점이다. 직접적인 순위 공식이 아니라 품질을 판단하는 기준 틀에 가깝다.",
    sections: [
      [
        "네 가지 요소",
        "경험은 직접 해 본 흔적, 전문성은 주제에 대한 깊은 이해, 권위는 해당 분야에서 인정받는 정도, 신뢰는 정확하고 투명하며 믿을 수 있는지를 뜻한다. 이 중 신뢰가 가장 중요하다고 설명된다.",
      ],
      [
        "페이지에서 드러내는 방법",
        "작성자와 운영 주체를 밝히고, 수정일을 적고, 주장에는 출처를 붙이고, 연락처와 사업자 정보를 공개한다. 직접 측정한 데이터와 방법을 공개하면 경험과 전문성이 함께 드러난다.",
      ],
      [
        "AI 인용과의 관계",
        "AI가 어떤 출처를 근거로 삼을지는 공개되어 있지 않다. 다만 출처가 명확하고 작성 주체가 보이는 페이지가 신뢰하기 쉽다는 점은 사람과 기계에 공통이다.",
      ],
      [
        "흔한 실수",
        "근거 없는 최상급 표현, 확인되지 않은 수상·고객 표기, 작성 주체가 보이지 않는 글은 신뢰를 떨어뜨린다.",
      ],
    ],
    faqs: [
      [
        "E-E-A-T 점수가 따로 있나요?",
        "없다. 하나의 점수가 아니라 품질 평가에 쓰이는 관점이다.",
      ],
    ],
  },
  "naver-ai-briefing": {
    title: "네이버 AI 브리핑이란 무엇인가",
    short: "네이버 검색 결과 위에서 생성형 AI가 요약 답을 보여주는 기능.",
    lead: "네이버 AI 브리핑은 네이버 검색에서 질문에 대해 생성형 AI가 요약 답변을 보여주고, 근거가 된 출처를 함께 표시하는 기능이다. 한국에서 AI 답변 노출을 볼 때 ChatGPT 같은 해외 서비스와 따로 확인해야 하는 표면이다.",
    sections: [
      [
        "왜 따로 보나",
        "한국 사용자는 네이버에서 먼저 검색하는 경우가 많다. 해외 AI 서비스에서 잘 나와도 네이버 AI 브리핑에는 다른 출처가 선택될 수 있다.",
      ],
      [
        "어떤 출처가 보이나",
        "네이버 AI 브리핑에는 블로그, 카페, 지식iN 같은 네이버 안의 콘텐츠와 외부 웹사이트 출처가 함께 표시되는 경우가 있다. 질문의 성격에 따라 달라지며, 어떤 출처가 선택될지는 네이버가 공개한 기준을 확인해야 한다.",
      ],
      [
        "무엇을 준비하나",
        "공식 사이트를 네이버 서치어드바이저에 등록하고 사이트맵과 RSS를 제출한다. 질문에 직접 답하는 글을 만들고, 네이버 안에서도 브랜드 정보가 정확히 확인되도록 한다.",
      ],
      [
        "어떻게 측정하는가",
        "같은 질문을 네이버에서 반복 검색해 AI 브리핑이 뜨는지, 우리 브랜드가 언급되는지, 어떤 출처가 쓰였는지를 기록한다. AI 브리핑은 모든 질문에 나타나지 않는다.",
      ],
      [
        "Findable에서는",
        "Findable은 ChatGPT·Claude·Perplexity·Gemini와 함께 네이버 AI 브리핑·네이버·다음 검색의 노출을 같은 질문으로 측정한다.",
      ],
    ],
    faqs: [
      [
        "네이버 AI 브리핑은 모든 검색에 나오나요?",
        "아니다. 질문에 따라 나타나지 않을 수 있으므로 표시 여부 자체도 함께 기록한다.",
      ],
    ],
  },
};

export const GLOSSARY_EN: Record<GlossarySlug, GlossaryTerm> = {
  seo: {
    title: "What is SEO?",
    short:
      "The basics of helping search engines discover and understand your pages.",
    lead: "SEO (search engine optimization) helps search engines discover and understand a web page, so it can appear for relevant searches.",
    sections: [
      [
        "What problem does it solve?",
        "It connects the questions people search for with pages that answer them through clearer information and a more accessible site structure. A good page that search engines cannot find or understand never reaches its audience.",
      ],
      [
        "What do you optimize?",
        "Page content, titles, structure, links, images, and technical accessibility. Three layers matter: whether search engines can read the page (crawling and indexing), whether the content fits the question, and whether trustworthy sources point to it.",
      ],
      [
        "How do you measure it?",
        "Track search impressions, clicks, queries, indexing status, and conversions together. Tools from the search engines themselves, such as Google Search Console and Naver Search Advisor, are the baseline.",
      ],
      [
        "When a page is not indexed",
        "A page can be discovered and still left out of the index. It is common when content is short, overlaps with other pages, or the site is new and has few trust signals. Access is not the problem; value is. Consolidate overlapping topics and give each page a distinct answer first.",
      ],
      [
        "How does it relate to GEO?",
        "A high search ranking does not guarantee a mention in an AI answer. SEO covers search results; GEO covers generative AI answers. They overlap, so manage them together but track them separately.",
      ],
      [
        "A simple example",
        "For a page about AI search optimization, align its title, headings, related terms, and sources with the question the page answers.",
      ],
    ],
    faqs: [
      [
        "Will SEO also get me into AI answers?",
        "It can help but does not guarantee it. AI services use their own knowledge and several sources besides search results, so check search visibility and AI-answer visibility separately.",
      ],
      [
        "How long until a new site is indexed?",
        "There is no fixed time. It depends on site size, trust signals, and page quality. Requesting indexing helps but does not guarantee it.",
      ],
    ],
  },
  geo: {
    title: "What is GEO?",
    short:
      "How brands and content are found, described, and cited in generative AI answers.",
    lead: "GEO (generative engine optimization) is the practice of making information easier for generative AI services to find, explain, and cite when answering questions about a brand or topic.",
    sections: [
      [
        "How is it different from SEO?",
        "SEO mainly tracks visibility and clicks in search results. GEO also examines mentions, descriptions, and citations in AI-generated answers. Many users read the answer and never click, so whether you appear inside the answer becomes its own question.",
      ],
      [
        "What do you optimize?",
        "Verifiable facts, clear explanations, links to sources, authorship, and freshness. Above all, the same description of what the brand is and who runs it should be confirmed in several places.",
      ],
      [
        "Two ways an AI builds an answer",
        "An AI answers from learned knowledge or reads current pages through web search. A new brand is unlikely to be in learned knowledge, so being found in answers that use web search is a realistic first goal. The same question can give different results depending on which way the AI answered.",
      ],
      [
        "How do you measure it?",
        "Repeat the same questions and record whether the brand appears, how it is described, which sources are cited, and how answers change over time. Separate questions that include the brand name from questions that only ask about the category.",
      ],
      [
        "Order of work",
        "1) Decide one sentence that describes the brand. 2) Use the same sentence and name on the official site and outside profiles. 3) Publish pages that directly answer questions customers ask. 4) Measure repeatedly to see change.",
      ],
      [
        "A simple example",
        "Ask several AI services the same brand question, then compare mentions and the pages they cite.",
      ],
    ],
    faqs: [
      [
        "Are GEO and AEO the same?",
        "They overlap but are not identical. AEO covers being chosen as an answer in general; GEO focuses on discovery and citation in generative AI answers. Practitioners often use them interchangeably.",
      ],
      [
        "Can GEO results be guaranteed?",
        "No service can guarantee AI answer visibility. Answers vary by question, model, and date, so tracking trends through repeated measurement is the realistic approach.",
      ],
      [
        "Where should I start?",
        "Measure how AI describes the brand today. If it gets the name wrong or confuses you with another service, fix information first. If there is no mention at all, build outside sources and answer-style pages.",
      ],
    ],
  },
  aeo: {
    title: "What is AEO?",
    short:
      "How to make content useful as a direct answer to a searcher's question.",
    lead: "AEO (answer engine optimization) helps search and answer engines select and present content as an answer to a user's question.",
    sections: [
      [
        "The core principle",
        "Answer the question directly, then use headings and FAQs to make the supporting information easy to follow. Answer in the first paragraph, then give evidence.",
      ],
      [
        "How is it different from SEO?",
        "SEO covers discovery and ranking across search results. AEO focuses on how information is expressed so it can be selected as an answer. A page can win an answer box without ranking first.",
      ],
      [
        "How does it relate to GEO?",
        "AEO concerns answer selection broadly. GEO focuses in particular on discovery and citation in generative AI answers.",
      ],
      [
        "Writing in answer units",
        "Let one page answer one question completely. Explain terms when they first appear and give sources and dates for numbers. Tables and lists help both people and AI see the structure.",
      ],
      [
        "A simple example",
        "For 'How are GEO and SEO different?', give the short answer first, followed by evidence and relevant links.",
      ],
    ],
    faqs: [
      [
        "Is adding FAQ schema enough for AEO?",
        "No. Structured data is a supporting signal that describes visible questions and answers, and it does not guarantee visibility. The page itself must contain a sufficient answer.",
      ],
      [
        "Are shorter AEO pages better?",
        "No. Put the answer first and keep it short, but give enough evidence and context for people and AI to trust it.",
      ],
    ],
  },
  "ai-search-visibility": {
    title: "What is AI search visibility?",
    short:
      "A way to observe when and how AI answers mention, describe, or cite a brand.",
    lead: "AI search visibility describes how often a brand or piece of content appears in generative AI answers, and in what context and with which cited sources.",
    sections: [
      [
        "Key metrics",
        "You can examine mention rate, placement in the answer, description accuracy, cited sources, and variation by question. A mention with a wrong description does not help, however high the visibility.",
      ],
      [
        "Unit of measurement",
        "Build question sets by brand, product, or topic, then compare results under the same conditions across services, models, and dates.",
      ],
      [
        "Questions with and without the name",
        "A question that includes the brand name, such as 'What is X?', tests awareness. A question without the name, such as 'Recommend a service for this', tests whether you are a recommendation candidate. The two mean different things, so do not average them together.",
      ],
      [
        "Engines differ",
        "The same brand can get very different results across AI services. It is common to appear in a service that uses web search and not in one that uses only learned knowledge. Do not generalize from one service.",
      ],
      [
        "What to watch out for",
        "Do not judge visibility from one answer. Repeat measurements across questions, models, and time. Personalization such as chat history or memory can also affect results.",
      ],
      [
        "How does it relate to SEO?",
        "A high search ranking does not guarantee a mention in an AI answer. Track search visibility and AI-answer visibility separately.",
      ],
    ],
    faqs: [
      [
        "What should I check first if visibility is low?",
        "First check whether named questions are answered correctly. If not, fix name and description. If they are correct but you are missing from nameless questions, build outside sources and answer-style content.",
      ],
      [
        "How many measurements are enough?",
        "There is no fixed number, but repeat the same questions several times over several days. One result can be chance.",
      ],
    ],
  },
  "ai-citation": {
    title: "What is an AI citation?",
    short:
      "The source links an AI answer shows as evidence, and how they are chosen.",
    lead: "An AI citation is when a generative AI shows a specific web page as the source of its answer. It is different from a mention, where the brand name simply appears in the answer text.",
    sections: [
      [
        "Mention versus citation",
        "A mention is the brand name appearing in the answer. A citation is your page being linked as a source. A mention without a citation can mean the AI knows your brand through someone else's description.",
      ],
      [
        "What tends to be cited",
        "Pages that answer the question in the first paragraph, put sources next to claims, and show authorship and update dates tend to be chosen. A page that fully answers one question also helps. These are tendencies, not rules that guarantee citation.",
      ],
      [
        "When non-official sites are cited",
        "Blogs, wikis, news articles, and communities are often cited instead. Rather than only fixing the official site, check that these outside sources carry accurate information.",
      ],
      [
        "How do you measure it?",
        "Repeat the same question set, collect the cited addresses in each answer, and tally them by domain. Look at how often your domain appears and which outside domains are cited in your place.",
      ],
      [
        "Services cite differently",
        "Some services always show sources; others only do so with web search on. No source does not necessarily mean no mention.",
      ],
    ],
    faqs: [
      [
        "Do more links get more citations?",
        "Quality of the answer and evidence matters more than link count. Pages with clear sources, current information, and visible authorship are the baseline.",
      ],
      [
        "How do I know whether AI cited my page?",
        "Check the source cards or links in the answer, or collect cited addresses with a repeated-measurement tool. Server-log visits from that AI service's crawler are supporting evidence.",
      ],
    ],
  },
  "share-of-voice": {
    title: "What is AI share of voice?",
    short:
      "How often your brand is mentioned compared with competitors on the same questions.",
    lead: "AI share of voice is your brand's portion of all brand mentions in AI answers to the same question set. It shows relative position against competitors rather than absolute counts.",
    sections: [
      [
        "Why you need it",
        "Knowing only whether you were mentioned does not show the competitive picture. If competitors are recommended more often on the same questions, you may be losing opportunity even when you appear.",
      ],
      [
        "How to calculate it",
        "Fix a question set and collect answers per AI service. Extract the brands mentioned in each answer and divide your brand's mention count by all brand mentions. Keep the competitor list and question set fixed so periods can be compared.",
      ],
      [
        "Reading it carefully",
        "Changing the question set changes the share. A wider competitor list lowers your share. Watch change over time under the same basis rather than a single number.",
      ],
      [
        "Metrics to read alongside",
        "Order of mention, description accuracy, and cited sources.",
      ],
    ],
    faqs: [
      [
        "Is a low share always bad?",
        "No. On niche questions with little competition a low share may mean little. Break down which questions you lose.",
      ],
    ],
  },
  "brand-entity": {
    title: "What is a brand entity?",
    short:
      "The identity information that AI and search engines treat as one object.",
    lead: "An entity is the unit that search engines and AI bind together from a name, field, operator, and official site into one object. A clear brand entity keeps AI from confusing you with something else.",
    sections: [
      [
        "Why it matters",
        "AI separates objects by meaning rather than spelling. When several objects share a similar name, scattered information about you can mix with information about another.",
      ],
      [
        "What makes up an entity",
        "The official name and variants (native-language and English), a one-line description, the field, the operating organization, the main domain, official profile addresses, and the logo. This must be consistent across the site and outside profiles.",
      ],
      [
        "How to organize it",
        "1) Decide one sentence that describes the brand and use it everywhere. 2) Add Organization structured data with name, main domain, and logo. 3) Link only official profiles you actually run through sameAs. 4) Check that third-party sources such as news and directories show the same name and description.",
      ],
      [
        "What not to do",
        "Adding unverified awards, customers, or results, or linking accounts you do not operate as official profiles, hurts trust. Use only information you can confirm.",
      ],
      [
        "Managing name variants",
        "If the brand is written in two scripts, repeat a sentence that connects them in one place, such as 'Native name (English name)'.",
      ],
    ],
    faqs: [
      [
        "Do I need a Wikidata or Wikipedia entry?",
        "Not required. Listings need independent third-party sources, so it is better to build outside sources such as news and directories first.",
      ],
      [
        "When do results show?",
        "Search engines and AI must recollect the information, so it usually takes several weeks or more. Confirm change through repeated measurement.",
      ],
    ],
  },
  "brand-name-collision": {
    title: "What is a brand name collision?",
    short: "When other services share your name and AI cannot tell you apart.",
    lead: "A brand name collision happens when a name is a common word or other services use the same name, and search engines and AI cannot tell your brand from another.",
    sections: [
      [
        "How it appears",
        "Searching the name alone shows hotels, other companies, or other services first, or an AI describes another object and says it does not know you. It is worse when a same-name service exists in the same field.",
      ],
      [
        "What to check first",
        "Search the name alone, name plus field, name plus domain, the native-script spelling, and the English spelling, and record the top results. A brand pushed down by name alone often appears well once a field or domain is added.",
      ],
      [
        "How to respond",
        "1) Use an expression that attaches the field to the name consistently on the first screen, in the introduction, and in profiles. 2) Show both spellings in one sentence. 3) Put name, main domain, and official profiles in Organization structured data. 4) Do this cleanup before considering a rename.",
      ],
      [
        "A caution",
        "Do not disparage other services or imitate their names. The goal is to state clearly and truthfully who you are.",
      ],
    ],
    faqs: [
      [
        "Should I rename the brand?",
        "Usually not. Attaching field, domain, and operator consistently costs far less. A rename is the last resort.",
      ],
    ],
  },
  "structured-data": {
    title: "What is structured data (JSON-LD)?",
    short: "Code that marks up a page's meaning so machines can read it.",
    lead: "Structured data is code written in a standard format that tells search engines and AI exactly what the information on a page is, such as an organization, an article, a product, or questions and answers. The most common format is JSON-LD, using the schema.org vocabulary.",
    sections: [
      [
        "What it tells machines",
        "Whether the page is an article, who wrote it, when it was updated, and what the company is, in a form machines can read, separate from what people see on screen.",
      ],
      [
        "Common types",
        "Organization, WebSite, Article, BreadcrumbList, FAQPage, DefinedTerm, and Dataset.",
      ],
      [
        "Principles to keep",
        "The content must match what is actually visible on the page. Numbers or awards that do not appear on screen, or accounts that do not exist, cost trust. Syntax errors make it unreadable, so check it with a validator.",
      ],
      [
        "Limits",
        "Structured data is a supporting signal and does not guarantee indexing or visibility. Some types, such as FAQ, have limited special display in search results. Body quality comes first.",
      ],
      [
        "Where it helps most",
        "Brand entity cleanup (Organization name, url, logo, sameAs) and article pages (Article author and dates).",
      ],
    ],
    faqs: [
      [
        "Will structured data put me in AI answers?",
        "It is not guaranteed. It helps AI and search engines understand the brand and the article more accurately.",
      ],
      [
        "How do I validate it?",
        "Check syntax with Google's Rich Results Test and the schema.org validator, and have a person compare it with the visible page.",
      ],
    ],
  },
  "llms-txt": {
    title: "What is llms.txt?",
    short: "A text file that points AI to a site's key pages.",
    lead: "llms.txt is a proposed convention: a text file at a site's root that summarizes, in a human-readable format, the description and main page links an AI might read first when understanding the site.",
    sections: [
      [
        "What it contains",
        "A short introduction to the service, the operator, links to key pages, and a one-line description of each. It uses Markdown, so people can read it too.",
      ],
      [
        "How is it different from robots.txt?",
        "robots.txt tells crawlers where they may go; llms.txt suggests what to look at first. The roles differ and neither replaces the other.",
      ],
      [
        "A realistic view of the effect",
        "llms.txt is not an official standard, and the major search and AI services have not officially confirmed using it as a basis. Do not expect that adding it puts you in AI answers. It is easy to make and harmless, so keep it as a supporting measure.",
      ],
      [
        "How to write it",
        "State only facts, without exaggeration. Include only links that actually open and update them when things change. Put the official introduction and fact document, such as operator and product scope, first.",
      ],
    ],
    faqs: [
      [
        "Is there a penalty for not having llms.txt?",
        "No known penalty. The page body, structured data, and outside sources matter far more.",
      ],
    ],
  },
  "ai-crawlers": {
    title: "What are AI crawlers?",
    short:
      "The bots AI services use to read pages, and how to allow or block them.",
    lead: "AI crawlers are automated programs AI services use to read web pages. Many services split names by purpose, such as training, search results, and user requests, and permission is set in robots.txt.",
    sections: [
      [
        "Common examples",
        "OpenAI distinguishes GPTBot for model training, OAI-SearchBot for ChatGPT search, and ChatGPT-User for visits triggered by a user request. Anthropic uses ClaudeBot and others, and Perplexity uses PerplexityBot and others. Names and purposes can change, so each company's official documentation is the reference.",
      ],
      [
        "What to decide",
        "For a brand to appear in AI search answers, the search crawler must be able to read public pages. Whether to allow training collection is a separate policy decision. Block post-login screens, payments, and private result pages.",
      ],
      [
        "How to check access",
        "Confirm that robots.txt does not block the crawler, that firewalls and bot protection do not block legitimate crawlers, and that the server responds with 200. Requests that only copy a name must be told apart from the real service by IP range.",
      ],
      [
        "Access does not guarantee visibility",
        "Being allowed is only a requirement. Whether a page is used in an answer after being read depends on its quality, sources, and relevance to the question.",
      ],
    ],
    faqs: [
      [
        "Does blocking AI crawlers lower search rankings?",
        "Regular search crawlers and AI crawlers are separate. If you want to appear in AI search answers, take care not to block that service's search crawler.",
      ],
      [
        "What do I look at in server logs?",
        "Whether that AI crawler visited, the response code, and the addresses visited. A match between cited addresses and visit records is strong evidence.",
      ],
    ],
  },
  eeat: {
    title: "What is E-E-A-T?",
    short:
      "A way of judging content quality by experience, expertise, authority, and trust.",
    lead: "E-E-A-T stands for Experience, Expertise, Authoritativeness, and Trustworthiness, a lens Google uses to evaluate content quality. It is closer to a framework for judging quality than a direct ranking formula.",
    sections: [
      [
        "The four elements",
        "Experience is evidence of having done it, expertise is deep understanding of the topic, authority is recognition in the field, and trust is being accurate, transparent, and reliable. Trust is described as the most important.",
      ],
      [
        "How to show it on a page",
        "Name the author and operator, give update dates, attach sources to claims, and publish contact and business information. Publishing measured data and methods shows experience and expertise together.",
      ],
      [
        "Relation to AI citation",
        "Which sources an AI relies on is not public. Still, a page with clear sources and a visible author is easier to trust for both people and machines.",
      ],
      [
        "Common mistakes",
        "Superlatives without evidence, unverified awards or customers, and articles with no visible author reduce trust.",
      ],
    ],
    faqs: [
      [
        "Is there an E-E-A-T score?",
        "No. It is a lens used in quality evaluation, not a single score.",
      ],
    ],
  },
  "naver-ai-briefing": {
    title: "What is Naver AI Briefing?",
    short:
      "Naver's feature where generative AI shows a summary answer above search results.",
    lead: "Naver AI Briefing is a Naver Search feature where generative AI shows a summary answer to a question and displays the sources behind it. In Korea it is a surface to check separately from overseas services such as ChatGPT.",
    sections: [
      [
        "Why look at it separately",
        "Many Korean users search on Naver first. A brand that appears well in overseas AI services may still see different sources chosen in Naver AI Briefing.",
      ],
      [
        "Which sources appear",
        "Naver AI Briefing can show content inside Naver, such as blogs, cafes, and Knowledge iN, together with outside websites. It varies by question, and the criteria Naver has published are the reference for which sources are chosen.",
      ],
      [
        "What to prepare",
        "Register the official site in Naver Search Advisor and submit a sitemap and RSS. Publish pages that answer questions directly and make sure brand information is accurate inside Naver too.",
      ],
      [
        "How do you measure it?",
        "Search the same questions on Naver repeatedly and record whether AI Briefing appears, whether the brand is mentioned, and which sources are used. AI Briefing does not appear for every question.",
      ],
      [
        "At Findable",
        "Findable measures Naver AI Briefing, Naver, and Daum search visibility with the same questions alongside ChatGPT, Claude, Perplexity, and Gemini.",
      ],
    ],
    faqs: [
      [
        "Does Naver AI Briefing appear for every search?",
        "No. It may not appear depending on the question, so record whether it appears at all.",
      ],
    ],
  },
};
