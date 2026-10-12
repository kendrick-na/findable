import { createHash } from "node:crypto";

/**
 * 승인된 저장 질문 전체의 지문(2026-10-13) — 비교 키(`+qs:<지문>`)에 붙는다.
 *
 * 질문 세트가 바뀌면(추가·삭제·수정) 지문이 달라져 직전 대비·추세가 「비교 불가(측정 방식 변경)」가 된다
 * (새 기준선). 한 회차에 묻는 8개(순환 선택)가 아니라 **승인된 전체 세트** 기준이라, 순환 때문에
 * 비교가 깨지지 않는다. 질문별 시계열(promptId)은 이 지문과 무관하게 유지된다.
 *
 * 순서·대소문자·앞뒤 공백·중복은 무시한다. 질문이 없으면 null(키에 붙이지 않는다).
 */
export function questionSetKeyOf(texts: readonly string[]): string | null {
  const unique = [
    ...new Set(
      texts
        .map((t) => t.trim().toLowerCase().replace(/\s+/g, " "))
        .filter(Boolean)
    ),
  ].sort();
  if (unique.length === 0) {
    return null;
  }
  return createHash("sha1").update(unique.join("\n")).digest("hex").slice(0, 8);
}
