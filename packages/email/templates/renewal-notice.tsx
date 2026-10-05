import {
  Body,
  Button,
  Container,
  Head,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";

/**
 * 정기결제 갱신 사전 안내 메일 (2026-10-05).
 *
 * 자동 재측정 cron(`apps/app/app/api/cron/auto-refresh-tracking`)이 다음 결제 예정일 3일 전부터
 * 예약 결제 1건당 한 번 보낸다(`apps/app/lib/billing/renewal-notice.ts`).
 * 담는 것: 결제 예정일·금액(VAT 포함)·결제수단·해지 방법. 금액은 호출부가 서버 카탈로그에서 가져온다.
 *
 * ⚠️ 해요체·능동태. 해지를 만류하는 문구를 넣지 않는다(다크패턴 금지).
 */

export interface RenewalNoticeEmailProps {
  /** VAT 포함 청구 금액(원). */
  readonly amountKrw: number;
  /** 요금제 화면(해지 버튼이 있는 곳) 주소. */
  readonly billingUrl: string;
  /** 결제 예정일 표시 문자열(예: "2026년 10월 7일"). */
  readonly paymentDateLabel: string;
  /** 결제수단 표시 문자열. */
  readonly paymentMethodLabel: string;
  /** 플랜 표시명(예: "Starter"). */
  readonly planName: string;
  /** 이용약관(환불 규정) 주소. */
  readonly termsUrl: string;
}

const won = (n: number) => `₩${n.toLocaleString("ko-KR")}`;

const ROW_LABEL = {
  color: "#71717a",
  fontSize: "13px",
  lineHeight: 1.6,
  margin: "0",
} as const;
const ROW_VALUE = {
  color: "#09090b",
  fontSize: "15px",
  fontWeight: 600,
  lineHeight: 1.6,
  margin: "0 0 10px",
  wordBreak: "keep-all",
} as const;
const BODY_TEXT = {
  color: "#52525b",
  fontSize: "14px",
  lineHeight: 1.7,
  margin: "0 0 8px",
  wordBreak: "keep-all",
} as const;

export const RenewalNoticeEmail = ({
  amountKrw,
  billingUrl,
  paymentDateLabel,
  paymentMethodLabel,
  planName,
  termsUrl,
}: RenewalNoticeEmailProps) => (
  <Html>
    <Head />
    <Preview>
      {`${paymentDateLabel}에 Findable ${planName} 정기결제 ${won(amountKrw)}이 결제될 예정이에요`}
    </Preview>
    <Body
      style={{
        backgroundColor: "#fafafa",
        fontFamily: "Pretendard, -apple-system, BlinkMacSystemFont, sans-serif",
      }}
    >
      <Container style={{ margin: "0 auto", padding: "48px 0" }}>
        <Section
          style={{
            backgroundColor: "#ffffff",
            border: "1px solid #e4e4e7",
            borderRadius: "6px",
            padding: "32px",
          }}
        >
          <Text
            style={{
              color: "#09090b",
              fontSize: "20px",
              fontWeight: 600,
              lineHeight: 1.6,
              margin: "0 0 16px",
              wordBreak: "keep-all",
            }}
          >
            정기결제 예정 안내
          </Text>
          <Text style={BODY_TEXT}>
            {`Findable ${planName} 월 정기결제가 아래와 같이 결제될 예정이에요.`}
          </Text>

          <Hr style={{ borderColor: "#e4e4e7", margin: "20px 0" }} />

          <Text style={ROW_LABEL}>결제 예정일</Text>
          <Text style={ROW_VALUE}>{paymentDateLabel}</Text>
          <Text style={ROW_LABEL}>결제 금액</Text>
          <Text style={ROW_VALUE}>{`${won(amountKrw)} (VAT 포함)`}</Text>
          <Text style={ROW_LABEL}>결제수단</Text>
          <Text style={ROW_VALUE}>{paymentMethodLabel}</Text>

          <Hr style={{ borderColor: "#e4e4e7", margin: "20px 0" }} />

          <Text style={BODY_TEXT}>
            계속 이용하시려면 따로 하실 일은 없어요.
          </Text>
          <Text style={BODY_TEXT}>
            해지하려면 결제 예정일 전에 요금제 화면에서 「정기결제 해지」를 눌러
            주세요. 해지하면 다음 결제는 청구되지 않고, 이미 결제한 기간이 끝날
            때까지 이용할 수 있어요.
          </Text>

          <Button
            href={billingUrl}
            style={{
              backgroundColor: "#f97316",
              borderRadius: "6px",
              color: "#ffffff",
              display: "inline-block",
              fontSize: "14px",
              fontWeight: 600,
              marginTop: "12px",
              padding: "12px 20px",
              textDecoration: "none",
            }}
          >
            요금제 화면 열기
          </Button>

          <Text
            style={{
              color: "#71717a",
              fontSize: "12px",
              lineHeight: 1.7,
              margin: "20px 0 0",
              wordBreak: "keep-all",
            }}
          >
            정기결제를 이용 중이라 보내 드리는 안내예요. 환불·청약철회 기준은{" "}
            <Link href={termsUrl} style={{ color: "#71717a" }}>
              이용약관
            </Link>
            에서 확인할 수 있어요.
          </Text>
        </Section>
      </Container>
    </Body>
  </Html>
);

RenewalNoticeEmail.PreviewProps = {
  amountKrw: 108_900,
  billingUrl: "https://app.findable.co.kr/billing",
  paymentDateLabel: "2026년 10월 7일",
  paymentMethodLabel: "정기결제에 등록하신 간편결제 수단",
  planName: "Starter",
  termsUrl: "https://findable.co.kr/ko/legal/terms",
} as RenewalNoticeEmailProps;

export default RenewalNoticeEmail;
