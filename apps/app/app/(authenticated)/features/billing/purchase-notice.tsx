/**
 * 결제 전 청약철회·환불·해지 고지 — 2026-10-05.
 *
 * ⚖️ 근거: 전자상거래법 제13조 제2항(청약철회 기한·행사방법·효과 고지), 제17조 제6항
 *   (철회가 제한되는 경우 그 사실을 쉽게 알 수 있는 곳에 명확히 표시 — 안 하면 전액 환불),
 *   콘텐츠이용자 보호지침 제7조·제19조, 소비자분쟁해결기준 인터넷콘텐츠업.
 *   문구는 이용약관 제4조의3 초안(docs/terms-billing-alignment-20261005)과 같은 내용을 줄인 것이다.
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
}: {
  kind: "subscription" | "one-off";
  termsHref: string;
}) => (
  <div className="flex flex-col gap-1.5 border-[color:var(--findable-hairline,#23252a)] border-t pt-3">
    <p className="font-medium text-[color:var(--findable-ink,#f7f8f8)] text-xs">
      청약철회·환불 안내
    </p>
    <ul className="flex list-disc flex-col gap-1 pl-4">
      <li className={ITEM_CLASS}>
        결제일부터 7일 이내에 청약철회할 수 있어요. 그동안 유료 기능을 쓰지
        않았다면 전액 환불돼요.
      </li>
      <li className={ITEM_CLASS}>
        유료 기능(자동 재측정·측정 데이터 내보내기)을 이용하면 이용일수만큼
        공제하고 나머지를 환불해요.
      </li>
      <li className={ITEM_CLASS}>
        {`요금제 화면의 「환불·청약철회 요청」 또는 이메일(${REFUND_CONTACT_EMAIL})로 요청할 수 있어요.`}{" "}
        요청을 받은 날부터 3영업일 이내에 결제를 취소해 환불하고, 유료 기능
        이용과 다음 결제는 함께 종료돼요.
      </li>
      {kind === "subscription" ? (
        <li className={ITEM_CLASS}>
          언제든 해지할 수 있어요. 해지하면 다음 결제는 청구되지 않고, 이미
          결제한 기간이 끝날 때까지 이용할 수 있어요.
        </li>
      ) : (
        <li className={ITEM_CLASS}>
          1개월 이용권은 자동으로 갱신되지 않아 따로 해지할 필요가 없어요.
        </li>
      )}
    </ul>
    <p className={ITEM_CLASS}>
      자세한 내용은{" "}
      <a
        className="underline underline-offset-4 hover:text-[color:var(--findable-ink,#f7f8f8)]"
        href={termsHref}
        rel="noopener"
        target="_blank"
      >
        이용약관(환불 규정)
      </a>
      에서 확인할 수 있어요.
    </p>
  </div>
);
