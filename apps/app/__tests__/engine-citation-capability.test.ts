/**
 * 「인용 0」의 두 가지 뜻 = **단일 진실** 회귀 테스트 (2026-08-17 세션N-38).
 *
 * 🔴 **왜 필요한가**: 권역 분리(P1-G)로 한국 엔진이 한 그룹에 모인다. 그 안에서
 *   `hyperclova` 의 `인용 0` 이 다른 한국 엔진과 나란히 보이면
 *   「한국 AI 는 우리를 안 읽는다」로 읽힌다 — **우리 유일 차별점이 약점으로 보이는 역설**.
 *   그런데 hyperclova 는 어댑터가 `citedSources` 에 **빈 배열을 하드코딩**한다
 *   (`korean-adapters.ts` — `analyzeText("hyperclova", text, query, ms, [], ...)`).
 *   즉 0 은 **성과가 아니라 구조**다.
 *
 * ⚠️ **재설계안 v4 §4「탭4 함정」의 "chatgpt·claude·hyperclova 3종"은 틀렸다.**
 *   chatgpt·claude 는 provider sources 가 없으면 `extractCitedSources(text)` 로
 *   **본문 URL 을 줍는 폴백**이 있다 → 인용이 나올 길이 **있다**.
 *   이 테스트가 그 오해를 코드로 못박는다. 목록을 늘리려면 **어댑터를 열어
 *   빈 배열을 확인한 뒤**에만 늘린다(문서만 보고 늘리면 거짓 안내가 화면에 나간다).
 *
 * @vitest-environment node
 */

import { engineReturnsCitations } from "@repo/audit/market-scope";
import { describe, expect, it } from "vitest";

describe("인용 가능 여부 — 0 의 뜻이 엔진마다 다르다", () => {
  it("🔴 hyperclova 는 구조적으로 출처를 못 낸다", () => {
    // 어댑터가 `[]` 를 하드코딩한다. 화면은 이걸 "안 읽혔다"로 말하면 안 된다.
    expect(engineReturnsCitations("hyperclova")).toBe(false);
  });

  it("🔴 chatgpt·claude 는 본문 URL 폴백이 있어 인용이 **나올 수 있다**", () => {
    // v4 문서가 이 둘을 hyperclova 와 묶었으나 코드는 다르다.
    // 여기를 false 로 바꾸면 화면이 "출처를 밝히지 않는 AI"라고 **거짓 안내**를 한다.
    expect(engineReturnsCitations("chatgpt")).toBe(true);
    expect(engineReturnsCitations("claude")).toBe(true);
  });

  it("검색 기반 엔진은 당연히 인용을 낸다", () => {
    for (const id of ["perplexity", "gemini", "naver", "daum"]) {
      expect(engineReturnsCitations(id)).toBe(true);
    }
  });

  it("네이버 AI 브리핑은 출처를 낸다 — 블록의 링크를 그대로 싣는다", () => {
    // naver-briefing-adapter: `block.links.map(...)` → citedSources.
    expect(engineReturnsCitations("naver-briefing")).toBe(true);
  });

  it("🔴 모르는 엔진은 인용 가능으로 본다 — 없는 변명을 붙이지 않는다", () => {
    // 기본값이 false 면 새 엔진이 추가되는 날 "출처를 밝히지 않는 AI"라는
    // **확인되지 않은 설명**이 자동으로 화면에 붙는다. 그건 날조다.
    expect(engineReturnsCitations("grok")).toBe(true);
  });
});
