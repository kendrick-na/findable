import type { AppDictionary } from "@/lib/i18n";
/**
 * 결제 전 청약철회·환불·해지 고지 — 2026-10-05.
 *
 * ⚖️ 근거: 전자상거래법 제13조 제2항(청약철회 기한·행사방법·효과 고지), 제17조 제6항
 *   (철회가 제한되는 경우 그 사실을 쉽게 알 수 있는 곳에 명확히 표시 — 안 하면 전액 환불),
 *   콘텐츠이용자 보호지침 제7조·제19조, 소비자분쟁해결기준 인터넷콘텐츠업.
 *   문구는 이용약관 제4조의2·제4조의3(2026-10-05 공지 · 10-12 시행)과 같은 내용을 줄인 것이다.
 *   중도 해지 공제는 이용일수만(위약금·수수료 0%, 2026-10-05 대표 승인).
 *   ⚠️ 약관 문장을 바꾸면 여기도 같이 바꾼다(결제 화면과 약관이 다르면 결제 화면 쪽이 분쟁 근거가 된다).
 *
 * 🔒 약관 링크 뒤로 숨기지 않는다 — 결제 버튼 바로 위에 실제 문장으로 보인다.
 */

/** 약관 제4조의3 제5항의 접수 이메일. 이 값만 바꾸면 고지·오류 안내가 함께 바뀐다. */
export const REFUND_CONTACT_EMAIL = "kendrick@indigochild.kr";

const ITEM_CLASS =
  "text-[color:var(--findable-ink-muted,#d0d6e0)] text-xs leading-relaxed";

export const PurchaseNotice = ({
  kind,
  termsHref,
  t,
}: {
  kind: "subscription" | "one-off";
  termsHref: string;
  /**
   * 사전 `app.purchaseNotice`.
   * ⚖️ 영어판은 **공개된 영문 약관**(`apps/web` `/legal/terms` Key summary)의 문장을 그대로 쓴다
   *   — 새로 번역하지 않는다(👤 D1). 일치는 `purchase-notice-legal-source.test.ts` 가 잠근다.
   */
  t: AppDictionary["purchaseNotice"];
}) => (
  <div className="flex flex-col gap-1.5 border-[color:var(--findable-hairline,#23252a)] border-t pt-3">
    <p className="font-medium text-[color:var(--findable-ink,#f7f8f8)] text-xs">
      {t.title}
    </p>
    <ul className="flex list-disc flex-col gap-1 pl-4">
      <li className={ITEM_CLASS}>{t.withdraw}</li>
      <li className={ITEM_CLASS}>{t.prorate}</li>
      <li className={ITEM_CLASS}>
        {t.requestVia.replace("{email}", REFUND_CONTACT_EMAIL)}
      </li>
      {kind === "subscription" ? (
        <li className={ITEM_CLASS}>{t.subscriptionCancel}</li>
      ) : (
        <li className={ITEM_CLASS}>{t.oneOff}</li>
      )}
    </ul>
    <p className={ITEM_CLASS}>
      {t.detailsBefore}{" "}
      <a
        className="underline underline-offset-4 hover:text-[color:var(--findable-ink,#f7f8f8)]"
        href={termsHref}
        rel="noopener"
        target="_blank"
      >
        {t.detailsLink}
      </a>
      {t.detailsAfter}
    </p>
  </div>
);
