import "server-only";
import { getDictionary } from "@repo/internationalization";
import { cookies, headers } from "next/headers";
import { pickLocaleFromAcceptLanguage } from "./accept-language";

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
 *   범위 밖이다. → `NEXT_LOCALE` 쿠키를 읽는다(헤더 토글 `app/locale/route.ts` 가 심는다).
 *   🔴 정정(2026-10-06): 예전 주석은 *"`apps/web` 의 i18n 프록시가 이미 심는 쿠키"* 라 했지만
 *     [확인사실] 웹(`next-international` 1.3.1)이 심는 쿠키 이름은 **`Next-Locale`** 이라 다르다.
 *     일부러 이어 받지 않는다 — 웹은 **IP 국가**로 언어를 정해서(해외 출장 중 한국 고객 → 영어),
 *     로그인 후 앱에 그대로 쓰면 안 된다. 대신 아래 브라우저 언어 감지를 쓴다.
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

/**
 * 앱 영어 지원을 **고객에게 열지**. 켜면 ① 헤더 KO/EN 토글이 보이고
 * ② 쿠키가 없는 첫 방문자는 브라우저 언어(`Accept-Language`)로 ko/en 을 고른다.
 *
 * 🔴 **왜 꺼 두나**(2026-10-06 · `docs/_적용/영어화면_범위_20261006.md` 3·5장):
 *   [실측] EN 을 누르면 사이드바만 영어가 되고 본문·로그인(Clerk koKR)·날짜(ko-KR)·
 *   AI 리포트는 한국어로 남는다 → **반쯤 영어인 화면은 고장으로 보인다.** 외국 고객 0명.
 *   → 핵심 화면(온보딩·대시보드·브랜드·기록·결제) 이관 + 👤 결정(약관·통화·용어집) 전까지 끈다.
 * ⚠️ 토글과 자동 감지는 **반드시 함께** 켜고 끈다. 감지만 켜면 영어 브라우저 사용자가
 *   반쯤 영어인 화면에 갇히고 되돌릴 버튼이 없다.
 * ⚠️ 꺼도 `/locale?locale=en` 경로와 쿠키는 그대로라 내부 확인은 가능하다.
 */
export const APP_ENGLISH_ENABLED = false;

/**
 * 날짜·숫자 표기용 BCP 47 태그. `toLocaleDateString(dateLocaleFor(locale))` 처럼 쓴다.
 * ⚠️ 2026-10-06 실측: 앱에 `"ko-KR"` 고정이 58곳 — 화면을 옮길 때 이걸로 바꾼다.
 */
export const dateLocaleFor = (locale: AppLocale): string =>
  locale === "en" ? "en-US" : "ko-KR";

const isAppLocale = (v: string | undefined): v is AppLocale =>
  v !== undefined && APP_LOCALES.includes(v as AppLocale);

/**
 * 현재 요청의 로케일. 우선순위:
 *   ① `NEXT_LOCALE` 쿠키(사용자가 토글로 고른 값 — 브라우저 단위, 조직과 무관)
 *   ② `APP_ENGLISH_ENABLED` 일 때만: 브라우저 `Accept-Language` 의 ko/en 중 먼저 나오는 것
 *   ③ 기본(ko)
 * 📐 계정 단위 저장(기기 간 유지)은 아직 없다 — 페이지마다 Clerk 조회가 한 번 더 붙어
 *   느려지므로, 영어를 고객에게 열 때 함께 설계한다(범위 문서 3장).
 * ⚠️ 서버 컴포넌트 전용(`cookies()`·`headers()`).
 */
export async function getAppLocale(): Promise<AppLocale> {
  // 🔴 요청 밖(테스트·cron·백그라운드 작업)에서는 `cookies()` 가 throw 한다.
  //   서버 액션이 오류 문구를 사전에서 읽게 되면서(2026-10-06) 그 경로가 생겼다 → 기본값(ko).
  let store: Awaited<ReturnType<typeof cookies>>;
  try {
    store = await cookies();
  } catch {
    return APP_DEFAULT_LOCALE;
  }
  const raw = store.get("NEXT_LOCALE")?.value?.split("-")[0];
  if (isAppLocale(raw)) {
    return raw;
  }
  if (!APP_ENGLISH_ENABLED) {
    return APP_DEFAULT_LOCALE;
  }
  try {
    const requestHeaders = await headers();
    return (
      pickLocaleFromAcceptLanguage(requestHeaders.get("accept-language")) ??
      APP_DEFAULT_LOCALE
    );
  } catch {
    return APP_DEFAULT_LOCALE;
  }
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

/** `app` 네임스페이스 사전 타입. 부품에 `t: AppDictionary["dashboard"]` 처럼 넘길 때 쓴다. */
export type AppDictionary = Awaited<ReturnType<typeof getAppDictionary>>;
