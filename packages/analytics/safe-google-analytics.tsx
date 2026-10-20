"use client";

import { useEffect } from "react";
import {
  isSensitivePath,
  redactPath,
  redactUrl,
} from "../observability/url-privacy";

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

export type SafeGaWindow = GtagWindow & Record<string, unknown>;

interface DocumentLike {
  createElement: (tag: "script") => {
    async: boolean;
    id: string;
    src: string;
  };
  getElementById: (id: string) => unknown;
  head: { appendChild: (node: never) => unknown };
  querySelector: (selector: string) => unknown;
  referrer: string;
}

/**
 * gtag 함수·스크립트를 준비한다. 이미 window.gtag 가 있어도(다른 코드가 만든 경우)
 * 이 Measurement ID 의 config 는 한 번 보장하고, 스크립트는 중복으로 싣지 않는다.
 */
export const ensureGtag = (
  w: SafeGaWindow,
  doc: DocumentLike,
  gaId: string
) => {
  if (!w.gtag) {
    w.dataLayer = w.dataLayer ?? [];
    // gtag.js 는 배열이 아니라 Arguments 객체를 dataLayer 에 쌓아야 인식한다.
    w.gtag = function gtag() {
      // biome-ignore lint/complexity/noArguments: gtag.js 규약(Arguments 객체 필요)
      w.dataLayer?.push(arguments);
    };
    w.gtag("js", new Date());
  }
  const configuredKey = `safe-ga-configured-${gaId}`;
  if (!w[configuredKey]) {
    w[configuredKey] = true;
    w.gtag("config", gaId, { send_page_view: false });
  }
  const src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(gaId)}`;
  if (
    !(
      doc.getElementById(GA_SCRIPT_ID) ||
      doc.querySelector(`script[src="${src}"]`)
    )
  ) {
    const script = doc.createElement("script");
    script.id = GA_SCRIPT_ID;
    script.async = true;
    script.src = src;
    doc.head.appendChild(script as never);
  }
};

/** 치환한 경로·위치·이전 주소만으로 page_view 를 보낸다(비밀 경로면 아무것도 안 보냄). */
export const sendSafePageView = (
  w: SafeGaWindow,
  doc: DocumentLike,
  origin: string,
  pathname: string,
  gaId: string
) => {
  const sensitive = isSensitivePath(pathname);
  w[`ga-disable-${gaId}`] = sensitive;
  if (sensitive) {
    return;
  }
  ensureGtag(w, doc, gaId);
  const safePath = redactPath(pathname);
  w.gtag?.("event", "page_view", {
    page_path: safePath,
    page_location: `${origin}${safePath}`,
    // 이전 주소도 치환(빈 값이면 빈 값). 쿼리·비밀 경로가 referrer 로 새지 않게 한다.
    page_referrer: redactUrl(doc.referrer),
  });
};

export const SafeGoogleAnalytics = ({ gaId }: SafeGoogleAnalyticsProps) => {
  useEffect(() => {
    const w = window as unknown as SafeGaWindow;
    return watchPathname((pathname) =>
      sendSafePageView(
        w,
        document as unknown as DocumentLike,
        window.location.origin,
        pathname,
        gaId
      )
    );
  }, [gaId]);

  return null;
};
