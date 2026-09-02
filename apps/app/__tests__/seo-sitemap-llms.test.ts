/**
 * 🔴 **왜 이 테스트가 있나** (세션N-39 — SEO/GEO 실측)
 *
 * ① `/llms.txt` 가 **HTTP 500** 이었다. 라우트가 없어서 `[locale]` 캐치올이
 *   `"llms.txt"` 를 로케일로 읽고 터졌다. **GEO 를 파는 회사가 AI 엔진용 표준
 *   파일에서 에러를 띄우고 있었다** — 경쟁사·심사관이 30초면 보는 자리다.
 *
 * ② 사이트맵 20 URL 중 **EN 10개가 전부 307 → `/ko`** 였다. 리다이렉트되는 URL 을
 *   싣고 `x-default` 까지 그쪽을 가리키면 구글은 hreflang 클러스터를 **통째로 무시**한다
 *   → EN 10개가 KO 10개의 신호까지 갉아먹었다. 실측 후 `ko` 10개만 남겼다(전부 200 확인).
 *
 * ⚠️ 이 테스트는 **네트워크를 타지 않는다** — 소스의 계약만 검사한다.
 *   (라이브 확인은 배포 후 별도. 여기서 fetch 하면 CI 가 외부 의존이 된다.)
 *   📕 규율: 가드는 문구가 아니라 계약을 검사한다(reference_findable_traps §1).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "../../..");
const SITEMAP = join(ROOT, "apps/web/app/sitemap.ts");
const LLMS = join(ROOT, "apps/web/app/llms.txt/route.ts");

const METADATA = join(ROOT, "packages/seo/metadata.ts");
const PROXY = join(ROOT, "apps/web/proxy.ts");

const sitemapCode = readFileSync(SITEMAP, "utf8");
const llmsCode = readFileSync(LLMS, "utf8");
const metadataCode = readFileSync(METADATA, "utf8");
const proxyCode = readFileSync(PROXY, "utf8");

// 정규식은 최상위에(lint: useTopLevelRegex).
const LOCALES_DECL = /const LOCALES = \[([^\]]*)\] as const;/;
const HREFLANG_DECL = /const HREFLANG_LOCALES = \[([^\]]*)\] as const;/;
/** 프록시가 **명시적 로케일 경로를 i18n 판정에서 제외**하는지 — EN 이 사는 전제. */
const PROXY_EXPLICIT_LOCALE_EXEMPT =
  /EXPLICIT_LOCALE_PATH_RE\.test\(pathname\)/;
const UNPREFIXED_SENTINEL =
  /const UNPREFIXED_LOCALE = "__no_unprefixed_locale__";/;
// 미출시 발행 기능을 현재형으로 단정하는 문장(가드 ⑥).
const LLMS_UNSHIPPED_PUBLISH =
  /(Cafe24|스마트스토어|WordPress)[^\n]*발행합니다/;
const XDEFAULT_DECL = /const DEFAULT_LOCALE = "(ko|en)";/;
const PREFIX_USES_UNPREFIXED =
  /locale === UNPREFIXED_LOCALE \? "" : `\/\$\{locale\}`/;
// 발행 콘텐츠를 DB에서 읽는 현재 구현은 async. 정적·비동기 GET 모두 라우트 계약이다.
const LLMS_EXPORTS_GET = /export (?:async )?function GET\(\)/;
const LLMS_PLAIN_TEXT = /text\/plain/;
const LLMS_H1 = /# Findable/;
const LLMS_BLOCKQUOTE = /\n> /;

/**
 * 🔴🔴 **2026-09-02 — 이 가드들을 다시 썼다(중요).**
 *
 *   원래 가드는 *"LOCALES 는 반드시 `["ko"]`"* 처럼 **당시의 결정**을 못박고 있었다.
 *   그런데 N-39 가 EN 을 뺀 진짜 이유는 "EN 이 리다이렉트된다"였고, 해제 조건도
 *   *"프록시부터 고친 뒤"* 라고 주석에 적혀 있었다. 프록시를 고쳐 EN 이 200 이 된 뒤에도
 *   이 가드는 **개선을 회귀로 판정**했다.
 *   → 이제 **불변식 자체**를 검사한다: ① 무접두사 URL 을 제출하지 않는다
 *     ② x-default 가 제출 로케일 안에 있다 ③ 사이트맵과 hreflang 목록이 일치한다
 *     ④ EN 을 넣었다면 프록시 면제가 함께 있다(순서 위반 방지).
 *   📕 feedback_guard_defends_the_bug
 */
describe("SEO — 사이트맵이 실제로 도달 가능한 URL 만 제출한다", () => {
  // ── 가드 ①: 무접두사(=국가로 언어가 바뀌는) URL 을 제출하지 않는다 ──
  it("🔴 무접두사 URL 을 정규 URL 로 제출하지 않는다", () => {
    expect(
      sitemapCode,
      "UNPREFIXED_LOCALE 에 실제 로케일(ko/en)이 들어가면 접두사 없는 URL 이 제출된다 — 그 경로는 방문자 국가로 언어가 바뀐다"
    ).toMatch(UNPREFIXED_SENTINEL);
    expect(sitemapCode).toMatch(PREFIX_USES_UNPREFIXED);
    expect(metadataCode).toMatch(UNPREFIXED_SENTINEL);
  });

  // ── 가드 ②: x-default 가 실제 제출 대상 로케일이다 ──────────────
  it("🔴 x-default 는 제출한 로케일 중 하나를 가리킨다", () => {
    const locales = LOCALES_DECL.exec(sitemapCode)?.[1] ?? "";
    const xDefault = XDEFAULT_DECL.exec(sitemapCode)?.[1] ?? "";
    expect(xDefault, "DEFAULT_LOCALE 선언을 찾지 못했다").not.toBe("");
    expect(
      locales.includes(`"${xDefault}"`),
      `x-default(${xDefault})가 LOCALES(${locales.trim()}) 에 없다 — 제출하지 않는 언어를 기본으로 신고하면 클러스터가 무시된다`
    ).toBe(true);
  });

  // ── 가드 ③: 사이트맵과 메타데이터의 언어 목록이 어긋나지 않는다 ──
  it("🔴 사이트맵 LOCALES 와 metadata HREFLANG_LOCALES 가 일치한다", () => {
    const normalize = (value: string) =>
      value
        .split(",")
        .map((item) => item.trim().replaceAll('"', ""))
        .filter(Boolean)
        .sort()
        .join(",");
    const sitemapLocales = normalize(LOCALES_DECL.exec(sitemapCode)?.[1] ?? "");
    const hreflangLocales = normalize(
      HREFLANG_DECL.exec(metadataCode)?.[1] ?? ""
    );
    expect(sitemapLocales, "사이트맵 LOCALES 를 찾지 못했다").not.toBe("");
    expect(
      hreflangLocales,
      `사이트맵(${sitemapLocales}) 과 hreflang(${hreflangLocales}) 이 다르다 — 한쪽만 바꾸면 정규 URL 신호가 갈린다`
    ).toBe(sitemapLocales);
  });

  // ── 가드 ④: EN 을 제출하려면 프록시 면제가 함께 있어야 한다 ──────
  it("🔴 en 을 제출하면 프록시가 명시 로케일 경로를 i18n 에서 제외한다", () => {
    const locales = LOCALES_DECL.exec(sitemapCode)?.[1] ?? "";
    if (!locales.includes('"en"')) {
      return;
    }
    expect(
      proxyCode,
      "EN 을 사이트맵에 넣었는데 프록시 면제가 없다 — i18n 이 국가로 로케일을 강제해 EN URL 이 /ko 로 튕긴다(N-39 재발)"
    ).toMatch(PROXY_EXPLICIT_LOCALE_EXEMPT);
  });
});

describe("GEO — /llms.txt 가 살아 있다", () => {
  // ── 가드 ④: 라우트가 존재하고 평문을 준다 ──────────────────────
  it("🔴 llms.txt 라우트가 존재하고 text/plain 을 반환한다", () => {
    expect(llmsCode).toMatch(LLMS_EXPORTS_GET);
    expect(llmsCode, "text/plain 이 아니면 크롤러가 문서로 안 읽는다").toMatch(
      LLMS_PLAIN_TEXT
    );
  });

  // ── 가드 ⑤: llmstxt.org 필수 구조 ─────────────────────────────
  it("llmstxt.org 규격의 H1 + 요약 blockquote 를 갖춘다", () => {
    // H1 은 **유일한 필수 항목**이고, blockquote 요약이 AI 가 먼저 읽는 줄이다.
    expect(llmsCode).toMatch(LLMS_H1);
    expect(llmsCode, "요약 blockquote(> )가 없다").toMatch(LLMS_BLOCKQUOTE);
  });

  // ── 가드 ⑥: 미출시 기능을 AI 에게 사실처럼 먹이지 않는다 ────────
  it("🔴 미출시 발행 기능을 현재형으로 쓰지 않는다", () => {
    // 이 파일은 AI 가 그대로 인용한다 — 랜딩에서 「준비 중」으로 고친 것을
    // 여기에 현재형으로 적으면 **날조가 AI 답변을 통해 퍼진다.**
    // 📕 feedback_no_fabricated_facts
    expect(
      llmsCode,
      "Cafe24/네이버/WordPress 발행을 '합니다'로 단정하면 날조가 된다"
    ).not.toMatch(LLMS_UNSHIPPED_PUBLISH);
  });
});
