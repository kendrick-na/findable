import {
  Body,
  Button,
  Container,
  Head,
  Hr,
  Html,
  Preview,
  Section,
  Tailwind,
  Text,
} from "@react-email/components";

/**
 * 파트너 신청 결과 안내 메일 — 승인/거절 공용.
 *
 * decide.ts(승인/거절 서버액션)가 결정 직후 신청자에게 발송한다.
 * 승인 시 Growth 상당 접근권 부여 사실 + 대시보드 진입 CTA,
 * 거절 시 사유(note) 표시 + 재신청 안내. 한국어(Findable 주 고객 KO).
 */

interface PartnerDecisionEmailProps {
  /** 승인 시 대시보드 진입 링크. */
  readonly appUrl: string;
  readonly decision: "approved" | "rejected";
  /** 신청자 표시 이름(없으면 "파트너님"). */
  readonly name?: string;
  /** 거절 사유(관리자 note). 승인 시 무시. */
  readonly note?: string;
}

export const PartnerDecisionEmail = ({
  decision,
  name,
  note,
  appUrl,
}: PartnerDecisionEmailProps) => {
  const who = name?.trim() ? name : "파트너님";
  const approved = decision === "approved";
  const preview = approved
    ? "Findable 파트너 신청이 승인되었습니다"
    : "Findable 파트너 신청 결과 안내";

  return (
    <Tailwind>
      <Html>
        <Head />
        <Preview>{preview}</Preview>
        <Body className="bg-zinc-50 font-sans">
          <Container className="mx-auto py-12">
            <Section className="mt-8 rounded-md bg-zinc-200 p-px">
              <Section className="rounded-[5px] bg-white p-8">
                <Text className="mt-0 mb-4 font-semibold text-2xl text-zinc-950">
                  {approved
                    ? "파트너 신청이 승인되었습니다 🎉"
                    : "파트너 신청 결과 안내"}
                </Text>

                <Text className="m-0 text-zinc-600">
                  {who}, 안녕하세요. Findable 파트너 신청 결과를 안내드립니다.
                </Text>

                <Hr className="my-4" />

                {approved ? (
                  <>
                    <Text className="m-0 text-zinc-600">
                      신청이 <strong>승인</strong>되었습니다. 이제 경쟁사
                      비교·자동 추적·리포트 Export 등 Growth 기능을 사용하실 수
                      있습니다. 아래 버튼으로 대시보드에 접속해 주세요.
                    </Text>
                    <Button
                      className="mt-6 rounded-md bg-orange-500 px-5 py-3 font-semibold text-white"
                      href={appUrl}
                    >
                      대시보드 열기
                    </Button>
                  </>
                ) : (
                  <>
                    <Text className="m-0 text-zinc-600">
                      아쉽게도 이번 신청은 <strong>승인되지 않았습니다</strong>.
                    </Text>
                    {note?.trim() ? (
                      <>
                        <Text className="mt-4 mb-1 font-medium text-zinc-700">
                          사유
                        </Text>
                        <Text className="m-0 text-zinc-600">{note}</Text>
                      </>
                    ) : null}
                    <Text className="mt-4 text-zinc-600">
                      보완 후 언제든 다시 신청하실 수 있습니다. 문의사항은 본
                      메일에 회신해 주세요.
                    </Text>
                  </>
                )}
              </Section>
            </Section>
          </Container>
        </Body>
      </Html>
    </Tailwind>
  );
};

PartnerDecisionEmail.PreviewProps = {
  decision: "approved",
  name: "홍길동",
  appUrl: "https://app.findable.co.kr",
} as PartnerDecisionEmailProps;

export default PartnerDecisionEmail;
