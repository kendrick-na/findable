/**
 * 로그인 화면 소셜프루프 — 2026-08-17 세션N-37 (v4 가져올것 ⑦).
 *
 * 🔴 **왜 이 검사가 있나**: 경쟁사 4곳은 이 자리에 **고객 로고**를 둔다
 *   (Profound 18개 · Scrunch "500개사"). 우리는 **고객 0명**이라 흉내내면 그 순간 날조다.
 *   → 검증된 사실 3개만 쓰되, **그 문구가 web 랜딩과 갈리지 않게** 잠근다.
 *
 * > 사고 이력(사용자 규칙): IBK 사업계획서에 없는 직원·없는 실적이 자동 생성돼
 *   마감 직전에 발견됐다. 못 잡았으면 허위 보고로 탈락이었다.
 *   **인력·실적·수상은 확인된 것만 쓴다.**
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const LAYOUT_RAW = readFileSync(
  join(process.cwd(), "app/(unauthenticated)/layout.tsx"),
  "utf8"
);

/**
 * 주석을 걷고 **화면에 실제로 나가는 코드**만 남긴다.
 * 🔴 이게 없으면 *"이 단어를 쓰지 말라"* 고 적은 **주석 자체가 검사에 걸린다**
 *   (2026-08-17 실제로 걸렸다 — 금지어를 설명하는 주석이 위반으로 잡혔다).
 *   JSX 주석(`{@/* … *@/}`)과 줄 주석 둘 다 걷는다.
 */
const LAYOUT_CODE = LAYOUT_RAW.replace(/\{?\/\*[\s\S]*?\*\/\}?/g, "")
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("//"))
  .join("\n");

/**
 * 🔴 2026-10-06 — 문구가 사전(`app.authPanel`)으로 옮겨졌다. 화면에 나가는 글 =
 *   레이아웃 코드 + 사전 값. 둘 다 검사해야 「날조 금지」가 계속 지켜진다.
 */
const panelDict = (lang: "ko" | "en") =>
  JSON.parse(
    readFileSync(
      join(
        process.cwd(),
        `../../packages/internationalization/dictionaries/${lang}.json`
      ),
      "utf8"
    )
  ).app.authPanel as Record<string, string>;
const PANEL_KO = panelDict("ko");
const PANEL_EN = panelDict("en");
const LAYOUT = [LAYOUT_CODE, ...Object.values(PANEL_KO)].join("\n");
const LAYOUT_EN = Object.values(PANEL_EN).join("\n");
const WEB_CREDIBILITY = readFileSync(
  join(process.cwd(), "../web/app/[locale]/(home)/components/credibility.tsx"),
  "utf8"
);

describe("검증된 사실만 쓴다", () => {
  it("세 항목이 web 랜딩과 같은 문구다", () => {
    // 🔴 같은 사실을 두 화면이 다르게 말하면 어느 쪽이 맞는지 알 수 없게 된다.
    for (const claim of [
      "KAIST OverEdge 2026 선정",
      "생성형 AI 활용 경진대회 최우수상",
    ]) {
      expect(LAYOUT).toContain(claim);
      expect(WEB_CREDIBILITY).toContain(claim);
    }
  });

  it("영어판도 web 랜딩 영어와 같은 문구다", () => {
    for (const claim of [
      "Selected · KAIST OverEdge 2026",
      "Grand Prize · Generative AI Competition",
    ]) {
      expect(LAYOUT_EN).toContain(claim);
      expect(WEB_CREDIBILITY).toContain(claim);
    }
  });

  it("레이아웃이 세 항목을 사전에서 읽는다", () => {
    for (const key of [
      "credentialOverEdge",
      "credentialAward",
      "credentialDataset",
    ]) {
      expect(LAYOUT_CODE).toContain(`{t.${key}}`);
    }
  });

  it("K-GEO-Bench 는 라이선스까지 밝힌다", () => {
    expect(LAYOUT).toMatch(/K-GEO-Bench.*CC BY 4\.0/s);
    expect(LAYOUT_EN).toMatch(/K-GEO-Bench.*CC BY 4\.0/s);
  });
});

describe("⛔ 날조 문구 금지 — 전부 거짓이다", () => {
  // 뮤테이션 확인: 아래 중 하나라도 넣으면 깨진다(확인함).
  const FORBIDDEN = [
    "고객사",
    "도입 기업",
    "이런 곳들이 씁니다",
    "KAIST 인증",
    "공식 파트너",
  ];

  for (const word of FORBIDDEN) {
    it(`「${word}」 를 쓰지 않는다`, () => {
      expect(LAYOUT).not.toContain(word);
    });
  }

  it("영어판도 고객·파트너를 주장하지 않는다", () => {
    expect(LAYOUT_EN).not.toMatch(
      /customers|clients|trusted by|official partner|certified by KAIST/i
    );
  });

  it("고객 수·기업 수를 숫자로 주장하지 않는다", () => {
    // 유료 고객 0명 · 가입 6명이 실측이다. "N개사"는 어떤 숫자를 넣어도 거짓이 된다.
    expect(LAYOUT).not.toMatch(/\d+\s*(개사|개 기업|곳의 고객)/);
    expect(LAYOUT_EN).not.toMatch(/\d+\+?\s*(companies|brands use|customers)/i);
  });
});
