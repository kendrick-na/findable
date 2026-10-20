"use client";

import { useEffect } from "react";
import { isSensitivePath, redactPath } from "../observability/url-privacy";

interface SafeGoogleAnalyticsProps {
  readonly gaId: string;
}

interface GtagWindow {
  dataLayer?: unknown[];
  gtag?: (...args: unknown[]) => void;
}

const GA_SCRIPT_ID = "safe-ga-script";

/**
 * GA4 — 비밀 주소가 구글로 가지 않도록 직접 제어한다.
 *
 * - 자동 페이지뷰를 끄고(send_page_view:false), 우리가 치환한 경로로만 page_view를 보낸다.
 * - /audit/<jobId>·/r/<토큰> 경로에서는 GA를 통째로 끈다(ga-disable 플래그, 스크립트도 안 싣는다).
 * - 쿼리 문자열은 어떤 경우에도 보내지 않는다.
 */
const LOCATION_EVENT = "safe-ga-locationchange";

/** 주소 이동(pushState·replaceState·뒤로가기)을 감지해 콜백을 부른다. next 에 의존하지 않는다. */
const watchPathname = (onChange: (pathname: string) => void) => {
  const notify = () => onChange(window.location.pathname);
  const { pushState, replaceState } = window.history;
  window.history.pushState = function patchedPush(...args) {
    pushState.apply(this, args);
    window.dispatchEvent(new Event(LOCATION_EVENT));
  };
  window.history.replaceState = function patchedReplace(...args) {
    replaceState.apply(this, args);
    window.dispatchEvent(new Event(LOCATION_EVENT));
  };
  window.addEventListener(LOCATION_EVENT, notify);
  window.addEventListener("popstate", notify);
  notify();
  return () => {
    window.history.pushState = pushState;
    window.history.replaceState = replaceState;
    window.removeEventListener(LOCATION_EVENT, notify);
    window.removeEventListener("popstate", notify);
  };
};

const ensureGtag = (w: GtagWindow & Record<string, unknown>, gaId: string) => {
  if (!w.gtag) {
    w.dataLayer = w.dataLayer ?? [];
    // gtag.js 는 배열이 아니라 Arguments 객체를 dataLayer 에 쌓아야 인식한다.
    w.gtag = function gtag() {
      // biome-ignore lint/complexity/noArguments: gtag.js 규약(Arguments 객체 필요)
      w.dataLayer?.push(arguments);
    };
    w.gtag("js", new Date());
    w.gtag("config", gaId, { send_page_view: false });
  }
  if (!document.getElementById(GA_SCRIPT_ID)) {
    const script = document.createElement("script");
    script.id = GA_SCRIPT_ID;
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(gaId)}`;
    document.head.appendChild(script);
  }
};

export const SafeGoogleAnalytics = ({ gaId }: SafeGoogleAnalyticsProps) => {
  useEffect(() => {
    const w = window as unknown as GtagWindow & Record<string, unknown>;
    return watchPathname((pathname) => {
      const sensitive = isSensitivePath(pathname);
      w[`ga-disable-${gaId}`] = sensitive;
      if (sensitive) {
        return;
      }
      ensureGtag(w, gaId);
      const safePath = redactPath(pathname);
      w.gtag?.("event", "page_view", {
        page_path: safePath,
        page_location: `${window.location.origin}${safePath}`,
      });
    });
  }, [gaId]);

  return null;
};
