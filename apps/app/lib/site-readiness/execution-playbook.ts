import type {
  ReadinessCheck,
  ReadinessCheckId,
  ReadinessSeverity,
  SiteFindingCode,
  SiteReadinessFinding,
  SiteReadinessReport,
} from "./types";

export interface SiteReadinessTask {
  affectedCount: number;
  code: string | null;
  evidence: string;
  id: string;
  location: string;
  sampleUrls: string[];
  severity: ReadinessSeverity;
  snippet: string | null;
  steps: string[];
  title: string;
  verification: string;
  why: string;
}

type Guide = Omit<
  SiteReadinessTask,
  "affectedCount" | "evidence" | "id" | "sampleUrls" | "severity"
>;

const findingSeverityOrder: Record<ReadinessSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const findingToCheck: Partial<Record<SiteFindingCode, ReadinessCheckId>> = {
  canonical_missing: "canonical",
  h1_missing: "h1",
  non_2xx: "status",
  schema_invalid: "jsonLd",
  schema_required_missing: "jsonLd",
  title_missing: "title",
};

function originOf(report: SiteReadinessReport): string {
  try {
    return new URL(report.finalUrl).origin;
  } catch {
    return report.finalUrl;
  }
}

function pathOf(value: string): string {
  try {
    const url = new URL(value);
    return `${url.pathname}${url.search}` || "/";
  } catch {
    return value;
  }
}

function findingGuide(
  code: SiteFindingCode,
  origin: string,
  sampleUrl: string | undefined,
  isKo: boolean
): Guide {
  const pageUrl = sampleUrl ?? origin;
  const path = pathOf(pageUrl);
  const ko: Record<SiteFindingCode, Guide> = {
    non_2xx: {
      code,
      title: "정상 응답이 아닌 페이지 복구",
      location: `${path}의 서버·라우팅·리디렉션 설정`,
      why: "검색 엔진과 AI 크롤러가 본문을 읽지 못하면 색인과 인용 후보에서 빠집니다.",
      steps: [
        "해당 URL을 직접 열어 실제 오류 또는 리디렉션 목적지를 확인합니다.",
        "삭제한 페이지라면 가장 가까운 대체 페이지로 301 이동하고, 유지할 페이지라면 200 응답을 복구합니다.",
        "사이트맵과 내부 링크를 최종 정상 URL로 교체합니다.",
      ],
      snippet: `# 기대 응답\ncurl -I ${pageUrl}\n# HTTP/2 200  또는 의도한 301`,
      verification:
        "재실측에서 해당 URL이 HTTP 2xx 또는 의도한 단일 301로 표시되면 완료입니다.",
    },
    noindex: {
      code,
      title: "의도하지 않은 색인 차단 해제",
      location: `${path}의 <head> 또는 X-Robots-Tag 응답 헤더`,
      why: "noindex가 있으면 공개 페이지라도 검색 결과와 AI 검색의 검색 경유 후보에서 제외됩니다.",
      steps: [
        "이 페이지가 공개 검색 대상인지 먼저 확인합니다.",
        "공개 대상이면 meta robots의 noindex와 서버의 X-Robots-Tag: noindex를 제거합니다.",
        "robots.txt에서 같은 경로를 차단하지 않는지도 확인합니다.",
      ],
      snippet: `<meta name="robots" content="index,follow" />`,
      verification: "재실측의 ‘색인 가능’ 열이 ‘예’로 바뀌면 완료입니다.",
    },
    canonical_missing: {
      code,
      title: "대표 URL(Canonical) 선언",
      location: `${path}의 <head>`,
      why: "같은 콘텐츠의 여러 주소가 경쟁하지 않도록 검색 엔진에 대표 주소를 명확히 알려야 합니다.",
      steps: [
        "쿼리·언어·www·슬래시 정책을 반영한 최종 대표 URL을 정합니다.",
        "페이지 head에 자기 자신을 가리키는 canonical을 추가합니다.",
        "사이트맵과 내부 링크도 같은 대표 URL을 사용합니다.",
      ],
      snippet: `<link rel="canonical" href="${pageUrl}" />`,
      verification: "재실측에서 Canonical 일치가 ‘예’로 표시되면 완료입니다.",
    },
    canonical_mismatch: {
      code,
      title: "잘못된 Canonical 교정",
      location: `${path}의 <head>와 사이트맵`,
      why: "다른 페이지를 대표 주소로 선언하면 현재 페이지의 평가와 색인 신호가 엉뚱한 URL로 합쳐질 수 있습니다.",
      steps: [
        "현재 canonical이 가리키는 URL과 실제 최종 URL을 비교합니다.",
        "중복 페이지가 아니라면 자기 자신을 가리키도록 수정합니다.",
        "중복 페이지라면 사이트맵에서 제거하고 내부 링크를 대표 URL로 통일합니다.",
      ],
      snippet: `<link rel="canonical" href="${pageUrl}" />`,
      verification:
        "재실측에서 Canonical 일치가 ‘예’가 되고 중복 URL이 사이트맵에서 사라지면 완료입니다.",
    },
    schema_invalid: {
      code,
      title: "JSON-LD 문법 오류 수정",
      location: `${path}의 application/ld+json 스크립트`,
      why: "파싱할 수 없는 구조화 데이터는 검색 엔진이 엔티티와 콘텐츠 유형을 이해하는 데 사용할 수 없습니다.",
      steps: [
        "JSON의 마지막 쉼표, 따옴표, 중괄호 오류를 수정합니다.",
        "페이지에 실제 표시된 정보만 구조화 데이터에 남깁니다.",
        "Google Rich Results Test와 Schema.org Validator에서 다시 검증합니다.",
      ],
      snippet: `<script type="application/ld+json">\n{\n  "@context": "https://schema.org",\n  "@type": "WebPage",\n  "url": "${pageUrl}"\n}\n</script>`,
      verification:
        "재실측에서 invalid block이 0이고 구조화 데이터 유형이 표시되면 완료입니다.",
    },
    schema_required_missing: {
      code,
      title: "구조화 데이터 필수 속성 보강",
      location: `${path}의 JSON-LD`,
      why: "유형만 선언하고 필수 정보가 빠지면 검색 엔진이 해당 엔티티를 신뢰하거나 기능에 활용하기 어렵습니다.",
      steps: [
        "진단 근거에 표시된 누락 속성을 확인합니다.",
        "페이지에 실제 보이는 이름·URL·저자·발행일 등의 값으로 채웁니다.",
        "JSON-LD와 화면 내용이 서로 다른 주장을 하지 않는지 대조합니다.",
      ],
      snippet: `<script type="application/ld+json">\n{\n  "@context": "https://schema.org",\n  "@type": "Organization",\n  "name": "회사명",\n  "url": "${origin}"\n}\n</script>`,
      verification: "재실측에서 missing required 목록이 사라지면 완료입니다.",
    },
    title_missing: {
      code,
      title: "고유한 페이지 제목 추가",
      location: `${path}의 <head>`,
      why: "title은 검색 결과와 AI가 페이지 주제를 식별하는 가장 기본적인 신호입니다.",
      steps: [
        "이 페이지가 답하는 핵심 주제를 한 문장으로 정합니다.",
        "핵심 주제와 브랜드를 포함한 고유 title을 70자 이내로 작성합니다.",
        "다른 페이지와 같은 title이 없는지 확인합니다.",
      ],
      snippet: "<title>페이지 핵심 주제 | 브랜드명</title>",
      verification:
        "재실측에서 페이지 제목이 통과로 표시되고 실제 제목이 근거에 나타나면 완료입니다.",
    },
    h1_missing: {
      code,
      title: "대표 H1 추가",
      location: `${path}의 본문 첫 제목`,
      why: "H1은 방문자와 크롤러가 페이지의 주제를 빠르게 파악하는 대표 제목입니다.",
      steps: [
        "페이지가 직접 답하는 내용을 한 문장으로 정합니다.",
        "보이는 본문에 H1을 하나 추가합니다.",
        "로고나 숨김 텍스트가 별도 H1으로 남아 있지 않은지 확인합니다.",
      ],
      snippet: "<main>\n  <h1>이 페이지가 답하는 핵심 주제</h1>\n</main>",
      verification: "재실측에서 H1이 1개로 표시되면 완료입니다.",
    },
    broken_internal_link: {
      code,
      title: "깨진 내부 링크 복구",
      location: `${path}에서 연결된 내부 링크`,
      why: "깨진 링크는 사용자 흐름과 크롤러의 사이트 탐색을 동시에 끊습니다.",
      steps: [
        "오류 URL을 참조하는 링크 위치를 찾습니다.",
        "정상 페이지로 URL을 교체하거나 삭제된 URL에 적절한 301을 설정합니다.",
        "사이트맵에도 오래된 주소가 남아 있지 않은지 확인합니다.",
      ],
      snippet: `<a href="${origin}/정상-페이지">정확한 링크 설명</a>`,
      verification:
        "링크 대상이 HTTP 200을 반환하고 다음 재실측에서 문제가 사라지면 완료입니다.",
    },
    thin_article_content: {
      code,
      title: "짧은 아티클에 직접 답변과 근거 보강",
      location: `${path}의 본문`,
      why: "근거와 세부 내용이 부족하면 검색 엔진과 AI가 독립적으로 인용할 만한 답을 찾기 어렵습니다.",
      steps: [
        "첫 문단에 질문에 대한 직접 답변을 작성합니다.",
        "실제 사례·수치·방법·한계를 소제목별로 보강합니다.",
        "검증 가능한 수치에는 원문 출처를 연결합니다.",
      ],
      snippet:
        "<article>\n  <h1>사용자가 묻는 질문</h1>\n  <p><strong>결론:</strong> 질문에 대한 직접 답변…</p>\n  <h2>근거와 실제 사례</h2>\n</article>",
      verification:
        "재실측에서 짧은 아티클 경고가 사라지고 서버 HTML에 보강한 본문이 잡히면 완료입니다.",
    },
    citation_sources_missing: {
      code,
      title: "통계·주장의 원문 출처 연결",
      location: `${path}의 통계·연구·공식 정보 문장`,
      why: "원문 출처는 독자와 AI가 주장을 검증하고 인용할 수 있게 만드는 신뢰 신호입니다.",
      steps: [
        "통계·연구·정책처럼 검증이 필요한 문장을 표시합니다.",
        "요약 글이 아닌 최초 발행 기관의 원문 URL을 연결합니다.",
        "출처명과 조사 시점 또는 발행일을 함께 적습니다.",
      ],
      snippet: `<p>조사 결과 …로 나타났습니다. <a href="https://원문-출처" rel="noopener">원문 출처</a></p>`,
      verification:
        "재실측에서 외부 근거 링크가 발견되고 경고가 사라지면 완료입니다.",
    },
    author_signal_missing: {
      code,
      title: "저자·발행일 신호 추가",
      location: `${path}의 아티클 헤더와 Article JSON-LD`,
      why: "누가 언제 작성했는지 보여주면 콘텐츠의 책임 주체와 최신성을 검증할 수 있습니다.",
      steps: [
        "실제 저자 이름과 확인 가능한 프로필 링크를 표시합니다.",
        "최초 발행일과 수정일을 time datetime으로 제공합니다.",
        "Article JSON-LD의 author·datePublished·dateModified와 같은 값으로 맞춥니다.",
      ],
      snippet: `<p>작성자 <a rel="author" href="/authors/name">이름</a></p>\n<time datetime="2026-08-28">2026년 8월 28일</time>`,
      verification: "재실측에서 저자와 발행일 신호가 모두 확인되면 완료입니다.",
    },
    slow_ttfb: {
      code,
      title: "첫 응답 시간을 800ms 이하로 단축",
      location: `${path}의 CDN·캐시·서버 렌더링·DB 쿼리`,
      why: "느린 TTFB는 사용자와 크롤러 모두가 본문을 받기까지 기다리는 시간을 늘립니다.",
      steps: [
        "서버 로그에서 가장 오래 걸리는 쿼리와 외부 API 호출을 찾습니다.",
        "공개 페이지에 CDN·페이지 캐시를 적용하고 요청마다 반복되는 작업을 줄입니다.",
        "개선 전후를 같은 URL과 지역에서 여러 번 측정합니다.",
      ],
      snippet:
        "Cache-Control: public, s-maxage=3600, stale-while-revalidate=86400",
      verification:
        "재실측 TTFB가 800ms 이하이고 반복 측정에서도 안정적으로 유지되면 완료입니다.",
    },
    slow_response: {
      code,
      title: "전체 HTML 응답을 2.5초 이하로 단축",
      location: `${path}의 서버 렌더링·HTML 페이로드·외부 호출`,
      why: "전체 응답이 늦으면 크롤러가 제한된 시간 안에 콘텐츠를 읽지 못하고 사용자 이탈도 늘어납니다.",
      steps: [
        "서버 렌더링 중 직렬로 실행되는 데이터 요청을 병렬화합니다.",
        "초기 HTML에 불필요한 데이터와 중복 마크업을 줄입니다.",
        "비핵심 위젯과 서드파티 스크립트는 본문 이후에 불러옵니다.",
      ],
      snippet:
        "// 독립 요청은 병렬 실행\nconst [page, navigation] = await Promise.all([getPage(), getNavigation()]);",
      verification: "재실측 전체 HTML 응답이 2.5초 이하로 표시되면 완료입니다.",
    },
  };

  if (isKo) {
    return ko[code];
  }
  const base = ko[code];
  return {
    ...base,
    title: base.title,
    location: base.location,
    why: base.why,
    steps: base.steps,
    verification: base.verification,
  };
}

function checkGuide(
  check: ReadinessCheck,
  origin: string,
  isKo: boolean
): Guide {
  const common = (guide: Guide) => guide;
  const guides: Record<ReadinessCheckId, Guide> = {
    https: common({
      code: check.id,
      title: "HTTPS 연결 통일",
      location: "도메인 SSL 인증서와 HTTP 리디렉션 설정",
      why: "보안 연결은 검색 색인과 사용자 신뢰의 기본 조건입니다.",
      steps: [
        "유효한 TLS 인증서를 설치합니다.",
        "HTTP 요청을 같은 HTTPS URL로 301 이동합니다.",
        "내부 링크와 사이트맵을 HTTPS로 통일합니다.",
      ],
      snippet: `# 기대 동작\nhttp://${new URL(origin).host} → 301 → ${origin}`,
      verification: "재실측 최종 URL이 HTTPS이고 항목이 통과하면 완료입니다.",
    }),
    status: findingGuide("non_2xx", origin, origin, isKo),
    robots: common({
      code: check.id,
      title: "robots.txt 접근 정책 교정",
      location: `${origin}/robots.txt`,
      why: "잘못된 차단 규칙은 검색 엔진과 AI 크롤러가 공개 콘텐츠를 읽지 못하게 합니다.",
      steps: [
        "robots.txt가 HTTP 200인지 확인합니다.",
        "핵심 공개 경로를 막는 Disallow 규칙을 제거합니다.",
        "사이트맵 URL을 선언합니다.",
      ],
      snippet: `User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml`,
      verification:
        "재실측에서 robots.txt가 통과하고 공개 경로가 허용되면 완료입니다.",
    }),
    aiBots: common({
      code: check.id,
      title: "주요 AI 봇 접근 정책 결정",
      location: `${origin}/robots.txt`,
      why: "AI 검색 노출이 목표라면 검색·인용에 필요한 봇이 핵심 페이지를 읽을 수 있어야 합니다.",
      steps: [
        "조직의 AI 크롤링 정책을 먼저 결정합니다.",
        "허용할 봇에 핵심 경로를 개방합니다.",
        "개인·유료·관리자 경로는 별도로 차단합니다.",
      ],
      snippet:
        "User-agent: OAI-SearchBot\nAllow: /\n\nUser-agent: PerplexityBot\nAllow: /",
      verification: "재실측에서 의도한 봇이 allowed로 표시되면 완료입니다.",
    }),
    sitemap: common({
      code: check.id,
      title: "XML 사이트맵 복구",
      location: `${origin}/sitemap.xml 및 robots.txt`,
      why: "사이트맵은 크롤러가 대표 공개 URL을 빠짐없이 발견하도록 돕습니다.",
      steps: [
        "색인할 canonical URL만 포함한 XML 사이트맵을 생성합니다.",
        "오류·리디렉션·noindex URL을 제외합니다.",
        "robots.txt와 검색 도구에 사이트맵을 등록합니다.",
      ],
      snippet: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${origin}/</loc></url>\n</urlset>`,
      verification:
        "재실측에서 사이트맵 URL과 발견 페이지 수가 표시되면 완료입니다.",
    }),
    title: findingGuide("title_missing", origin, origin, isKo),
    description: common({
      code: check.id,
      title:
        check.evidence === "missing"
          ? "메타 설명 추가"
          : "메타 설명 길이·내용 개선",
      location: "홈페이지 <head>",
      why: "메타 설명은 검색 결과에서 페이지의 답과 가치를 설명하며 클릭 판단을 돕습니다.",
      steps: [
        "대상 고객과 페이지가 제공하는 답을 한 문장으로 정합니다.",
        "브랜드명과 구체적인 가치를 포함해 약 50~180자로 작성합니다.",
        "페이지마다 고유한 설명을 사용합니다.",
      ],
      snippet: `<meta name="description" content="누구에게 어떤 문제를 어떻게 해결하는지 구체적으로 설명합니다." />`,
      verification:
        "재실측에서 실제 글자 수가 표시되고 메타 설명이 통과하면 완료입니다.",
    }),
    h1: common({
      code: check.id,
      title: check.evidence.startsWith("0 ")
        ? "대표 H1 추가"
        : "대표 H1 하나로 통일",
      location: "홈페이지의 본문 제목 구조",
      why: "대표 제목이 없거나 여러 개면 페이지의 핵심 주제가 모호해집니다.",
      steps: [
        "페이지의 핵심 주제를 나타내는 제목 하나를 H1으로 정합니다.",
        "나머지 큰 제목은 H2·H3 또는 일반 요소로 바꿉니다.",
        "보이는 문구와 HTML 제목 계층을 일치시킵니다.",
      ],
      snippet:
        "<main>\n  <h1>이 사이트가 해결하는 핵심 문제</h1>\n  <section><h2>주요 서비스</h2></section>\n</main>",
      verification: "재실측에서 ‘1 H1’이 확인되면 완료입니다.",
    }),
    canonical: findingGuide("canonical_missing", origin, origin, isKo),
    jsonLd: common({
      code: check.id,
      title: check.evidence.startsWith("0 ")
        ? "Organization JSON-LD 추가"
        : "JSON-LD 유효성 수정",
      location: "홈페이지 <head> 또는 본문 하단의 application/ld+json",
      why: "구조화 데이터는 회사명·공식 URL·콘텐츠 유형의 관계를 기계가 명확하게 이해하도록 돕습니다.",
      steps: [
        "페이지에 실제 표시된 회사명과 공식 URL을 확인합니다.",
        "Organization 또는 실제 콘텐츠 유형의 JSON-LD를 추가합니다.",
        "Schema.org Validator에서 문법과 필수 속성을 확인합니다.",
      ],
      snippet: `<script type="application/ld+json">\n{\n  "@context": "https://schema.org",\n  "@type": "Organization",\n  "name": "회사명",\n  "url": "${origin}"\n}\n</script>`,
      verification:
        "재실측에서 JSON-LD block과 유형이 표시되고 invalid가 없으면 완료입니다.",
    }),
    serverContent: common({
      code: check.id,
      title: "서버 HTML에 핵심 본문 제공",
      location: "초기 서버 응답 HTML",
      why: "JavaScript 실행 전에도 핵심 설명이 있어야 다양한 크롤러가 안정적으로 내용을 읽습니다.",
      steps: [
        "페이지 소스에서 핵심 제목과 설명이 보이는지 확인합니다.",
        "핵심 콘텐츠를 서버 렌더링 또는 정적 생성으로 제공합니다.",
        "클라이언트 전용 위젯만 지연 로드합니다.",
      ],
      snippet:
        "<main>\n  <h1>핵심 제목</h1>\n  <p>서비스가 제공하는 구체적인 답변…</p>\n</main>",
      verification:
        "재실측의 서버 HTML 본문이 통과하고 visible chars가 증가하면 완료입니다.",
    }),
    semanticHtml: common({
      code: check.id,
      title: "의미 있는 HTML 구조 추가",
      location: "홈페이지의 레이아웃과 콘텐츠 컴포넌트",
      why: "main·article·heading 구조는 탐색 영역과 실제 본문을 기계가 구분하도록 돕습니다.",
      steps: [
        "페이지 핵심 콘텐츠를 main 하나로 감쌉니다.",
        "독립 콘텐츠는 article, 주제 구간은 section으로 구분합니다.",
        "H1→H2→H3 순서가 건너뛰지 않도록 정리합니다.",
      ],
      snippet:
        "<main>\n  <article>\n    <h1>대표 제목</h1>\n    <section><h2>세부 주제</h2></section>\n  </article>\n</main>",
      verification: "재실측에서 main/article found로 표시되면 완료입니다.",
    }),
    trustLinks: common({
      code: check.id,
      title: "회사·정책·연락처 신뢰 링크 보강",
      location: "전역 내비게이션 또는 푸터",
      why: "운영 주체와 정책을 확인할 수 있어야 사용자와 검색 시스템이 사이트의 책임성을 판단할 수 있습니다.",
      steps: [
        "회사 소개와 실제 연락처 페이지를 연결합니다.",
        "개인정보처리방침과 이용약관을 공개합니다.",
        "푸터에서 모든 페이지가 해당 링크에 접근할 수 있게 합니다.",
      ],
      snippet: `<footer>\n  <a href="/about">회사 소개</a>\n  <a href="/contact">문의</a>\n  <a href="/privacy">개인정보처리방침</a>\n</footer>`,
      verification:
        "재실측에서 trust links가 2개 이상이고 항목이 통과하면 완료입니다.",
    }),
    freshness: common({
      code: check.id,
      title: "발행·수정 시각을 기계가 읽게 표시",
      location: "최신성이 중요한 아티클과 time·Article JSON-LD",
      why: "명확한 날짜는 독자와 검색 시스템이 정보의 최신성을 판단하는 근거가 됩니다.",
      steps: [
        "독자가 볼 수 있는 발행일과 수정일을 표시합니다.",
        "time 요소의 datetime에 ISO 날짜를 넣습니다.",
        "Article JSON-LD의 날짜와 화면 값을 일치시킵니다.",
      ],
      snippet: `<time datetime="2026-08-28">2026년 8월 28일 수정</time>`,
      verification: "재실측에서 machine-readable date가 발견되면 완료입니다.",
    }),
    llmsTxt: common({
      code: check.id,
      title: "llms.txt는 선택 사항으로 유지",
      location: `${origin}/llms.txt`,
      why: "아직 보편적인 표준이나 AI 노출 보장 수단이 아니므로 핵심 SEO 작업보다 우선하지 않습니다.",
      steps: [
        "필수 작업으로 취급하지 않습니다.",
        "제공한다면 핵심 공개 문서 링크만 사실대로 정리합니다.",
        "robots·sitemap·본문 품질을 먼저 개선합니다.",
      ],
      snippet: null,
      verification: "정보성 항목이므로 완료 점수에는 영향을 주지 않습니다.",
    }),
  };
  return guides[check.id];
}

function performanceTasks(report: SiteReadinessReport): SiteReadinessTask[] {
  const pageSpeed = report.performance?.pageSpeed;
  if (!pageSpeed) {
    return [];
  }
  const tasks: SiteReadinessTask[] = [];
  const metrics = [
    {
      id: "lcp",
      metric: pageSpeed.lcpMs,
      title: "LCP를 2.5초 이하로 단축",
      why: "가장 큰 핵심 콘텐츠가 늦게 보이면 사용자가 페이지를 느리다고 느끼고 모바일 성능 평가도 낮아집니다.",
      steps: [
        "LCP 요소가 이미지인지 텍스트인지 Lighthouse에서 확인합니다.",
        "대표 이미지를 압축·리사이즈하고 preload 또는 높은 fetch priority를 적용합니다.",
        "렌더링을 막는 CSS·JavaScript와 서드파티 스크립트를 줄입니다.",
      ],
      snippet: `<link rel="preload" as="image" href="/hero.webp" />\n<img src="/hero.webp" width="1200" height="630" fetchpriority="high" alt="구체적인 이미지 설명" />`,
      verify: "재실측 LCP가 2.5초 이하이고 good으로 표시되면 완료입니다.",
    },
    {
      id: "inp",
      metric: pageSpeed.inpMs,
      title: "INP를 200ms 이하로 단축",
      why: "클릭과 입력에 늦게 반응하면 실제 사용성이 떨어집니다.",
      steps: [
        "긴 JavaScript 작업을 50ms 이하 단위로 나눕니다.",
        "입력 이벤트에서 무거운 계산과 동기 네트워크 작업을 제거합니다.",
        "사용하지 않는 클라이언트 JavaScript를 줄입니다.",
      ],
      snippet: `button.addEventListener("click", () => {\n  requestAnimationFrame(() => updateUI());\n});`,
      verify: "실사용자 INP가 200ms 이하이고 good으로 표시되면 완료입니다.",
    },
    {
      id: "cls",
      metric: pageSpeed.cls,
      title: "CLS를 0.1 이하로 안정화",
      why: "콘텐츠가 갑자기 밀리면 오클릭과 읽기 방해가 발생합니다.",
      steps: [
        "이미지와 iframe에 width·height 또는 aspect-ratio를 지정합니다.",
        "광고·배너·비동기 콘텐츠의 공간을 미리 예약합니다.",
        "웹폰트 교체로 인한 글자 폭 변화를 줄입니다.",
      ],
      snippet: `<img src="/image.webp" width="800" height="450" alt="구체적인 이미지 설명" />`,
      verify: "재실측 CLS가 0.1 이하이고 good으로 표시되면 완료입니다.",
    },
  ];
  for (const item of metrics) {
    if (!["poor", "needs-improvement"].includes(item.metric.rating)) {
      continue;
    }
    tasks.push({
      affectedCount: 1,
      code: item.id,
      evidence:
        item.metric.value == null
          ? "측정값 없음"
          : `${item.metric.value}${item.id === "cls" ? "" : "ms"}`,
      id: `performance:${item.id}`,
      location: `${originOf(report)}의 모바일 렌더링 경로`,
      sampleUrls: [report.finalUrl],
      severity: item.metric.rating === "poor" ? "high" : "medium",
      snippet: item.snippet,
      steps: item.steps,
      title: item.title,
      verification: item.verify,
      why: item.why,
    });
  }
  return tasks;
}

export function buildSiteReadinessTasks(
  report: SiteReadinessReport,
  locale = "ko-KR"
): SiteReadinessTask[] {
  const isKo = locale.startsWith("ko");
  const origin = originOf(report);
  const findings = report.findings ?? [];
  const coveredChecks = new Set(
    findings.map((finding) => findingToCheck[finding.code]).filter(Boolean)
  );
  const findingTasks = findings.map(
    (finding: SiteReadinessFinding): SiteReadinessTask => {
      const guide = findingGuide(
        finding.code,
        origin,
        finding.sampleUrls[0],
        isKo
      );
      return {
        ...guide,
        affectedCount: finding.affectedCount,
        evidence: finding.evidence,
        id: `finding:${finding.code}`,
        sampleUrls: finding.sampleUrls,
        severity: finding.severity,
      };
    }
  );
  const checkTasks = report.checks
    .filter(
      (check) =>
        (check.status === "fail" || check.status === "warning") &&
        !coveredChecks.has(check.id)
    )
    .map((check): SiteReadinessTask => {
      const guide = checkGuide(check, origin, isKo);
      return {
        ...guide,
        affectedCount: 1,
        evidence: check.evidence,
        id: `check:${check.id}`,
        sampleUrls: [report.finalUrl],
        severity: check.status === "fail" ? "high" : "medium",
      };
    });

  return [...findingTasks, ...checkTasks, ...performanceTasks(report)].sort(
    (left, right) =>
      findingSeverityOrder[left.severity] - findingSeverityOrder[right.severity]
  );
}
