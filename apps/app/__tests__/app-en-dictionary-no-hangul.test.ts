import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 🔴 영어 사전(`en.json` `app.*`)에 한국어가 그대로 남지 않게 한다(2026-10-06).
 * 왜: 키를 추가할 때 ko 값을 en 에 복사해 두고 잊으면, 키 개수 검사
 *   (`app-i18n-scaffold.test.ts`)는 통과하는데 영어 화면에 한국어가 섞인다.
 * 예외는 **한국어 자체가 내용인 경우**만 — 아래 목록에 이유와 함께 적는다.
 */
/** ⚖️ 법정 고지·동의 문구: 영어판 승인 대기(`docs/_적용/영어화면_범위_20261006.md` 2-1장). */
const PENDING_LEGAL_EN = "영어판 승인 대기(법정 고지·동의)";

const ALLOWED_HANGUL: Record<string, string> = {
  // 한국 정보통신망법상 광고 메일 표기 「(광고)」 를 그대로 가리킨다.
  "axMail.errorAdNotice": "법정 표기 문자열",
  // 기존고객 메일 제목에 남기는 법정 표기 「(광고)」 를 그대로 인용한다(2026-10-07).
  "axMail.legalBody": "법정 표기 문자열",
  // 공개 영문 약관(Key summary)이 버튼 이름을 한국어 그대로 병기한다 — 문장을 바꾸지 않는다.
  "purchaseNotice.requestVia": "공개 영문 약관 문장 그대로",
  // 「한국어 표기 통합 추적」 기능 설명 — 한글 표기 예시 자체가 내용이다.
  "pricing.variantsHint": "한글 표기 예시",
  // ⚖️ 전자상거래법 결제 전 고지·동의 문구 — 영어판은 👤 승인 전까지 만들지 않는다(D1).
  "subscribe.disclosureTitle": PENDING_LEGAL_EN,
  "subscribe.disclosureProduct": PENDING_LEGAL_EN,
  "subscribe.disclosureProductValue": PENDING_LEGAL_EN,
  "subscribe.disclosureAmount": PENDING_LEGAL_EN,
  "subscribe.disclosureAmountNote": PENDING_LEGAL_EN,
  "subscribe.disclosureCycle": PENDING_LEGAL_EN,
  "subscribe.disclosureCycleValue": PENDING_LEGAL_EN,
  "subscribe.disclosureNext": PENDING_LEGAL_EN,
  "subscribe.disclosureNextValue": PENDING_LEGAL_EN,
  "subscribe.disclosureCancel": PENDING_LEGAL_EN,
  "subscribe.disclosureCancelValue": PENDING_LEGAL_EN,
  "subscribe.consent": PENDING_LEGAL_EN,
  "upgrade.consent": PENDING_LEGAL_EN,
};

const HANGUL_RE = /[가-힣]/;

const flatten = (node: unknown, prefix = ""): [string, string][] => {
  if (typeof node === "string") {
    return [[prefix, node]];
  }
  if (node && typeof node === "object") {
    return Object.entries(node).flatMap(([key, value]) =>
      flatten(value, prefix ? `${prefix}.${key}` : key)
    );
  }
  return [];
};

const EN_APP = JSON.parse(
  readFileSync(
    join(
      import.meta.dirname,
      "../../../packages/internationalization/dictionaries/en.json"
    ),
    "utf8"
  )
).app;

describe("en.json app namespace", () => {
  it("has no untranslated Korean outside the allow list", () => {
    const leftovers = flatten(EN_APP)
      .filter(
        ([key, value]) => HANGUL_RE.test(value) && !(key in ALLOWED_HANGUL)
      )
      .map(([key, value]) => `${key}: ${value}`);
    expect(leftovers).toEqual([]);
  });
});
