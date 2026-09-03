// 신뢰 배지 — 경쟁사 로고 벽 자리에 들어가는 우리 버전
//
// 🔴 2026-08-16 신설. 경쟁사 4곳은 이 자리에 **고객 로고**를 둔다(실측):
//    Profound 18개(Calendly·WHOOP·Figma·Comcast·Ashby…) · Scrunch "500개사"+Akamai/Lenovo
//    → 우리는 고객 0명이라 **흉내내면 그 순간 날조**가 된다.
//
// ⭐ 대신 **거짓 없이 쓸 수 있는 것**만 쓴다. 두 줄로 성격을 완전히 분리한다:
//    ①선정·수상 = Findable 자체가 받은 것
//    ②수행 실적 = **인디고차일드(만든 팀)가 마케팅을 해온 곳** — Findable 고객이 아니다
//
// 🔴🔴 문구 규율 (어기면 IBK 「없는 운영매니저」 사고와 같은 유형이 된다)
//    ⛔ "이런 곳들이 씁니다" / "고객사" / "도입" — **전부 거짓**이다
//    ⛔ "KAIST 인증 기술" — 액셀러레이팅 **선정**이지 기술 인증이 아니다
//    ⛔ 메타·구글 공식 파트너 배지 — **그 인증이 없다.** 넣지 말 것
//    ✅ "만든 팀이 마케팅을 맡아온 곳" = 사실 그대로
//
// 기관 공식 로고를 그대로 복제하지 않고, 선정·수상 사실을 읽기 쉬운 텍스트 락업으로
// 표현한다. 이는 공식 인증·후원·제휴처럼 보일 수 있는 오인을 피하기 위한 선택이다.

interface CredibilityProps {
  locale?: string;
}

/** ①Findable 이 받은 것 — 전부 확인된 사실 */
const CREDENTIALS = [
  {
    ko: "KAIST OverEdge 2026 선정",
    en: "Selected · KAIST OverEdge 2026",
    // 최종 합격 2026-06-29 · 발대식 2026-07-02
  },
  {
    ko: "생성형 AI 활용 경진대회 최우수상",
    en: "Grand Prize · Generative AI Competition",
    // 2024-11-18 고용노동부 서울동부고용노동지청 주관
  },
  {
    ko: "K-GEO-Bench 공개 데이터셋 발행",
    en: "Published K-GEO-Bench open dataset",
    // CC BY 4.0 · 경쟁사 4곳 중 공개 데이터셋 보유 0곳(2026-08-16 라이브 확인)
  },
];

/** ②만든 팀(인디고차일드)이 마케팅을 수행한 곳 — ⛔Findable 고객이 아니다 */
const TEAM_WORK = [
  "서울특별시 서울윈터페스타",
  "남양주시 광복 80주년 기념행사",
  "구미시 산단페스티벌",
  "워터밤 페스티벌",
  "전지적 독자 시점 IP 팝업",
  "코빗",
];

export const Credibility = ({ locale = "ko" }: CredibilityProps) => {
  const isKo = locale.startsWith("ko");

  return (
    <section className="w-full bg-[var(--findable-canvas)] pb-16 md:pb-20">
      <div className="mx-auto max-w-5xl px-6">
        {/* ① 선정·수상 */}
        <div className="flex flex-wrap items-stretch justify-center gap-3">
          {CREDENTIALS.map((c) => (
            <div
              className="flex min-h-16 items-center gap-3 rounded-sm border border-[var(--findable-hairline-strong)] bg-[var(--findable-surface-1)] px-4 py-3 text-[12px] text-[var(--findable-ink-muted)]"
              key={c.en}
              style={{ fontFamily: "var(--findable-font-sans)" }}
            >
              {c.ko.startsWith("KAIST") ? (
                <span
                  aria-hidden
                  className="border-[var(--findable-primary)] border-r pr-3 text-[16px] text-[var(--findable-ink)] tracking-[-0.08em]"
                  style={{ fontFamily: "Georgia, serif", fontWeight: 700 }}
                >
                  KAIST
                </span>
              ) : c.ko.startsWith("생성형") ? (
                <span
                  aria-hidden
                  className="border-[var(--findable-primary)] border-r pr-3 text-[10px] text-[var(--findable-ink)] leading-tight"
                  style={{ fontWeight: 700 }}
                >
                  고용노동부<br />서울동부고용노동지청
                </span>
              ) : (
                <span aria-hidden className="text-[18px] text-[var(--findable-primary)]">↗</span>
              )}
              <span>{isKo ? c.ko : c.en}</span>
            </div>
          ))}
        </div>
        <p className="mt-3 text-center text-[11px] text-[var(--findable-ink-tertiary)]">
          {isKo
            ? "선정·수상 사실을 표기한 것이며, 각 기관의 공식 인증·후원 또는 제휴를 뜻하지 않습니다."
            : "These are factual selection and award references, not endorsements, sponsorships, or partnerships."}
        </p>

        {/* ② 팀 수행 실적 — 🔴 라벨이 이 블록의 전부다.
            "고객사"라고 쓰는 순간 거짓이 된다. */}
        <div className="mt-10 border-[var(--findable-hairline)] border-t pt-8">
          <p
            className="text-center text-[11px] text-[var(--findable-ink-tertiary)] uppercase tracking-[0.16em]"
            style={{ fontFamily: "var(--findable-font-sans)" }}
          >
            {isKo
              ? "Findable을 만든 팀이 마케팅을 맡아온 곳"
              : "Where the team behind Findable has run marketing"}
          </p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-x-7 gap-y-3">
            {TEAM_WORK.map((name) => (
              <span
                className="text-[13px] text-[var(--findable-ink-muted)] md:text-[14px]"
                key={name}
                style={{
                  fontFamily: "var(--findable-font-sans)",
                  fontWeight: 500,
                  wordBreak: "keep-all",
                }}
              >
                {name}
              </span>
            ))}
          </div>
          {/* 🔴 이 한 줄이 법적 안전장치다. 빼지 말 것. */}
          <p
            className="mt-5 text-center text-[11px] text-[var(--findable-ink-subtle)]"
            style={{
              fontFamily: "var(--findable-font-sans)",
              wordBreak: "keep-all",
            }}
          >
            {isKo
              ? "인디고차일드(Findable 운영사)의 마케팅 대행 수행 실적입니다. Findable 서비스 도입사가 아닙니다."
              : "Marketing work delivered by Indigo Child, the company behind Findable. These are not Findable customers."}
          </p>
        </div>
      </div>
    </section>
  );
};
