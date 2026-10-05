/**
 * 브라우저 `Accept-Language` 헤더에서 `apps/app` 로케일(ko/en)을 고른다.
 *
 * 📐 규칙(`docs/_적용/영어화면_범위_20261006.md` 3장): 가중치(q) 높은 순으로 보고
 *   **ko 와 en 중 먼저 나오는 쪽**. 둘 다 없으면 null(호출부가 기본값 ko 로 떨어뜨린다).
 *   예) `en-US,en;q=0.9,ko;q=0.8` → en · `ko-KR,en;q=0.9` → ko · `ja,zh` → null
 * ⚠️ IP 국가는 쓰지 않는다 — 해외 출장 중인 한국 고객에게 영어 화면이 뜨기 때문(웹과 다름).
 */
export type AcceptLocale = "ko" | "en";

export const pickLocaleFromAcceptLanguage = (
  header: string | null | undefined
): AcceptLocale | null => {
  if (!header) {
    return null;
  }

  const ranked = header
    .split(",")
    .map((part, index) => {
      const [tag = "", ...params] = part.trim().split(";");
      const qParam = params.find((p) => p.trim().startsWith("q="));
      const q = qParam ? Number.parseFloat(qParam.trim().slice(2)) : 1;
      return {
        index,
        lang: tag.trim().toLowerCase().split("-")[0] ?? "",
        q: Number.isFinite(q) ? q : 0,
      };
    })
    .filter((entry) => entry.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index);

  for (const { lang } of ranked) {
    if (lang === "ko" || lang === "en") {
      return lang;
    }
  }
  return null;
};
