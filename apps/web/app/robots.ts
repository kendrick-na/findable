import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { env } from "@/env";

/**
 * robots.txt — 크롤러 규칙 + sitemap 위치 안내.
 *
 * 🔴 **왜 `app/` 루트로 옮겼나**(2026-08-08): 원래 `app/[locale]/robots.ts` 였고,
 *   그래서 `/robots.txt` 가 실측 **404**(`noindex` 달린 HTML 404 페이지)였다.
 *   robots.txt 가 없으면 sitemap 위치를 알릴 수단이 사라진다.
 *   sitemap·robots 는 사이트에 하나뿐인 표준 파일이라 로케일 아래 두면 안 된다.
 *
 * ⚠️ 개인 진단 결과(`/audit/<jobId>`)는 색인 대상이 아니다 — jobId 가 secret 역할을 하는
 *   **비로그인 공개 링크**라서, 크롤링되면 남의 진단이 검색에 노출될 수 있다.
 *   (공유는 본인이 링크를 건네는 방식이고, 검색 유입 대상이 아니다.)
 *
 * 🟡 **`/audit` 는 계속 허용한다 — 단 「핵심 랜딩」은 더 이상 아니다**(2026-08-19 · 👤 결정 A).
 *   무료 진단은 **동선에서 뺐다**: 랜딩 CTA 는 전부 `/sign-up`(가입=트라이얼)으로 가고,
 *   *"무료로 진단받기"* 라던 문구도 *"무료로 시작하기"* 로 고쳤다(문구가 거짓말이었다).
 *   ⚠️ **페이지는 지우지 않는다**(👤 지시) — 기존 링크·검색 유입이 살아 있고,
 *     `/audit/<jobId>` 결과 링크가 이미 배포돼 있다. 404 를 만들지 않는다.
 *   → 계속 `allow` 하되, **신규 유입 설계의 기준점으로 삼지 않는다.**
 *   ⚠️ 하위 경로(`/audit/*` · `/ko/audit/*`)는 여전히 막는다 — 남의 진단 결과가 색인되면 안 된다.
 */

// 🔴 `VERCEL_PROJECT_PRODUCTION_URL` 은 **프로토콜 없는 호스트명**이라
//   `startsWith("https")` 검사는 항상 false 였다 → `http://` 로 발행되던 버그(sitemap 과 동일).
const protocol = process.env.NODE_ENV === "production" ? "https" : "http";
const origin = `${protocol}://${env.VERCEL_PROJECT_PRODUCTION_URL ?? "www.findable.co.kr"}`;

export default async function robots(): Promise<MetadataRoute.Robots> {
  const requestHeaders = await headers();
  const requestHost = (
    requestHeaders.get("x-forwarded-host") ??
    requestHeaders.get("host") ??
    ""
  )
    .split(":")[0]
    .toLowerCase();
  // ⚠️ `localhost`·`127.0.0.1` 제외(2026-09-02 로컬 검증에서 발견): 빠뜨리면 개발 서버에서
  //   `Host: localhost` · `Sitemap: https://localhost/sitemap.xml` 이 나온다(존재하지 않는 주소).
  //   `app/sitemap.ts` 는 이미 같은 예외를 두고 있었는데 이 파일만 없었다.
  const publicOrigin =
    requestHost &&
    requestHost !== "findable.co.kr" &&
    requestHost !== "www.findable.co.kr" &&
    requestHost !== "localhost" &&
    requestHost !== "127.0.0.1" &&
    !requestHost.endsWith(".vercel.app")
      ? `https://${requestHost}`
      : origin;
  const publicHost = new URL(publicOrigin).host;
  const isFindableHost =
    publicHost === "findable.co.kr" || publicHost === "www.findable.co.kr";

  // 🤖 **AI 크롤러를 이름으로 허용한다**(2026-09-02).
  //   [실측] 이전 robots.txt 에는 `User-Agent: *` 한 벌뿐이었다. 와일드카드로도 허용되지만,
  //   GEO 를 파는 회사가 정작 자사 진단 항목("주요 AI 봇 접근 정책 결정")을 비워둔 상태였다.
  //   1차 리서치 §2-2 의 3분류(학습·실시간검색·유저트리거)를 **전부 명시 허용**한다 —
  //   우리 목표는 차단이 아니라 **인용되는 것**이라 미들패스(학습봇 차단)를 쓰지 않는다.
  //   ⚠️ 2차 리서치 §A-5: robots.txt 준수는 봇마다 편차가 크다. 이 파일은 **의사 표시**이고
  //     실제 차단이 필요하면 WAF 레벨로 해야 한다(여기서는 차단 목적이 없다).
  //   ⚠️ `Applebot-Extended` 는 크롤러가 아니라 **Apple Intelligence 학습 opt-out 토큰**이다
  //     (2차 §A-2). 미설정이 기본 허용이라, 허용 의사를 명시만 해 둔다.
  const aiCrawlers = [
    "GPTBot",
    "OAI-SearchBot",
    "ChatGPT-User",
    "ClaudeBot",
    "Claude-SearchBot",
    "Claude-User",
    "PerplexityBot",
    "Perplexity-User",
    "Google-Extended",
    "Applebot",
    "Applebot-Extended",
    "Bingbot",
    "Yeti",
  ];

  return {
    rules: [
      {
        userAgent: aiCrawlers,
        allow: ["/", "/audit", "/ko/audit"],
        disallow: [
          "/api/",
          "/audit/*",
          "/ko/audit/*",
          "/en/audit/*",
          "/checkout/",
          "/ko/checkout/",
          "/en/checkout/",
          "/logo-preview",
          "/ko/logo-preview",
          "/en/logo-preview",
        ],
      },
      {
        userAgent: "*",
        // `allow` 가 `disallow` 보다 구체적이면 우선한다(표준: 최장 일치 규칙).
        // `/audit` 는 리드 유입 랜딩이라 반드시 허용하고, 그 **하위**만 막는다.
        allow: ["/", "/audit", "/ko/audit"],
        disallow: [
          "/api/",
          "/audit/*", // 개인 진단 결과(`/audit/<jobId>`) — 위 주석 참고
          "/ko/audit/*",
          "/checkout/", // 결제 완료 화면
          "/ko/checkout/",
          "/logo-preview", // 내부 확인용
          "/ko/logo-preview",
          "/en/logo-preview",
          // 🔴 2026-08-17 세션N-38 — `/synergy` 는 **페이지를 삭제**했다(👤 *"필요 없어"*).
          //   투자 피치 문서(네이버 D2SF, 5월 신청 건)라 고객용 서비스가 아니었고,
          //   진입 경로 0 인데 배포만 되어 있었다. 남아 있던 내용도 지금은 사실과 어긋났다 —
          //   *"8번째 엔진으로 AI 브리핑을 통합한 첫 도구"* 는 실측상 본류 7엔진에 없다.
          //   차단 규칙은 **경로가 사라졌으므로 함께 제거**한다(없는 길을 막는 규칙은 오해를 남긴다).
          //   백업 = `_백업/synergy_page_D2SF투자피치_삭제전.tsx.bak`
        ],
      },
    ],
    // 🔴 **뉴스 사이트맵은 우리 호스트에서만 알린다**(2026-09-02). 고객 커스텀 도메인에는
    //   `/news-sitemap.xml` 라우트가 우리 글 목록을 돌려주므로, 그 호스트에서 광고하면
    //   남의 도메인에 우리 기사 목록을 신고하게 된다.
    //   ⚠️ `sitemap` 값은 **프로토콜·호스트를 포함한 절대 URL** 이어야 한다(구글 공식 스펙).
    //      여러 줄 제출은 허용된다(상한 없음).
    sitemap: isFindableHost
      ? [`${publicOrigin}/sitemap.xml`, `${publicOrigin}/news-sitemap.xml`]
      : `${publicOrigin}/sitemap.xml`,
    // ⚠️ `host` 는 **구글이 지원하지 않는 필드**다(공식 스펙의 지원 목록 = user-agent·allow·
    //   disallow·sitemap). Yandex 계열 파서 호환용으로만 남기고, 값은 URL 이 아니라
    //   **호스트명**을 준다(이전 값 `https://…` 는 그 파서들에서도 무의미했다).
    host: publicHost,
  };
}
