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
  const publicOrigin =
    requestHost &&
    requestHost !== "findable.co.kr" &&
    requestHost !== "www.findable.co.kr" &&
    !requestHost.endsWith(".vercel.app")
      ? `https://${requestHost}`
      : origin;
  return {
    rules: {
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
        // 🔴 2026-08-17 세션N-38 — `/synergy` 는 **페이지를 삭제**했다(👤 *"필요 없어"*).
        //   투자 피치 문서(네이버 D2SF, 5월 신청 건)라 고객용 서비스가 아니었고,
        //   진입 경로 0 인데 배포만 되어 있었다. 남아 있던 내용도 지금은 사실과 어긋났다 —
        //   *"8번째 엔진으로 AI 브리핑을 통합한 첫 도구"* 는 실측상 본류 7엔진에 없다.
        //   차단 규칙은 **경로가 사라졌으므로 함께 제거**한다(없는 길을 막는 규칙은 오해를 남긴다).
        //   백업 = `_백업/synergy_page_D2SF투자피치_삭제전.tsx.bak`
      ],
    },
    sitemap: `${publicOrigin}/sitemap.xml`,
    host: publicOrigin,
  };
}
