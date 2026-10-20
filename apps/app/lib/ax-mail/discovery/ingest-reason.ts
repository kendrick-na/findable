import type { IngestSourceResult } from "./ingest-runner";

/**
 * 원천별 결과 → 화면에 보일 이유 코드. 화면 문구는 i18n 사전(salesDiscover.ingestReason)에서 고른다.
 * - ok: 처리 완료
 * - timeout: 시간 예산을 다 써서 멈춤(partial) — 「이어서 불러오기」 대상
 * - source_unavailable: 키 없음 또는 원천 응답 없음
 * - error: 그 밖의 오류(원천 하나만 빠지고 나머지는 계속)
 * db_not_ready 는 서버 액션이 실패로 돌려주므로(화면의 errors.db_not_ready) 여기서 다루지 않는다.
 */
export type IngestReason = "ok" | "timeout" | "source_unavailable" | "error";

export function ingestReasonCode(r: IngestSourceResult): IngestReason {
  switch (r.status) {
    case "ok":
      return "ok";
    case "partial":
      return "timeout";
    case "unavailable":
      return "source_unavailable";
    default:
      return "error";
  }
}
