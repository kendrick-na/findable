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

/**
 * 주간 재측정 결과 알림 메일 (투두 #68, 2026-08-08 세션N-11).
 *
 * 자동 재측정 cron(`apps/web/app/api/cron/auto-refresh-tracking`)이 측정을 끝낸 뒤,
 * **직전 대비 점수가 의미 있게 움직인 브랜드만** 모아 org 소유자에게 보낸다.
 *
 * 🔒 왜 "변화가 있을 때만" 인가: 변화 없는 메일이 반복되면 스팸으로 학습되어
 *   정작 중요한 알림도 열리지 않는다. 메일이 도착한 것 자체가 "볼 이유가 있다"는 신호여야 한다.
 *   (유료가 이겨야 할 축 = 시간·비교·**알림** — 알림의 가치는 정확도에서 나온다.)
 *
 * ⚠️ 한국어 UX 라이팅 규칙 적용: 해요체·능동태. **부정 감정을 과장하지 않는다** —
 *   하락은 사실만 전하고(빨간 경고문·느낌표 금지) 다음 행동을 안내한다.
 */

export interface TrackingDigestItem {
  /** 브랜드 표시명. */
  readonly brandName: string;
  /** 직전 대비 점수 변화(양수=개선). */
  readonly deltaPoints: number;
  /** 이번 측정 총점. */
  readonly score: number;
}

interface TrackingDigestEmailProps {
  /** 대시보드 진입 링크. */
  readonly appUrl: string;
  /** 변화가 감지된 브랜드들(호출부가 이미 필터·정렬한 것). */
  readonly items: readonly TrackingDigestItem[];
}

/** `+5점` / `-3점` — 부호를 항상 붙여 방향이 한눈에 보이게. */
const formatDelta = (delta: number): string =>
  `${delta > 0 ? "+" : ""}${delta}점`;

export const TrackingDigestEmail = ({
  items,
  appUrl,
}: TrackingDigestEmailProps) => {
  const first = items.at(0);
  // 미리보기 줄 = 받은 편지함에서 열지 말지를 결정하는 한 줄. 가장 큰 변화를 앞세운다.
  const preview = first
    ? `${first.brandName} ${formatDelta(first.deltaPoints)} (총 ${first.score}점)`
    : "AI 검색 노출 점수가 변했어요";

  return (
    <Html>
      <Head />
      <Preview>{preview}</Preview>
      <Body
        style={{
          backgroundColor: "#fafafa",
          fontFamily:
            "Pretendard, -apple-system, BlinkMacSystemFont, sans-serif",
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
              AI 검색 노출 점수가 변했어요
            </Text>

            <Text
              style={{
                color: "#52525b",
                fontSize: "14px",
                lineHeight: 1.7,
                margin: 0,
                wordBreak: "keep-all",
              }}
            >
              자동 재측정 결과, 지난번과 달라진 브랜드를 알려드려요.
            </Text>

            <Hr style={{ borderColor: "#e4e4e7", margin: "20px 0" }} />

            {items.map((item) => (
              <Section key={item.brandName} style={{ marginBottom: "12px" }}>
                <Text
                  style={{
                    color: "#09090b",
                    fontSize: "15px",
                    fontWeight: 600,
                    lineHeight: 1.6,
                    margin: "0 0 2px",
                    wordBreak: "keep-all",
                  }}
                >
                  {item.brandName}
                </Text>
                <Text
                  style={{
                    // 상승/하락 모두 같은 크기·굵기. 하락을 시각적으로 위협하지 않는다.
                    color: item.deltaPoints > 0 ? "#15803d" : "#52525b",
                    fontSize: "14px",
                    lineHeight: 1.7,
                    margin: 0,
                  }}
                >
                  {formatDelta(item.deltaPoints)} · 총 {item.score}점
                </Text>
              </Section>
            ))}

            <Button
              href={appUrl}
              style={{
                backgroundColor: "#f97316",
                borderRadius: "6px",
                color: "#ffffff",
                display: "inline-block",
                fontSize: "14px",
                fontWeight: 600,
                marginTop: "20px",
                padding: "12px 20px",
                textDecoration: "none",
              }}
            >
              무엇이 달라졌는지 보기
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
              점수가 크게 움직였을 때만 보내드려요. 변화가 없는 주에는 메일이
              오지 않아요.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
};

TrackingDigestEmail.PreviewProps = {
  appUrl: "https://app.findable.co.kr",
  items: [
    { brandName: "설화수", deltaPoints: 7, score: 68 },
    { brandName: "메디큐브", deltaPoints: -4, score: 51 },
  ],
} as TrackingDigestEmailProps;

export default TrackingDigestEmail;
