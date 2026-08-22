import {
  Body,
  Button,
  Container,
  Head,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import type * as React from "react";

export function NewsletterConfirmationEmail({
  confirmUrl,
  publisherName,
}: {
  readonly confirmUrl: string;
  readonly publisherName: string;
}): React.JSX.Element {
  return (
    <Html>
      <Head />
      <Preview>{publisherName} 뉴스레터 구독 확인</Preview>
      <Body style={{ background: "#f5f1e8", fontFamily: "sans-serif" }}>
        <Container style={{ margin: "40px auto", maxWidth: 560 }}>
          <Section style={{ background: "white", padding: 32 }}>
            <Text style={{ color: "#e86f45", fontSize: 12, letterSpacing: 2 }}>
              {publisherName} · NEWSLETTER
            </Text>
            <Text style={{ color: "#1f211f", fontSize: 28, fontWeight: 700 }}>
              이메일 주소를 확인해 주세요
            </Text>
            <Text style={{ color: "#5f625e", lineHeight: 1.7 }}>
              아래 버튼을 누르면 새 글 알림 구독이 시작됩니다. 확인하지 않으면
              이메일을 보내지 않습니다.
            </Text>
            <Button
              href={confirmUrl}
              style={{
                background: "#1f211f",
                color: "white",
                padding: "12px 20px",
              }}
            >
              구독 확인
            </Button>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

export default NewsletterConfirmationEmail;
