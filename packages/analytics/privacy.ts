import { redactUrl } from "../observability/url-privacy";

/** PostHog 이벤트 속성 중 주소를 담는 칸(현재·최초 유입·직전 페이지 모두). */
const URL_PROPERTY =
  /^\$(current_url|pathname|referrer|initial_[a-z_]*(url|pathname|referrer)|prev_pageview_(pathname|url))$/;

interface CaptureLike {
  $set?: Record<string, unknown>;
  $set_once?: Record<string, unknown>;
  properties?: Record<string, unknown>;
}

const redactBag = (bag: Record<string, unknown> | undefined) => {
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

/**
 * PostHog before_send — 이벤트가 나가기 직전 주소의 비밀 값을 지운다.
 * 이벤트 자체를 버리지 않고(null 반환 없음) 속성만 치환한다.
 */
export const sanitizePostHogEvent = <T extends CaptureLike | null>(
  event: T
): T => {
  if (!event) {
    return event;
  }
  redactBag(event.properties);
  redactBag(event.$set);
  redactBag(event.$set_once);
  return event;
};
