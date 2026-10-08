// 고객 웹 리포트 주소 판정 — `proxy.ts` 가 쓴다(테스트하려고 분리).

/**
 * 고객 웹 리포트 `/r/<공유토큰>`(2026-09-28). 로케일 없는 전용 루트 레이아웃(`app/r/`)이라
 * 접두사를 붙이면 `/ko/r/...` 로 튕겨 404 가 난다. 또 PDF 생성기(headless Chrome)가 이 주소를
 * 인쇄하므로 봇 판정(Arcjet)에서도 빼야 한다 — 공개 랜딩과 같은 취급(링크 소유자만 아는 주소).
 */
const CLIENT_REPORT_PAGE_RE = /^\/r\/[A-Za-z0-9_-]+\/?$/;

/**
 * 리포트 PDF 내려받기 `/r/<토큰>/pdf`(2026-10-05). 처음엔 위 규칙에 빠져 `/ko/r/.../pdf` 로
 * 튕겨 **운영에서 404** 가 났다. 🔴 로케일만 뺀다 — 서버에서 Chrome 을 띄우는 비싼 경로라
 * 봇 판정은 그대로 받는다(그래서 `isClientReportPagePath` 에는 넣지 않는다).
 */
const CLIENT_REPORT_PDF_RE = /^\/r\/[A-Za-z0-9_-]+\/pdf\/?$/;

/** 봇 판정을 건너뛰는 공개 리포트 화면. */
export const isClientReportPagePath = (pathname: string): boolean =>
  CLIENT_REPORT_PAGE_RE.test(pathname);

/** 로케일 접두사를 붙이지 않는 리포트 주소(화면 + PDF). */
export const isClientReportLocaleNeutralPath = (pathname: string): boolean =>
  CLIENT_REPORT_PAGE_RE.test(pathname) || CLIENT_REPORT_PDF_RE.test(pathname);
