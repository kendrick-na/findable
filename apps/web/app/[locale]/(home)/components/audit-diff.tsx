// Findable Audit Diff — Linear "Review PRs" 코드 diff 패턴 (자체 구현)
// 좌:Before / 우:After, red-green 하이라이트

const BEFORE = [
  { n: 1, code: "<title>메디큐브 - 공식 홈페이지</title>", type: "ctx" },
  { n: 2, code: "<meta name='description' content='K-뷰티 브랜드'/>", type: "ctx" },
  { n: 3, code: "", type: "ctx" },
  { n: 4, code: "<article>", type: "ctx" },
  { n: 5, code: "  <h1>메디큐브 부스터</h1>", type: "del" },
  { n: 6, code: "  <p>혁신적인 K-뷰티 제품입니다.</p>", type: "del" },
  { n: 7, code: "", type: "ctx" },
  { n: 8, code: "  <section>", type: "ctx" },
  { n: 9, code: "    <p>제품 소개 텍스트...</p>", type: "del" },
  { n: 10, code: "  </section>", type: "ctx" },
  { n: 11, code: "</article>", type: "ctx" },
];

const AFTER = [
  { n: 1, code: "<title>메디큐브 부스터 — 한국 No.1 콜라겐 부스터 (2026)</title>", type: "add" },
  { n: 2, code: "<meta name='description' content='Princeton GEO 알고리즘 적용 K-뷰티 부스터. ...'/>", type: "add" },
  { n: 3, code: "", type: "ctx" },
  { n: 4, code: "<article>", type: "ctx" },
  { n: 5, code: "  <h1>메디큐브 부스터 — Q1 2026 베스트셀러</h1>", type: "add" },
  { n: 6, code: "  <p>아모레퍼시픽·조선미녀와 함께 K-뷰티 ...</p>", type: "add" },
  { n: 7, code: "", type: "ctx" },
  { n: 8, code: "  <section>", type: "ctx" },
  { n: 9, code: "    <blockquote cite='gartner.com'>", type: "add" },
  { n: 10, code: "      \"한국 콜라겐 시장 1위\" — Gartner 2026", type: "add" },
  { n: 11, code: "    </blockquote>", type: "add" },
  { n: 12, code: "  </section>", type: "ctx" },
  { n: 13, code: "</article>", type: "ctx" },
];

const COLORS = {
  ctx: { bg: "transparent", text: "var(--findable-ink-muted)" },
  del: { bg: "rgba(239, 68, 68, 0.08)", text: "#fca5a5" },
  add: { bg: "rgba(34, 197, 94, 0.08)", text: "#86efac" },
};

export const AuditDiff = () => {
  return (
    <div
      className="overflow-hidden rounded-xl border border-[var(--findable-hairline-strong)] bg-[var(--findable-surface-1)]"
      style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)" }}
    >
      {/* header */}
      <div className="flex items-center justify-between border-[var(--findable-hairline)] border-b bg-[var(--findable-canvas)] px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-[#ff5f57]" />
            <span className="h-2 w-2 rounded-full bg-[#ffbd2e]" />
            <span className="h-2 w-2 rounded-full bg-[#28c940]" />
          </span>
          <span
            className="text-[12px] text-[var(--findable-ink-subtle)]"
            style={{ fontFamily: "var(--findable-font-mono)" }}
          >
            medicube.co.kr / pages / booster.html
          </span>
        </div>
        <div className="flex items-center gap-3 text-[11px]">
          <span
            className="text-[var(--findable-ink-tertiary)]"
            style={{ fontFamily: "var(--findable-font-mono)" }}
          >
            <span className="text-[#fca5a5]">−3</span>{" "}
            <span className="text-[#86efac]">+8</span>
          </span>
          <span
            className="rounded bg-[var(--findable-surface-2)] px-2 py-0.5 text-[var(--findable-ink-muted)]"
            style={{ fontFamily: "var(--findable-font-sans)" }}
          >
            Findable suggestion
          </span>
        </div>
      </div>

      {/* diff body */}
      <div
        className="grid grid-cols-2 text-[12px]"
        style={{ fontFamily: "var(--findable-font-mono)" }}
      >
        {/* Before */}
        <div className="border-[var(--findable-hairline)] border-r">
          <div className="border-[var(--findable-hairline)] border-b bg-[var(--findable-canvas)] px-3 py-1.5 text-[10px] uppercase tracking-[0.14em] text-[var(--findable-ink-tertiary)]">
            Before · current
          </div>
          {BEFORE.map((line) => (
            <div
              key={`b-${line.n}`}
              className="grid grid-cols-[36px_1fr]"
              style={{ backgroundColor: COLORS[line.type as keyof typeof COLORS].bg }}
            >
              <span className="select-none border-[var(--findable-hairline)] border-r py-0.5 text-right pr-2 text-[10px] text-[var(--findable-ink-tertiary)]">
                {line.n}
              </span>
              <code
                className="overflow-hidden py-0.5 pl-3 text-[10.5px] leading-[1.65]"
                style={{
                  color: COLORS[line.type as keyof typeof COLORS].text,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-all",
                }}
              >
                {line.type === "del" ? "− " : line.type === "add" ? "+ " : "  "}
                {line.code || " "}
              </code>
            </div>
          ))}
        </div>

        {/* After */}
        <div>
          <div className="border-[var(--findable-hairline)] border-b bg-[var(--findable-canvas)] px-3 py-1.5 text-[10px] uppercase tracking-[0.14em] text-[var(--findable-primary)]">
            After · Findable optimized
          </div>
          {AFTER.map((line) => (
            <div
              key={`a-${line.n}`}
              className="grid grid-cols-[36px_1fr]"
              style={{ backgroundColor: COLORS[line.type as keyof typeof COLORS].bg }}
            >
              <span className="select-none border-[var(--findable-hairline)] border-r py-0.5 text-right pr-2 text-[10px] text-[var(--findable-ink-tertiary)]">
                {line.n}
              </span>
              <code
                className="overflow-hidden py-0.5 pl-3 text-[10.5px] leading-[1.65]"
                style={{
                  color: COLORS[line.type as keyof typeof COLORS].text,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-all",
                }}
              >
                {line.type === "del" ? "− " : line.type === "add" ? "+ " : "  "}
                {line.code || " "}
              </code>
            </div>
          ))}
        </div>
      </div>

      {/* footer 메트릭 */}
      <div className="border-[var(--findable-hairline)] border-t bg-[var(--findable-canvas)] px-4 py-3">
        <div className="grid grid-cols-3 gap-4 text-[11px]">
          <Metric label="Citation Score" before="42" after="78" />
          <Metric label="Korean Entity Match" before="63%" after="91%" />
          <Metric label="Predicted SoV (30d)" before="11.2%" after="18.4%" />
        </div>
      </div>
    </div>
  );
};

const Metric = ({
  label,
  before,
  after,
}: {
  label: string;
  before: string;
  after: string;
}) => (
  <div>
    <p
      className="text-[10px] uppercase tracking-[0.14em] text-[var(--findable-ink-tertiary)]"
      style={{ fontFamily: "var(--findable-font-sans)" }}
    >
      {label}
    </p>
    <div
      className="mt-1.5 flex items-baseline gap-2"
      style={{ fontFamily: "var(--findable-font-mono)" }}
    >
      <span className="text-[var(--findable-ink-tertiary)] line-through">
        {before}
      </span>
      <span className="text-[var(--findable-ink-muted)]">→</span>
      <span className="text-[14px] text-[#86efac]">{after}</span>
    </div>
  </div>
);
