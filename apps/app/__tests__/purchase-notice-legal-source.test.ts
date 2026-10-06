import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * ⚖️ 결제 전 환불·청약철회 고지의 **영어판은 지어내지 않는다**(2026-10-06 · 👤 D1).
 *
 * 영어 문장은 이미 공개된 영문 이용약관(`apps/web` `/legal/terms` 의 Key summary)에서
 * **글자 그대로** 가져왔다. 약관이 바뀌었는데 앱 고지만 옛 문장으로 남거나, 누가 앱
 * 쪽에서 문장을 "다듬으면" 공개 약관과 다른 약속을 하게 된다 → 그 순간 실패한다.
 */
const ROOT = join(import.meta.dirname, "../../..");
const TERMS = readFileSync(
  join(ROOT, "apps/web/app/[locale]/legal/[slug]/page.tsx"),
  "utf8"
);
const EN = JSON.parse(
  readFileSync(
    join(ROOT, "packages/internationalization/dictionaries/en.json"),
    "utf8"
  )
).app;
const REFUND_EMAIL = "kendrick@indigochild.kr";

describe("purchase notice (English) = published English terms", () => {
  const notice = EN.purchaseNotice as Record<string, string>;

  it.each([
    "withdraw",
    "prorate",
    "subscriptionCancel",
    "oneOff",
  ])("%s 는 공개 영문 약관에 그대로 있다", (key) => {
    expect(TERMS).toContain(notice[key]);
  });

  it("요청 경로 문장도 (이메일을 채우면) 공개 영문 약관과 같다", () => {
    expect(TERMS).toContain(notice.requestVia.replace("{email}", REFUND_EMAIL));
  });

  it("환불 요청 폼·해지 안내의 영어 정책 문장도 공개 약관 문장의 조합이다", () => {
    const sentences = [
      ...(EN.refundRequest.body as string).split(/(?<=\.)\s+/),
      ...(EN.cancelSubscription.body as string).split(/(?<=\.)\s+/),
    ];
    for (const sentence of sentences) {
      expect(TERMS, `공개 약관에 없는 문장: ${sentence}`).toContain(
        sentence.replace(/\.$/, "")
      );
    }
  });
});
