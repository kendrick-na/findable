import "server-only";
import { getDictionary } from "@repo/internationalization";
import { cookies } from "next/headers";

/**
 * `apps/app`(로그인 후 대시보드) 다국어 — **뼈대**.
 *
 * 🔴 **왜 필요한가**(v4 P0-3 · 2026-08-17 세션N-39): 이 앱은 i18n 이 **아예 없었다.**
 *   [실측] `@repo/internationalization` import **0건** · dictionary 최상위 키 `["web"]` 뿐 ·
 *   `.tsx` **74개 중 64개(86%)에 한글 하드코딩** · `[locale]` 세그먼트도 없음.
 *   `CLAUDE.md §2` 는 *"다국어 문자열은 dictionary 사용(하드코딩 금지)"* 를 규정하는데
 *   앱 전체가 그 규칙 밖에 있었다.
 *
 * 📐 **범위를 좁힌 이유**(👤 2026-08-17 *"대시보드는 한국어랑 영어를 기본으로"*):
 *   기존 64개 파일을 한 번에 뜯으면 **그 자체가 큰 회귀 위험**이다(문자열만 수천 개).
 *   → **오늘 멈추는 건 「부채가 더 쌓이는 것」**이다:
 *     ① `app` 네임스페이스와 이 접근자를 깔고
 *     ② **새로 쓰는 문자열은 여기를 경유**시킨다
 *     ③ 기존 하드코딩은 만지는 김에 점진 이관
 *   ⚠️ 이 파일이 있다고 앱이 영어로 도는 게 **아니다** — 아직 대부분 하드코딩이다.
 *     `nav`·`common` 만 사전에 있고, 나머지는 옮길 때마다 채운다.
 *
 * 🔴 **로케일을 어디서 얻나**: `apps/app` 은 `apps/web` 과 달리 URL 에 로케일이 없다
 *   (`app/(authenticated)/...`). 라우팅을 `[locale]` 로 바꾸는 건 **전 화면 URL 변경**이라
 *   범위 밖이다. → `NEXT_LOCALE` 쿠키를 읽는다. 이 쿠키는 **`apps/web` 의 i18n 프록시가
 *   이미 심는 것**이라(같은 등록 도메인) 새 메커니즘을 만들지 않는다.
 *   ⚠️ 쿠키가 없으면 **한국어**가 기본이다 — 현재 화면이 전부 한국어이므로,
 *     영어로 떨어뜨리면 사전에 없는 키만 영어로 나와 **화면이 뒤섞인다.**
 */

/** `apps/app` 이 지원하는 로케일. 👤 확정: 한국어 + 영어. */
export const APP_LOCALES = ["ko", "en"] as const;
export type AppLocale = (typeof APP_LOCALES)[number];

/**
 * 기본 로케일 = **한국어**.
 * 🔴 `apps/web` 의 기본은 `en` 이지만 여기는 다르다 — 위 주석 참조(뒤섞임 방지).
 */
export const APP_DEFAULT_LOCALE: AppLocale = "ko";

const isAppLocale = (v: string | undefined): v is AppLocale =>
  v !== undefined && APP_LOCALES.includes(v as AppLocale);

/**
 * 현재 요청의 로케일. `NEXT_LOCALE` 쿠키 → 없거나 미지원이면 기본(ko).
 * ⚠️ 서버 컴포넌트 전용(`cookies()`).
 */
export async function getAppLocale(): Promise<AppLocale> {
  const store = await cookies();
  const raw = store.get("NEXT_LOCALE")?.value?.split("-")[0];
  return isAppLocale(raw) ? raw : APP_DEFAULT_LOCALE;
}

/**
 * `app` 네임스페이스 사전을 현재 로케일로 가져온다.
 *
 * 사용:
 * ```tsx
 * const t = await getAppDictionary();
 * <span>{t.nav.overview}</span>
 * ```
 *
 * 🔴 **새 문자열은 반드시 여기를 경유한다**(하드코딩 금지 — `CLAUDE.md §2`).
 *   사전에 키를 추가할 땐 `ko.json`·`en.json` **둘 다** 채운다(한쪽만 채우면
 *   폴백이 영어를 내보내 화면이 뒤섞인다).
 */
export async function getAppDictionary() {
  const locale = await getAppLocale();
  const dictionary = await getDictionary(locale);
  return dictionary.app;
}
