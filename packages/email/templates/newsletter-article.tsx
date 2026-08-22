import {
  Body,
  Button,
  Container,
  Head,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import type * as React from "react";

export function NewsletterArticleEmail({
  articleUrl,
  excerpt,
  publisherName,
  title,
  unsubscribeUrl,
}: {
  readonly articleUrl: string;
  readonly excerpt: string;
  readonly publisherName: string;
  readonly title: string;
  readonly unsubscribeUrl: string;
}): React.JSX.Element {
  return (
    <Html>
      <Head />
      <Preview>{title}</Preview>
      <Body style={{ background: "#f5f1e8", fontFamily: "sans-serif" }}>
        <Container style={{ margin: "40px auto", maxWidth: 620 }}>
          <Section style={{ background: "white", padding: 36 }}>
            <Text style={{ color: "#e86f45", fontSize: 12, letterSpacing: 2 }}>
              {publisherName}
            </Text>
            <Text
              style={{
                color: "#1f211f",
                fontSize: 30,
                fontWeight: 700,
                lineHeight: 1.25,
              }}
            >
              {title}
            </Text>
            <Text style={{ color: "#5f625e", fontSize: 16, lineHeight: 1.75 }}>
              {excerpt}
            </Text>
            <Button
              href={articleUrl}
              style={{
                background: "#1f211f",
                color: "white",
                padding: "12px 20px",
              }}
            >
              글 전체 읽기
            </Button>
            <Hr style={{ borderColor: "#e8e5dd", margin: "32px 0 20px" }} />
            <Text style={{ color: "#8a8c87", fontSize: 12 }}>
              더 이상 받고 싶지 않다면 <a href={unsubscribeUrl}>수신거부</a>를
              진행하세요.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

export default NewsletterArticleEmail;
