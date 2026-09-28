/**
 * 네이버 AI 브리핑 질의 선택 — 업종에 맞는 질문을 고른다 (2026-09-29).
 *
 * 🔴 실측: 질의가 업종과 무관하게 「{브랜드} 효과 → 후기 → 장단점」 고정이었다.
 *   「노우버스 효과」·「인디고차일드 효과」 는 B2B 서비스 회사에 **말이 안 되는 질문**이다
 *   (효과는 화장품·건강식품에 묻는 말). 공개 JSON 두 건 모두 이 질의로 측정됐다.
 *
 * 규칙(재료 = 고객이 준 업종 + 공식 사이트가 스스로 쓴 제목·설명):
 *   · 뷰티·건강 단서가 있으면 → 기존 그대로(효과·후기·장단점). 실측으로 브리핑이 뜨는 질의.
 *   · B2B·서비스 단서가 있으면 → 「서비스 · 가격 · 후기」.
 *   · 아무 단서도 없으면 → 기존 그대로(동작을 바꿀 근거가 없다).
 *   업종 칸이 채워져 있으면 그것을 먼저 믿는다(사람이 적은 값 > 사이트 문구).
 */

export type BriefingQueryCategory = "consumer_effect" | "service";

export interface BriefingQueryContext {
  industry?: string | null;
  site?: {
    description?: string | null;
    h1?: string | null;
    siteName?: string | null;
    title?: string | null;
  } | null;
}

const CONSUMER_EFFECT_RE =
  /뷰티|화장품|코스메틱|스킨케어|피부|건강|영양제|식품|헬스|다이어트|의약|약국|병원|클리닉|한의원|beauty|cosmetic|skin ?care|supplement|wellness|nutrition|health/i;
const SERVICE_RE =
  /서비스|컨설팅|솔루션|플랫폼|에이전시|대행|교육|강의|구독|B2B|기업|소프트웨어|SaaS|개발|마케팅|기술|인공지능|데이터|실사|\bAI\b|agency|consulting|software|platform|service|solution|enterprise|training|subscription/i;

function categoryOf(text: string): BriefingQueryCategory | null {
  if (!text.trim()) {
    return null;
  }
  if (CONSUMER_EFFECT_RE.test(text)) {
    return "consumer_effect";
  }
  if (SERVICE_RE.test(text)) {
    return "service";
  }
  return null;
}

export function briefingQueryCategory(
  context: BriefingQueryContext
): BriefingQueryCategory {
  const fromIndustry = categoryOf(context.industry ?? "");
  if (fromIndustry) {
    return fromIndustry;
  }
  const site = context.site;
  const fromSite = categoryOf(
    [site?.title, site?.h1, site?.description].filter(Boolean).join(" ")
  );
  return fromSite ?? "consumer_effect";
}

/** 노출률 높은 순의 후보 질의 — 브리핑이 처음 뜬 것을 채택한다(러너 루프). */
export function briefingCandidatePrompts(
  brand: string,
  language: "ko" | "en",
  context: BriefingQueryContext
): string[] {
  const category = briefingQueryCategory(context);
  if (language === "en") {
    return category === "service"
      ? [`${brand} services`, `${brand} pricing`, `${brand} review`]
      : [`${brand} review`, `${brand} pros and cons`, `Is ${brand} good`];
  }
  return category === "service"
    ? [`${brand} 서비스`, `${brand} 가격`, `${brand} 후기`]
    : [`${brand} 효과`, `${brand} 후기`, `${brand} 장단점`];
}
