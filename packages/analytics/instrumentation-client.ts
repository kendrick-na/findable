import posthog from "posthog-js";
import { isReportTokenPath } from "../observability/url-privacy";
import { keys } from "./keys";
import { sanitizePostHogEvent } from "./privacy";

export const initializeAnalytics = () => {
  const { NEXT_PUBLIC_POSTHOG_KEY, NEXT_PUBLIC_POSTHOG_HOST } = keys();

  if (!(NEXT_PUBLIC_POSTHOG_KEY && NEXT_PUBLIC_POSTHOG_HOST)) {
    return;
  }

  // 고객 리포트(/r/<토큰>)는 링크만 알면 열리는 문서라 분석 도구를 아예 켜지 않는다.
  // (이 파일은 앱 전체에서 한 번 실행되므로 첫 진입 경로로 판단한다.)
  if (
    typeof window !== "undefined" &&
    isReportTokenPath(window.location.pathname)
  ) {
    return;
  }

  posthog.init(NEXT_PUBLIC_POSTHOG_KEY, {
    api_host: NEXT_PUBLIC_POSTHOG_HOST,
    defaults: "2025-05-24",
    // 로그인한 사람만 사람 프로필을 만든다(익명 방문자는 이벤트만).
    person_profiles: "identified_only",
    // 화면 녹화는 기본 끔.
    disable_session_recording: true,
    // 방문자 IP를 이벤트에 싣지 않는다(서버 쪽 「IP 버리기」는 대시보드 설정과 병행).
    ip: false,
    // 비밀 주소(/r/토큰, /audit/jobId, 토큰 쿼리) 치환.
    before_send: (event) => sanitizePostHogEvent(event),
  });
};
