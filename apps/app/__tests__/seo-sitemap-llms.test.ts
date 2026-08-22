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

const sitemapCode = readFileSync(SITEMAP, "utf8");
const llmsCode = readFileSync(LLMS, "utf8");

// 정규식은 최상위에(lint: useTopLevelRegex).
const LOCALES_KO_ONLY = /const LOCALES = \[\s*"ko"\s*\] as const;/;
// 미출시 발행 기능을 현재형으로 단정하는 문장(가드 ⑥).
const LLMS_UNSHIPPED_PUBLISH =
  /(Cafe24|스마트스토어|WordPress)[^\n]*발행합니다/;
const XDEFAULT_KO = /const DEFAULT_LOCALE = "ko";/;
const UNPREFIXED_EN = /const UNPREFIXED_LOCALE = "en";/;
const PREFIX_USES_UNPREFIXED =
  /locale === UNPREFIXED_LOCALE \? "" : `\/\$\{locale\}`/;
// 발행 콘텐츠를 DB에서 읽는 현재 구현은 async. 정적·비동기 GET 모두 라우트 계약이다.
const LLMS_EXPORTS_GET = /export (?:async )?function GET\(\)/;
const LLMS_PLAIN_TEXT = /text\/plain/;
const LLMS_H1 = /# Findable/;
const LLMS_BLOCKQUOTE = /\n> /;

describe("SEO — 사이트맵이 실제로 도달 가능한 URL 만 제출한다", () => {
  // ── 가드 ①: 리다이렉트되는 EN 을 다시 넣으면 실패 ──────────────
  it("🔴 사이트맵은 ko 만 제출한다(en 은 307 로 튕긴다)", () => {
    expect(
      sitemapCode,
      "LOCALES 에 en 이 돌아왔다 — EN 경로는 실제로 307 이다. 되살리려면 프록시부터 고칠 것"
    ).toMatch(LOCALES_KO_ONLY);
  });

  // ── 가드 ②: x-default 가 도달 가능한 곳을 가리킨다 ─────────────
  it("🔴 x-default 는 실제 200 인 로케일을 가리킨다", () => {
    expect(sitemapCode).toMatch(XDEFAULT_KO);
  });

  // ── 가드 ③: 접두사 규칙이 i18n 전략을 따른다 ───────────────────
  it("🔴 ko 는 /ko 접두사를 유지한다(떼면 307 URL 이 된다)", () => {
    // `rewriteDefault` 전략상 접두사가 없는 건 en 뿐이다.
    // DEFAULT_LOCALE 기준으로 접두사를 떼면 `/pricing`(=307)이 다시 나온다.
    expect(sitemapCode).toMatch(UNPREFIXED_EN);
    expect(
      sitemapCode,
      "접두사 판정이 DEFAULT_LOCALE 로 돌아가면 /ko 가 사라져 307 URL 을 제출하게 된다"
    ).toMatch(PREFIX_USES_UNPREFIXED);
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
