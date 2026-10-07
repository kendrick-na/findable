import {
  isPublishedReportUrl,
  OUTREACH_SENDER,
  UNSUBSCRIBE_LINE,
  UNSUBSCRIBE_LINE_EN,
} from "../leads";

/**
 * 「회사 찾기」 카드의 메일 초안 뼈대 — 측정 숫자를 넣지 않는다(이 화면엔 검증된 관찰이 없다).
 * 숫자·관찰이 들어간 초안은 기존 「영업 실행」 화면(leads.ts composeOutreachDraft)이 만든다.
 *
 * 리포트 링크가 없으면 자리표시 줄을 둔다 → 서버(drafts route)가 report_link_missing 으로 저장을 막는다.
 * 전송자·수신거부 안내(정보통신망법 제50조 제4항)는 항상 들어간다.
 */
export const REPORT_PLACEHOLDER = "[발송 승인된 리포트 링크]";

function josa(word: string, withBatchim: string, without: string): string {
  const last = word.trim().at(-1) ?? "";
  const code = last.charCodeAt(0) - 0xac_00;
  if (code < 0 || code > 11_171) {
    return withBatchim;
  }
  return code % 28 === 0 ? without : withBatchim;
}

export function composeCompanyDraft(input: {
  companyName: string;
  recipient: string;
  reportUrl: string | null;
}): { body: string; recipient: string; subject: string } {
  const name = input.companyName.trim();
  const link =
    input.reportUrl && isPublishedReportUrl(input.reportUrl)
      ? input.reportUrl
      : REPORT_PLACEHOLDER;
  const lines = [
    `안녕하세요, ${name} 담당자님.`,
    "AI 검색 진단 서비스 Findable을 운영하는 나현덕입니다.",
    "",
    `${name}${josa(name, "이", "가")} ChatGPT 같은 AI 검색에서 어떻게 소개되는지 확인해 정리했습니다.`,
    "답변 원문과 개선 방향은 아래 링크에 있습니다.",
    link,
    "",
    "괜찮으시다면 15분 정도 통화로 결과를 설명드리고 싶습니다.",
    "",
    "감사합니다.",
    "나현덕 드림",
    "Findable 대표 | www.findable.co.kr",
    "",
    `보낸 사람: ${OUTREACH_SENDER.legalName} · ${OUTREACH_SENDER.email}`,
    UNSUBSCRIBE_LINE,
    UNSUBSCRIBE_LINE_EN,
  ];
  return {
    body: lines.join("\n"),
    recipient: input.recipient,
    subject: `${name} AI 검색 노출 확인 결과 공유`,
  };
}
