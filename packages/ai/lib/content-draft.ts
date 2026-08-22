import { generateObject } from "ai";
import { z } from "zod";
import { models } from "./models";

export interface ContentDraftInput {
  action: {
    evidence: string;
    how: string;
    source?: string;
    title: string;
  };
  brand: {
    domain: string;
    name: string;
  };
  locale: "ko" | "en";
  measurement: {
    enginesMeasured: number;
    enginesMentioned: number;
    measuredAt: string;
    shareOfVoice: number | null;
    sourceDomains: string[];
    weakPrompts: string[];
  };
}

export interface GeneratedContentDraft {
  bodyMarkdown: string;
  excerpt: string;
  generationPrompt: string;
  model: string;
  title: string;
  usedFallback: boolean;
}

const draftSchema = z.object({
  title: z.string().min(8).max(90),
  excerpt: z.string().min(30).max(220),
  bodyMarkdown: z.string().min(500).max(20_000),
});

const buildPrompt = (
  input: ContentDraftInput
) => `You are the evidence editor for Findable, an SEO/GEO measurement platform.
Write a publication-ready ${input.locale === "ko" ? "Korean" : "English"} article for ${input.brand.name} (${input.brand.domain}).

The article must answer a real reader question and be useful even if search engines did not exist. It must be grounded only in the evidence below.

Action: ${input.action.title}
Measured evidence: ${input.action.evidence}
Recommended method: ${input.action.how}
Evidence source: ${input.action.source ?? "Findable measurement"}
Measurement date: ${input.measurement.measuredAt}
AI engines measured: ${input.measurement.enginesMeasured}
AI engines mentioning the brand: ${input.measurement.enginesMentioned}
Share of voice: ${input.measurement.shareOfVoice ?? "not measured"}
Observed source domains: ${input.measurement.sourceDomains.join(", ") || "none observed"}
Weak customer prompts: ${input.measurement.weakPrompts.join(" | ") || "none observed"}

Rules:
- Never invent a customer quote, result, award, study, statistic, product feature, or source.
- Clearly label Findable measurements with their date and sample context. Do not generalize them to the whole market.
- Use one H1-equivalent title in the title field; bodyMarkdown starts with a short answer, then ## headings.
- Include a compact "측정 근거" or "Measurement basis" section and a "다음 액션" or "Next action" section.
- Add the evidence source in prose. Include links only when a URL/domain was supplied.
- Prefer precise sentences and concrete claims. Avoid keyword repetition, hype, filler, and claims about ranking guarantees.
- Do not output HTML or MDX. Plain Markdown only.`;

const fallbackDraft = (input: ContentDraftInput): GeneratedContentDraft => {
  const ko = input.locale === "ko";
  const rate =
    input.measurement.enginesMeasured > 0
      ? Math.round(
          (input.measurement.enginesMentioned /
            input.measurement.enginesMeasured) *
            100
        )
      : null;
  const title = ko
    ? `${input.brand.name}의 AI 검색 가시성을 높이기 위한 근거 중심 콘텐츠 전략`
    : `An evidence-led content strategy for ${input.brand.name}'s AI visibility`;
  const excerpt = ko
    ? `${input.brand.name}의 최근 AI 검색 측정 결과를 바탕으로, 과장 없이 인용 가능한 정보를 만드는 방법을 정리했습니다.`
    : `A practical, evidence-led plan for improving ${input.brand.name}'s AI-search visibility without unsupported claims.`;
  const bodyMarkdown = ko
    ? `${input.action.evidence}\n\n이 결과가 말해주는 핵심은 단순히 브랜드명을 더 많이 반복하라는 것이 아닙니다. AI 답변이 참고할 수 있는 명확하고 검증 가능한 문장을 브랜드가 소유한 페이지에 제공해야 한다는 뜻입니다.\n\n## 측정 근거\n\n- 측정일: ${input.measurement.measuredAt}\n- 측정한 AI 엔진: ${input.measurement.enginesMeasured}개\n- 브랜드를 언급한 엔진: ${input.measurement.enginesMentioned}개${rate === null ? "" : ` (${rate}%)`}\n- 관찰된 주요 출처: ${input.measurement.sourceDomains.join(", ") || "확인된 출처 없음"}\n\n이 수치는 해당 측정 회차의 표본을 설명하며 시장 전체를 대표하지 않습니다. 근거는 ${input.action.source ?? "Findable 측정 데이터"}입니다.\n\n## 무엇을 고쳐야 하나\n\n${input.action.how}\n\n좋은 페이지는 첫 문단에서 독자의 질문에 직접 답하고, 이어지는 문단에서 그 답을 검증할 수 있는 수치·조건·출처를 제공합니다. 제품이나 서비스의 범위, 적용 조건, 예외를 함께 적으면 사람과 AI 모두 문맥을 오해할 가능성이 줄어듭니다.\n\n## 독자가 바로 확인할 정보\n\n${input.brand.name}에 관한 핵심 설명은 공식 사이트(${input.brand.domain})의 여러 페이지에서 서로 모순되지 않아야 합니다. 오래된 표현이나 확인되지 않은 최상급 표현은 삭제하고, 실제로 확인 가능한 사실만 남겨야 합니다.\n\n## 다음 액션\n\n1. 공식 소개 페이지의 첫 문단을 한 문장 답변 형태로 정리합니다.\n2. 주장마다 날짜·조건·원출처를 붙입니다.\n3. 다음 측정에서 같은 질문에 대한 언급과 인용 출처 변화를 비교합니다.\n\n발행 뒤에는 순위 상승을 가정하지 않고 재측정 결과로 효과를 판단합니다.`
    : `${input.action.evidence}\n\nThe useful conclusion is not to repeat the brand name more often. It is to publish clear, verifiable statements that an AI answer can understand and cite.\n\n## Measurement basis\n\n- Measured on: ${input.measurement.measuredAt}\n- AI engines measured: ${input.measurement.enginesMeasured}\n- Engines mentioning the brand: ${input.measurement.enginesMentioned}${rate === null ? "" : ` (${rate}%)`}\n- Observed source domains: ${input.measurement.sourceDomains.join(", ") || "No source observed"}\n\nThese figures describe this measurement sample, not the entire market. The evidence source is ${input.action.source ?? "Findable measurement data"}.\n\n## What to improve\n\n${input.action.how}\n\nA useful page answers the reader's question immediately and then supplies the conditions, figures, and sources needed to verify that answer. Product scope and exceptions should be explicit so that both people and AI systems have less room to misread the claim.\n\n## Information readers can verify\n\nCore descriptions of ${input.brand.name} should stay consistent across the official site (${input.brand.domain}). Remove stale language and unsupported superlatives, and keep only facts that a reader can check.\n\n## Next action\n\n1. Rewrite the opening paragraph as a direct answer.\n2. Attach a date, condition, and original source to each material claim.\n3. Re-run the same prompts and compare mentions and cited sources.\n\nDo not assume a ranking gain after publication; use the next measurement to evaluate the effect.`;

  return {
    title,
    excerpt,
    bodyMarkdown,
    generationPrompt: buildPrompt(input),
    model: "deterministic-evidence-template-v1",
    usedFallback: true,
  };
};

export async function generateContentDraft(
  input: ContentDraftInput
): Promise<GeneratedContentDraft> {
  const generationPrompt = buildPrompt(input);
  try {
    const { object } = await generateObject({
      model: models.chat,
      schema: draftSchema,
      prompt: generationPrompt,
    });
    return {
      ...object,
      generationPrompt,
      model: "gpt-4o-mini",
      usedFallback: false,
    };
  } catch {
    // API 키·공급자 장애가 콘텐츠 워크플로 전체를 막지 않도록 근거 기반 초안을 남긴다.
    return fallbackDraft(input);
  }
}
