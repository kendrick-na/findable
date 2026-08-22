import { defaults, type Options, withVercelToolbar } from "@nosecone/next";

export { createMiddleware as securityMiddleware } from "@nosecone/next";

// Nosecone security headers configuration
// https://docs.arcjet.com/nosecone/quick-start
export const noseconeOptions: Options = {
  ...defaults,
  // Content Security Policy (CSP) is disabled by default because the values
  // depend on which Next Forge features are enabled. See
  // https://www.next-forge.com/packages/security/headers for guidance on how
  // to configure it.
  contentSecurityPolicy: false,

  // 🔴 결제(PortOne V2) 차단 해소 — 2026-08-03
  //
  // nosecone 기본값은 `Cross-Origin-Embedder-Policy: require-corp` +
  // `Cross-Origin-Opener-Policy: same-origin` 이다(=cross-origin isolation).
  // 이 조합은 CORP 헤더를 내려주지 않는 외부 자원을 브라우저가 전부 차단한다.
  //
  // 실측(2026-08-03, app.findable.co.kr): 결제 버튼 클릭 시 PortOne SDK 가
  //   https://cdn.portone.io/v2/browser-sdk.js 를 주입하는데
  //   `net::ERR_BLOCKED_BY_RESPONSE.NotSameOriginAfterDefaultedToSameOriginByCoep`
  //   로 차단 → window.PortOne 미생성 → "[PortOne] Failed to load window.PortOne".
  //   (CDN 자체는 정상: 직접 호출 시 200 / 241KB)
  //
  // - COEP=false : 위 차단 해소. cross-origin isolation 은 SharedArrayBuffer·
  //   고정밀 타이머 등에만 필요하고 이 서비스는 쓰지 않는다.
  // - COOP=same-origin-allow-popups : PortOne 결제창은 IFRAME·POPUP·REDIRECTION
  //   세 방식을 쓴다. 기본값 `same-origin` 은 팝업과의 window 참조(opener)를 끊어
  //   결제 결과 콜백이 유실될 수 있다. `unsafe-none`(전면 해제)까지 갈 필요는 없고,
  //   **내가 연 팝업과의 통신만 허용**하고 남이 나를 여는 경우는 계속 격리하는
  //   `same-origin-allow-popups` 가 결제 연동의 최소 완화값이다.
  //
  // 나머지 보안 헤더(HSTS·X-Frame-Options·nosniff·Referrer-Policy 등)는 기본값 유지.
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
};

export const noseconeOptionsWithToolbar: Options =
  withVercelToolbar(noseconeOptions);
