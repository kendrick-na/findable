// MCP 응답 문구 — 한국어 고정. 정책 규칙(2026-10-17 개발기획서 7장):
//   - 업그레이드·가격·결제·할인·무료체험 문구 금지(ChatGPT 디지털 상품 결제 유도 금지)
//   - 모델에게 행동을 지시하는 문장 금지(설명엔 동작 사실만). 다음 행동 안내는 응답값(message_ko)에.
//   - 점수 하나로 단정하지 않는다. 한계 문구는 매 결과에 고정.

export const LIMITS_KO =
  "AI 답변은 매번 달라질 수 있고, 이 간이 진단은 표본(질문·엔진 수)이 적습니다. 점수 하나로 판단하지 마세요.";

export const FACTS_LIMITS_KO =
  "공개된 페이지만 확인했으며, 로그인이 필요한 페이지와 AI 엔진의 실제 답변은 보지 않습니다.";

export const SITE_URL = "https://findable.co.kr";

export type McpErrorCode =
  | "url_required"
  | "url_invalid"
  | "url_unsafe"
  | "private_address"
  | "dns_failed"
  | "job_not_found"
  | "disabled"
  | "internal";

export const ERROR_MESSAGES_KO: Record<McpErrorCode, string> = {
  url_required:
    "사이트 주소가 필요합니다. https://로 시작하는 공개 주소를 알려주세요.",
  url_invalid:
    "사이트 주소를 확인할 수 없습니다. https://로 시작하는 공개 주소를 알려주세요.",
  url_unsafe:
    "이 주소는 점검할 수 없습니다. 일반 웹 주소(포트 없음)를 알려주세요.",
  private_address:
    "비공개 주소는 점검할 수 없습니다. 인터넷에 공개된 사이트 주소를 알려주세요.",
  dns_failed: "이 도메인을 찾을 수 없습니다. 주소 철자를 확인해 주세요.",
  job_not_found:
    "해당 측정 번호를 찾을 수 없습니다. start_ai_visibility_check 가 돌려준 job_id 를 확인해 주세요.",
  disabled: "이 커넥터는 현재 준비 중입니다.",
  internal: "일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.",
};

/** `normalizePublicUrl`·`assertPublicUrl` 이 던지는 코드 → 사람 말 코드. */
export function mapUrlError(error: unknown): McpErrorCode {
  const code = error instanceof Error ? error.message : "";
  switch (code) {
    case "URL_REQUIRED":
      return "url_required";
    case "URL_INVALID":
    case "URL_PROTOCOL":
      return "url_invalid";
    case "URL_UNSAFE":
      return "url_unsafe";
    case "URL_PRIVATE":
      return "private_address";
    case "URL_DNS":
      return "dns_failed";
    default:
      return "internal";
  }
}

/**
 * 사이트로 보내는 정보 링크 — 가격·결제 페이지가 아니라 첫 화면. 출처 추적용 UTM 포함.
 * 🔴 `/audit` 로 보내지 않는다: 공개 무료 진단은 기본 꺼짐(404, 2026-10-07 대표 결정)이라 링크가 깨진다.
 *    진단 화면을 다시 열면 그때 목적지를 바꾼다(대표 결정 후).
 */
export function siteLink(client: string): string {
  const params = new URLSearchParams({
    utm_source: "mcp",
    utm_medium: client,
  });
  return `${SITE_URL}/ko?${params.toString()}`;
}
