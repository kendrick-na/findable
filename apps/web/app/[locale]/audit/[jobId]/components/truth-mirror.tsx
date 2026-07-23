// 진실거울 (Truth Mirror) — 7 AI가 브랜드를 어떻게 알고 있는지 원문 나란히 (D-2026-07-23)
//
// 목적:
//   진단의 첫 충격 지점. "7개 AI가 당신 브랜드를 이렇게 (제각각·틀리게) 알고 있다"를
//   한 화면에서 눈으로 보게 한다. 측정 숫자(SoV)보다 AI 답변 원문 병치가
//   painkiller 서사를 만든다 (2.0 전략: "결과 팔면 painkiller").
//
// 설계 결정 (전략적 판정, 2026-07-23):
//   - "빨간 밑줄 사실오류 판정"은 넣지 않음. 별도 LLM 팩트체크는 오판 리스크 +
//     신규 크루 로직 + 비용이라 데모데이 자리에서 잘못 밑줄 그으면 신뢰 붕괴.
//     "진단까지가 안전선"(엔티티 직접배포 금지와 동일 논리).
//   - 팩트정합률 = 자기채점(언급 엔진 / 측정 엔진). 정직한 프레이밍 유지.
//   - 사용자 정답 입력형 대조는 데모데이 이후(F단계) 백로그로.
//
// 데이터 소스:
//   audit-result의 engineResponses (excerpt·brandMentioned·sentiment·isStub 그대로 사용).
//   신규 API·크루·패키지 0개. UI 재조합.

"use client";

import { Quote } from "lucide-react";

interface EngineResponse {
  brandMentioned: boolean;
  engineId: string;
  errorMessage: string | null;
  excerpt: string;
  isStub: boolean;
  mentionPosition: number | null;
  sentiment: "positive" | "neutral" | "negative" | null;
}

interface Props {
  brandName: string;
  engineResponses: EngineResponse[];
  isKo: boolean;
}

// audit-result의 ENGINE_LABELS와 동일 (진실거울은 자체 소유해 결합도 낮춤)
const ENGINE_LABELS: Record<string, string> = {
  chatgpt: "ChatGPT",
  "chatgpt-web": "ChatGPT (Web)",
  claude: "Claude",
  perplexity: "Perplexity",
  gemini: "Gemini",
  hyperclova: "HyperCLOVA X",
  naver: "Naver",
  "naver-briefing": "Naver AI 브리핑",
  daum: "Daum",
};

function dedupeByEngine<T extends { engineId: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const r of rows) {
    if (seen.has(r.engineId)) {
      continue;
    }
    seen.add(r.engineId);
    out.push(r);
  }
  return out;
}

export function TruthMirror({ brandName, engineResponses, isKo }: Props) {
  const engines = dedupeByEngine(engineResponses);
  // stub(미연결)은 진실거울에서 제외 — "AI가 모른다"와 "아직 측정 안 함"은 다른 서사.
  const live = engines.filter((r) => !r.isStub);
  if (live.length === 0) {
    return null;
  }

  const known = live.filter((r) => r.brandMentioned && !r.errorMessage);
  // 자기채점 팩트정합률 = 브랜드를 아는(인용한) 엔진 비율. 자기채점임을 카피로 명시.
  const accuracy = Math.round((known.length / live.length) * 100);
  const brand = brandName || (isKo ? "당신의 브랜드" : "your brand");

  const headline = isKo
    ? `${live.length}개 AI 중 ${known.length}개가 ${brand}를 알고 있습니다`
    : `${known.length} of ${live.length} AIs know ${brand}`;

  let accuracyTone: Tone = "bad";
  if (accuracy >= 70) {
    accuracyTone = "good";
  } else if (accuracy >= 40) {
    accuracyTone = "warn";
  }

  return (
    <section className="rounded-2xl border border-white/10 bg-zinc-900/60 p-6 backdrop-blur-sm md:p-8">
      {/* 라벨 */}
      <div className="flex items-center gap-2 font-mono text-[10px] text-[var(--brand-2)] uppercase tracking-[0.18em]">
        <Quote className="h-3.5 w-3.5" />
        {isKo
          ? "진실의 거울 · AI가 아는 당신"
          : "Truth Mirror · How AI knows you"}
      </div>

      {/* 헤드라인 + 자기채점 정합률 */}
      <div className="mt-3 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h3 className="max-w-2xl font-bold text-2xl text-zinc-50 leading-tight tracking-tight md:text-3xl">
            {headline}
          </h3>
          <p className="mt-2 max-w-2xl text-sm text-zinc-400 leading-relaxed">
            {isKo
              ? "같은 브랜드를 각 AI가 어떻게 서술하는지 원문 그대로 나란히 놓았습니다. AI가 모르거나 다르게 아는 곳이 바로 GEO로 메울 자리입니다."
              : "Here's how each AI describes the same brand, verbatim, side by side. Where AI doesn't know you — or knows you differently — is exactly where GEO fills the gap."}
          </p>
        </div>
        <FactAccuracyBadge
          accuracy={accuracy}
          isKo={isKo}
          tone={accuracyTone}
        />
      </div>

      {/* 7 AI 원문 그리드 */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {live.map((r) => (
          <MirrorCard engine={r} isKo={isKo} key={r.engineId} />
        ))}
      </div>

      {/* 자기채점 정직성 각주 */}
      <p className="mt-5 text-[11px] text-zinc-600 leading-relaxed">
        {isKo
          ? "* 팩트정합률은 브랜드를 인용한 AI 엔진 비율(자기채점)입니다. 문장 단위 사실 검증은 포함하지 않습니다."
          : "* Fact-match rate reflects the share of AI engines that cite your brand (self-scored). It does not verify claims at the sentence level."}
      </p>
    </section>
  );
}

type Tone = "good" | "warn" | "bad";

const ACCURACY_COLOR: Record<Tone, string> = {
  good: "text-[var(--signal-good)]",
  warn: "text-[var(--signal-warn)]",
  bad: "text-[var(--signal-bad)]",
};
const ACCURACY_RING: Record<Tone, string> = {
  good: "border-[var(--signal-good)]/30 bg-[var(--signal-good)]/5",
  warn: "border-[var(--signal-warn)]/30 bg-[var(--signal-warn)]/5",
  bad: "border-[var(--signal-bad)]/30 bg-[var(--signal-bad)]/5",
};
const SENTIMENT_DOT: Record<string, string> = {
  positive: "bg-[var(--signal-good)]",
  negative: "bg-[var(--signal-bad)]",
  neutral: "bg-[var(--signal-warn)]",
};

function FactAccuracyBadge({
  accuracy,
  tone,
  isKo,
}: {
  accuracy: number;
  tone: Tone;
  isKo: boolean;
}) {
  const color = ACCURACY_COLOR[tone];
  const ring = ACCURACY_RING[tone];
  return (
    <div
      className={`inline-flex shrink-0 flex-col items-center rounded-xl border px-5 py-3 ${ring}`}
    >
      <span
        className={`font-bold text-3xl tabular-nums tracking-tight ${color}`}
      >
        {accuracy}
        <span className="text-lg">%</span>
      </span>
      <span className="mt-0.5 font-mono text-[9px] text-zinc-500 uppercase tracking-[0.16em]">
        {isKo ? "팩트정합률" : "Fact-match"}
      </span>
    </div>
  );
}

function MirrorCard({
  engine,
  isKo,
}: {
  engine: EngineResponse;
  isKo: boolean;
}) {
  const label = ENGINE_LABELS[engine.engineId] ?? engine.engineId;
  const errored = Boolean(engine.errorMessage);
  const unknown = !(engine.brandMentioned || errored);

  // 3상태: 안다(인용) / 모른다(미언급 = GEO 기회) / 오류
  let cardTone = "border-white/10 bg-white/[0.03]";
  if (errored) {
    cardTone = "border-white/10 bg-white/[0.02]";
  } else if (unknown) {
    cardTone = "border-[var(--brand-2)]/25 bg-[var(--brand-2)]/[0.04]";
  }

  const cited = !(errored || unknown);

  return (
    <div className={`flex flex-col rounded-xl border p-4 ${cardTone}`}>
      {/* 엔진 헤더 */}
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold text-sm text-zinc-100">{label}</span>
        <StatusPill engine={engine} isKo={isKo} />
      </div>

      {/* 원문 or 미언급 프레이밍 */}
      <div className="mt-3 flex-1">
        <MirrorBody
          engine={engine}
          errored={errored}
          isKo={isKo}
          unknown={unknown}
        />
      </div>

      {/* 감정 (인용된 경우만) */}
      {cited && engine.sentiment && (
        <div className="mt-3 flex items-center gap-1.5 font-mono text-[10px] text-zinc-500 uppercase tracking-[0.14em]">
          <span
            className={`h-1.5 w-1.5 rounded-full ${SENTIMENT_DOT[engine.sentiment] ?? SENTIMENT_DOT.neutral}`}
          />
          {sentimentLabel(engine.sentiment, isKo)}
        </div>
      )}
    </div>
  );
}

function MirrorBody({
  engine,
  errored,
  unknown,
  isKo,
}: {
  engine: EngineResponse;
  errored: boolean;
  unknown: boolean;
  isKo: boolean;
}) {
  if (errored) {
    return (
      <p className="text-xs text-zinc-500 leading-relaxed">
        {isKo
          ? "이 AI 응답을 불러오지 못했습니다."
          : "Couldn't load this AI's response."}
      </p>
    );
  }
  if (unknown) {
    return (
      <p className="text-sm text-zinc-400 leading-relaxed">
        {isKo
          ? "이 AI는 아직 당신 브랜드를 답변에 인용하지 않습니다. 경쟁사가 자리를 잡기 전, 지금이 이 AI에 노출을 확보할 기회입니다."
          : "This AI doesn't cite your brand yet — the opening to claim visibility here before competitors do."}
      </p>
    );
  }
  return (
    <blockquote className="border-[var(--brand-2)]/30 border-l-2 pl-3 text-sm text-zinc-300 leading-relaxed">
      {engine.excerpt || (isKo ? "(응답 없음)" : "(no response)")}
    </blockquote>
  );
}

function StatusPill({
  engine,
  isKo,
}: {
  engine: EngineResponse;
  isKo: boolean;
}) {
  if (engine.errorMessage) {
    return (
      <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-zinc-500">
        {isKo ? "오류" : "Error"}
      </span>
    );
  }
  if (!engine.brandMentioned) {
    return (
      <span className="rounded-full border border-[var(--brand-2)]/30 bg-[var(--brand-2)]/10 px-2 py-0.5 font-medium text-[10px] text-[var(--brand-2)]">
        {isKo ? "당신을 모름" : "Doesn't know you"}
      </span>
    );
  }
  let citedLabel = isKo ? "인용됨" : "Cited";
  if (engine.mentionPosition) {
    citedLabel = isKo
      ? `${engine.mentionPosition}위 인용`
      : `Cited #${engine.mentionPosition}`;
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-[var(--signal-good)]/30 bg-[var(--signal-good)]/10 px-2 py-0.5 font-medium text-[10px] text-[var(--signal-good)]">
      {citedLabel}
    </span>
  );
}

function sentimentLabel(sentiment: string, isKo: boolean): string {
  if (sentiment === "positive") {
    return isKo ? "긍정적으로 서술" : "Positive";
  }
  if (sentiment === "negative") {
    return isKo ? "부정적으로 서술" : "Negative";
  }
  return isKo ? "중립적으로 서술" : "Neutral";
}
