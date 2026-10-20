import {
  isReportTokenPath,
  redactDeep,
  redactUrl,
} from "../observability/url-privacy";

/** PostHog 이벤트 속성 중 주소를 담는 칸(현재·최초 유입·직전 페이지 모두). */
const URL_PROPERTY =
  /^\$(current_url|pathname|referrer|initial_[a-z_]*(url|pathname|referrer)|prev_pageview_(pathname|url))$/;

interface CaptureLike {
  $set?: Record<string, unknown>;
  $set_once?: Record<string, unknown>;
  properties?: Record<string, unknown>;
}

const redactUrlBag = (bag: Record<string, unknown> | undefined) => {
  if (!bag) {
    return;
  }
  for (const key of Object.keys(bag)) {
    const value = bag[key];
    if (typeof value === "string" && URL_PROPERTY.test(key)) {
      bag[key] = redactUrl(value);
    }
  }
};

/** 이벤트가 「고객 리포트(/r/토큰)」 화면에서 발생했는지(SPA 이동 포함). */
const firedOnReportPage = (properties: Record<string, unknown> | undefined) => {
  const pathname = properties?.$pathname;
  if (typeof pathname === "string" && isReportTokenPath(pathname)) {
    return true;
  }
  const url = properties?.$current_url;
  if (typeof url === "string") {
    try {
      return isReportTokenPath(new URL(url, "https://x.invalid").pathname);
    } catch {
      return false;
    }
  }
  return false;
};

/**
 * PostHog before_send — 이벤트가 나가기 직전 주소의 비밀 값을 지운다.
 * - /r/ 화면에서 발생한 이벤트는 통째로 버린다(null). SPA 이동으로 들어온 경우도 막는다.
 * - 주소 칸은 치환하고, 나머지 모든 문자열(autocapture 의 $el_text·$el_href·
 *   $elements_chain 포함)도 재귀로 치환한다.
 *
 * 참고: audit_result_quality 의 jobId 는 보내지 않는다. 10/27 판독은 DB 의 AuditJob 으로
 * 하므로 PostHog 이벤트에는 jobId 가 필요 없다.
 */
export const sanitizePostHogEvent = <T extends CaptureLike | null>(
  event: T
): T | null => {
  if (!event) {
    return event;
  }
  if (firedOnReportPage(event.properties)) {
    return null;
  }
  redactUrlBag(event.properties);
  redactUrlBag(event.$set);
  redactUrlBag(event.$set_once);
  redactDeep(event.properties);
  redactDeep(event.$set);
  redactDeep(event.$set_once);
  return event;
};
