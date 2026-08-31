import Link from "next/link";

interface FaqProps {
  locale?: string;
}

const FAQ_KO = [
  {
    question: "Findable은 어떤 도구인가요?",
    answer:
      "Findable은 한국어와 영어 AI 답변에서 브랜드가 얼마나, 어떤 문장으로, 어떤 출처와 함께 등장하는지 측정하는 GEO(생성형 엔진 최적화) 플랫폼입니다. 결과를 대시보드와 기술 리포트로 보여주고, 먼저 고칠 콘텐츠와 출처를 제안합니다.",
  },
  {
    question: "SEO와 GEO는 어떻게 다른가요?",
    answer:
      "SEO는 검색엔진 결과 페이지에서의 노출과 순위를 개선하는 일입니다. GEO는 ChatGPT·Claude·Perplexity·네이버 같은 생성형 AI가 답변을 만들 때 브랜드를 정확하게 인지하고, 언급하고, 인용하도록 만드는 일입니다. 두 채널은 겹치지만 같은 점수가 아닙니다.",
  },
  {
    question: "어떤 AI 엔진을 측정하나요?",
    answer:
      "지원 범위는 ChatGPT·Claude·Perplexity·Gemini와 HyperCLOVA X·네이버·다음입니다. 실제 결과에서는 연결된 엔진의 성공 응답만 점수에 사용하고, 미연결·오류 응답은 별도로 표시해 분모에 섞지 않습니다.",
  },
  {
    question: "측정 결과는 무엇을 의미하나요?",
    answer:
      "GEO 종합 점수는 인지·감성·인용 품질·경쟁 위치·답변 등장률을 합친 진단값입니다. AI 답변 등장률은 성공한 답변 중 브랜드가 실제로 한 번 이상 등장한 비율입니다. 서로 다른 지표이므로 같은 대표 점수처럼 비교하지 않습니다.",
  },
  {
    question: "측정 후 무엇을 할 수 있나요?",
    answer:
      "대시보드에서 AI 원문과 출처를 확인하고, 측정 이력에서 이전 결과와 비교하며, ‘지금 할 일’에서 우선순위 액션을 확인할 수 있습니다. 추적 질문은 저장한 뒤 다음 측정에서 결과가 쌓이는 구조입니다.",
  },
];

const FAQ_EN = [
  {
    question: "What is Findable?",
    answer:
      "Findable is a generative engine optimization platform that measures how often AI answers mention your brand, what they say, and which sources they cite. It turns the result into a dashboard, a technical report, and prioritized content actions.",
  },
  {
    question: "How is GEO different from SEO?",
    answer:
      "SEO improves visibility and ranking on search result pages. GEO improves whether generative AI systems recognize, mention, and cite your brand when composing an answer. The channels overlap, but their scores are not interchangeable.",
  },
  {
    question: "Which AI engines do you measure?",
    answer:
      "The supported scope is ChatGPT, Claude, Perplexity, Gemini, HyperCLOVA X, Naver, and Daum. Only successful connected responses contribute to a score; disconnected and failed attempts remain visible but are excluded from the denominator.",
  },
  {
    question: "What do the scores mean?",
    answer:
      "The GEO composite combines recognition, sentiment, citation quality, competitive position, and answer appearance. Answer appearance is the percentage of successful answers that mention the brand at least once. They are separate metrics, not duplicate headline scores.",
  },
  {
    question: "What can I do after a measurement?",
    answer:
      "Review the AI excerpts and sources in the dashboard, compare runs in measurement history, and use the action queue to prioritize fixes. Saved tracking questions accumulate results on the next measurement.",
  },
];

export const Faq = ({ locale = "ko" }: FaqProps) => {
  const isKo = locale.startsWith("ko");
  const items = isKo ? FAQ_KO : FAQ_EN;
  const lp = isKo ? "/ko" : "";

  return (
    <section
      aria-labelledby="faq-heading"
      className="bg-[var(--findable-canvas)] px-8 py-20 md:py-28"
      id="faq"
    >
      <div className="mx-auto grid max-w-[1200px] gap-10 md:grid-cols-[0.8fr_1.2fr] md:gap-20">
        <div>
          <p className="text-[12px] text-[var(--findable-primary)] uppercase tracking-[0.18em]">
            {isKo ? "GEO 안내" : "GEO guide"}
          </p>
          <h2
            className="mt-4 text-[var(--findable-ink)]"
            id="faq-heading"
            style={{
              fontFamily: isKo
                ? "var(--findable-font-display-kr)"
                : "var(--findable-font-display)",
              fontSize: "clamp(32px, 4vw, 48px)",
              lineHeight: 1.15,
              letterSpacing: isKo ? "0" : "-0.025em",
              fontWeight: 500,
            }}
          >
            {isKo ? "SEO·GEO, 자주 묻는 질문" : "SEO and GEO, answered"}
          </h2>
          <p className="mt-5 max-w-[420px] text-[15px] text-[var(--findable-ink-muted)] leading-[1.7]">
            {isKo
              ? "측정 범위와 점수 정의를 먼저 확인하세요. 연결되지 않은 AI를 성공한 것처럼 계산하지 않습니다."
              : "Start with the measurement scope and score definitions. Disconnected engines are never counted as successful answers."}
          </p>
          <Link
            className="mt-6 inline-flex text-[14px] text-[var(--findable-primary)] underline-offset-4 hover:underline"
            href={`${lp}/research/k-geo-bench-v0_1`}
          >
            {isKo
              ? "K-GEO Bench 연구 보기 →"
              : "Read the K-GEO Bench research →"}
          </Link>
        </div>

        <div className="divide-y divide-[var(--findable-hairline)] border-[var(--findable-hairline)] border-y">
          {items.map((item) => (
            <details className="group py-5" key={item.question}>
              <summary className="flex cursor-pointer list-none items-start justify-between gap-6 font-medium text-[16px] text-[var(--findable-ink)] [&::-webkit-details-marker]:hidden">
                <span>{item.question}</span>
                <span
                  aria-hidden
                  className="text-[var(--findable-primary)] transition group-open:rotate-45"
                >
                  +
                </span>
              </summary>
              <p className="mt-4 max-w-[680px] text-[14px] text-[var(--findable-ink-muted)] leading-[1.75]">
                {item.answer}
              </p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
};

export { FAQ_EN, FAQ_KO };
