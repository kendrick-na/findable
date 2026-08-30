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
//   - 브랜드 인지율 = 언급 엔진 / 측정 엔진. ⚠️2026-07-31 세션K에 "팩트정합률"에서 개명:
//     사실 검증을 하지 않는데 이름이 사실 검증으로 읽혔다(기아 측정에서 향수·야구단이
//     언급으로 잡혀도 "팩트정합률 100%"로 표시됨). 분자는 이제 언급 품질 검증
//     (mention-verdict.ts)을 통과한 것만 센다.
//   - 사용자 정답 입력형 대조는 데모데이 이후(F단계) 백로그로.
//
// 데이터 소스:
//   audit-result의 engineResponses (excerpt·brandMentioned·sentiment·isStub 그대로 사용).
//   신규 API·크루·패키지 0개. UI 재조합.

"use client";

import { objectParticle } from "@repo/audit/actions";
import { stripMarkdown } from "@repo/audit/strip-markdown";
import { ChevronDown, Quote } from "lucide-react";
import { type ReactNode, useState } from "react";

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

/**
 * 🔴 브리핑만 **질의 축이 다르다**(N-45 · #4-b B-5).
 * 📕 `docs/_적용/브리핑_본류편입_기획_2026-08-17.md` §2 — 7엔진은 추천형을 묻고
 *   브리핑은 정보형(효과·후기·장단점)을 묻는다. **질문이 다르므로 분모도 다르다.**
 */
const BRIEFING_ENGINE_ID = "naver-briefing";

// 엔진당 1장으로 접는다. **언급한 응답을 우선 채택**한다.
//
// 🔴 2026-08-06 세션N-7 수정: 기존엔 엔진별 **첫 응답만** 남겼다. 프롬프트가 여러 개라
//   같은 엔진이 질문1에선 언급 안 하고 질문2에서 언급하는 경우, 첫 응답이 미언급이면
//   그 엔진 전체가 "우리를 모른다"로 집계됐다.
//   실측(job 3273a572, 클로드): 엔진 단위 진실은 **7곳 중 6곳 인용**인데
//   이 화면만 **5곳**으로 표시 → 같은 페이지의 제목("7곳 중 1곳 미인용")과 어긋났다.
//   `metrics.enginesWithMention`(고유 6개)이 정답이고 이 함수가 틀렸다.
//
// 정책: 한 엔진이 **어느 질문에서든** 우리를 말했다면 그 엔진은 "우리를 안다".
//   (미언급 응답만 있는 엔진은 그대로 미언급 카드가 남는다)
function dedupeByEngine<
  T extends { engineId: string; brandMentioned?: boolean },
>(rows: T[]): T[] {
  const picked = new Map<string, T>();
  for (const r of rows) {
    const prev = picked.get(r.engineId);
    if (!prev) {
      picked.set(r.engineId, r);
      continue;
    }
    // 이미 담긴 게 미언급이고 지금 것이 언급이면 교체 — 언급 증거가 이긴다.
    if (!prev.brandMentioned && r.brandMentioned) {
      picked.set(r.engineId, r);
    }
  }
  return Array.from(picked.values());
}

export function TruthMirror({ brandName, engineResponses, isKo }: Props) {
  // ⚠️ 훅은 조기 return(아래 live.length===0) 앞에 둔다 — 순서가 흔들리면 React 가 깨진다.
  const [expanded, setExpanded] = useState(false);
  const engines = dedupeByEngine(engineResponses);
  // stub(미연결)은 진실거울에서 제외 — "AI가 모른다"와 "아직 측정 안 함"은 다른 서사.
  const live = engines.filter((r) => !r.isStub);
  if (live.length === 0) {
    return null;
  }

  // 결함감사(2026-07-30) §13: 측정 실패(오류)는 "브랜드를 모른다"가 아니다.
  // 분모는 측정 성공 엔진으로 좁히고, 오류는 개수로 따로 고지 + 카드 맨 뒤 배치.
  const measured = live.filter((r) => !r.errorMessage);
  const errored = live.length - measured.length;
  const known = measured.filter((r) => r.brandMentioned);
  const accuracy =
    measured.length === 0
      ? 0
      : Math.round((known.length / measured.length) * 100);
  const brand = brandName || (isKo ? "당신의 브랜드" : "your brand");

  // 읽는 순서: 인용됨 → 모름(GEO 기회) → 오류. 오류가 첫 줄에 끼어 흐름을 깨지 않게.
  const ordered = [...live].sort((a, b) => cardOrder(a) - cardOrder(b));

  // 밀도 축소(세션N-16): 기본 3장만 펼치고 나머지는 접는다. 원문은 지우지 않는다.
  const initial = pickInitialCards(ordered, DEFAULT_VISIBLE_CARDS);
  const visible = expanded ? ordered : initial;
  const hiddenCount = ordered.length - initial.length;

  const headline = isKo
    ? `측정한 AI ${measured.length}개 중 ${known.length}개가 ${brand}${objectParticle(brand)} 알고 있습니다`
    : `${known.length} of ${measured.length} measured AIs know ${brand}`;

  let accuracyTone: Tone = "bad";
  if (accuracy >= 70) {
    accuracyTone = "good";
  } else if (accuracy >= 40) {
    accuracyTone = "warn";
  }

  return (
    <section className="rounded-2xl border border-white/10 bg-zinc-900/60 p-6 backdrop-blur-sm md:p-8">
      {/* 라벨 */}
      <div className="flex items-center gap-2 font-medium text-[var(--brand-2)] text-xs">
        <Quote className="h-3.5 w-3.5" />
        {isKo
          ? "진실의 거울 · 엔진별 인지 요약"
          : "Truth Mirror · Engine recognition summary"}
      </div>

      {/* 헤드라인 + 자기채점 정합률 */}
      <div className="mt-3 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          {/* 한글은 정사각 격자라 음수 자간이 가독성을 깎는다 → 한글일 때만 tracking 제거 */}
          <h3
            className={`max-w-2xl font-bold text-2xl text-zinc-50 leading-tight md:text-3xl ${
              isKo ? "" : "tracking-tight"
            }`}
          >
            {headline}
          </h3>
          <p className="mt-2 max-w-2xl text-sm text-zinc-400 leading-relaxed">
            {isKo
              ? // 🔴 N-45: 브리핑이 본류에 들어오면서 *"같은 질문에"* 가 **사실이 아니게 됐다** —
                //   브리핑만 정보형(효과·후기·장단점)으로 묻는다. 카드마다 그 사실을 밝히지만,
                //   섹션 설명이 「같은 질문」이라고 단정하면 그게 먼저 읽힌다.
                "각 AI가 브랜드를 알고 있는지와 대표 표현을 한눈에 비교합니다. ‘당신을 모름’ 또는 잘못된 설명이 뜬 엔진이 GEO 개선 1순위예요. 전문은 아래 ‘측정 원문’에서 확인하세요."
              : "Compare whether each AI recognizes the brand and how it describes it. Engines that do not know you or describe you incorrectly are the first GEO priorities. Full responses appear in Measurement evidence below."}
          </p>
          {errored > 0 && (
            <p className="mt-1.5 text-xs text-zinc-400">
              {isKo
                ? `* ${errored}개 AI는 일시 오류로 이번 측정에서 제외했습니다.`
                : `* ${errored} engines failed temporarily and are excluded from this measurement.`}
            </p>
          )}
        </div>
        {/* 🔴 분모를 라벨에 박는다(세션N-28 ⑥) — 같은 화면 상단 KPI 는 **응답 27건** 기준
            96%, 이 배지는 **엔진 7곳** 기준 100% 다. 둘 다 산술이 맞는데 분모가 달라
            나란히 놓이면 모순처럼 읽혔다(👤 지목). 어느 쪽 숫자도 지우지 않고
            **분모를 이름에 넣어** 구분한다. */}
        <FactAccuracyBadge
          accuracy={accuracy}
          isKo={isKo}
          measured={measured.length}
          tone={accuracyTone}
        />
      </div>

      {/* 7 AI 원문 그리드 — 기본 3장, 나머지는 접기(밀도 축소) */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {visible.map((r) => (
          // ⚠️ `brand` 가 아니라 `brandName` 을 넘긴다 — `brand` 는 빈 값일 때
          //   "당신의 브랜드" 로 대체되는 **표시용 문구**라, 그걸 하이라이트하면
          //   원문에 우연히 있는 그 글자에 형광이 칠해진다(거짓 표시).
          <MirrorCard
            brandName={brandName}
            engine={r}
            isKo={isKo}
            key={r.engineId}
            // 🔴 「모름」 카드가 *"다른 AI N곳은 이미 안다"* 라고 말하려면 그 수가 필요하다.
            //   여기서 다시 세지 않고 위에서 이미 낸 `known` 을 넘긴다(같은 수치 2벌 금지).
            knownCount={known.length}
          />
        ))}
      </div>

      {hiddenCount > 0 && (
        <button
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.02] py-3 font-medium text-sm text-zinc-300 transition-colors hover:bg-white/[0.05] hover:text-zinc-100"
          onClick={() => setExpanded((v) => !v)}
          type="button"
        >
          {expandLabel(expanded, hiddenCount, isKo)}
          <ChevronDown
            className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`}
          />
        </button>
      )}

      {/* 자기채점 정직성 각주 */}
      <p className="mt-5 text-[11px] text-zinc-400 leading-relaxed">
        {isKo
          ? "* 브랜드 인지율은 측정에 성공한 AI 엔진 중 우리 브랜드를 실제로 인지하고 서술한 비율입니다. 측정 실패 엔진은 제외합니다. 같은 이름의 다른 대상을 말하거나, 브랜드를 모른 채 되묻는 답변은 인지로 세지 않습니다. 문장 단위 사실 검증은 포함하지 않습니다."
          : "* Recognition rate is the share of successfully measured AI engines that actually know and describe your brand. Failed engines are excluded. Answers about a different entity with the same name, or that ask for clarification without knowing the brand, are not counted. Individual claims are not fact-checked."}
      </p>
    </section>
  );
}

// 카드 정렬 가중치: 인용됨(0) → 모름(1) → 오류(2)
function cardOrder(engine: {
  brandMentioned: boolean;
  errorMessage: string | null;
}): number {
  if (engine.errorMessage) {
    return 2;
  }
  return engine.brandMentioned ? 0 : 1;
}

// 기본으로 펼칠 카드 수. 나머지는 "더 보기"로 접는다.
//
// 🔴 2026-08-10 세션N-16 — **밀도 축소**(리서치: 밀도가 이 카테고리 1위 실패 요인.
//   Peec·Otterly·Profound 독립 지적). 실측: 이 섹션 하나가 **1,409px = 전체 높이의 20%**,
//   페이지 총 7,167px(화면 7.2개)였다.
//   ⚠️ **삭제·요약이 아니라 접기**다 — 원문이 진실거울의 증거이고 "AI가 우리를 이렇게
//   말한다"의 근거라 없애면 제품의 핵심이 사라진다(기존 주석의 경고를 따른다).
const DEFAULT_VISIBLE_CARDS = 3;

/** 더 보기/접기 버튼 라벨. 중첩 삼항을 피해 함수로 뺀다(lint 부채를 새로 만들지 않는다). */
function expandLabel(
  expanded: boolean,
  hiddenCount: number,
  isKo: boolean
): string {
  if (expanded) {
    return isKo ? "접기" : "Show less";
  }
  if (isKo) {
    return `AI ${hiddenCount}곳 더 보기`;
  }
  return `Show ${hiddenCount} more AI${hiddenCount > 1 ? "s" : ""}`;
}

/**
 * 처음에 보여줄 카드를 고른다.
 *
 * 🔴 **단순히 앞 3장을 자르면 안 된다.** 정렬이 인용됨→모름→오류라서 앞을 자르면
 *   **"모름" 카드가 통째로 접힌다.** 모름 = *GEO 개선 1순위* 이자 이 제품이 파는 것이라
 *   그걸 숨기면 밀도를 줄이려다 **제품의 핵심 서사를 숨기는 것**이 된다.
 *   🔬실측(최근 12건): `claude.ai` 모름 1장·`tesla.com` 모름 2장이 **전부 앞3장 밖**이었다.
 *
 * 정책: 인용 카드로 "AI가 이렇게 말한다"를 보여주되, **모름 카드는 최소 1장 반드시 포함**.
 *   (모름이 없으면 기존대로 앞에서 채운다.)
 */
function pickInitialCards<
  T extends { brandMentioned: boolean; errorMessage: string | null },
>(ordered: T[], limit: number): T[] {
  if (ordered.length <= limit) {
    return ordered;
  }
  const head = ordered.slice(0, limit);
  if (head.some((c) => cardOrder(c) === 1)) {
    return head;
  }
  const firstUnknown = ordered.find((c) => cardOrder(c) === 1);
  if (!firstUnknown) {
    return head;
  }
  // 마지막 한 장을 "모름"에 양보한다(인용 카드는 앞에서 이미 서사를 만들었다).
  return [...head.slice(0, limit - 1), firstUnknown];
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
  measured,
}: {
  accuracy: number;
  tone: Tone;
  isKo: boolean;
  /** 분모 = 측정 성공 엔진 수. 라벨에 그대로 노출한다(⑥ 분모 명시) */
  measured: number;
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
      {/* 🔴 "브랜드 인지율" 만 쓰면 분모가 안 보여 상단 96%(응답 기준)와 모순처럼 읽힌다.
          → 분모(엔진 N곳)를 라벨에 함께 적는다. */}
      <span className="mt-0.5 font-medium text-xs text-zinc-400">
        {isKo
          ? `AI ${measured}곳 기준 인지율`
          : `Recognition · ${measured} AIs`}
      </span>
    </div>
  );
}

function MirrorCard({
  engine,
  isKo,
  brandName,
  knownCount,
}: {
  engine: EngineResponse;
  isKo: boolean;
  brandName: string;
  /** 이 회차에서 브랜드를 아는 엔진 수. 「모름」 카드의 ②이유 문장에 쓰인다. */
  knownCount: number;
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

      {/* 🔴 질의 축이 다름을 **그 카드 안에서** 밝힌다(#4-b B-5 · 기획서 §5-c).
            안 밝히면 이 카드의 결과가 옆 카드들과 **같은 질문의 결과로** 읽힌다. */}
      {engine.engineId === BRIEFING_ENGINE_ID ? (
        <p className="mt-1.5 text-[11px] text-zinc-500 leading-relaxed">
          {isKo
            ? "이 카드만 「효과·후기·장단점」으로 물었어요 — 네이버 AI 브리핑이 뜨는 질문 유형이라서요."
            : "This card alone was measured with informational queries (effects · reviews · pros and cons) — the query types that trigger Naver AI Briefing."}
        </p>
      ) : null}

      {/* 원문 or 미언급 프레이밍 */}
      <div className="mt-3 flex-1">
        <MirrorBody
          brandName={brandName}
          engine={engine}
          errored={errored}
          isKo={isKo}
          knownCount={knownCount}
          unknown={unknown}
        />
      </div>

      {/* 감정 (인용된 경우만) */}
      {cited && engine.sentiment && (
        <div
          className="mt-3 flex items-center gap-1.5 font-medium text-xs text-zinc-400"
          title={sentimentHint(engine.sentiment, isKo)}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${SENTIMENT_DOT[engine.sentiment] ?? SENTIMENT_DOT.neutral}`}
          />
          {sentimentLabel(engine.sentiment, isKo)}
        </div>
      )}
    </div>
  );
}

/**
 * 「모름」 카드 본문 — **0 결과 3요소**(세션N-34 · H번 축소판).
 *
 * ⭐ 템플릿 = Scrunch f038(4곳 중 유일하게 빈 상태를 제대로 만든 곳):
 *   **① 상태를 이름 짓고 ② 이유를 설명하고 ③ 행동 1개를 준다.**
 *   경쟁사 4곳은 0 결과에 전부 침묵한다 → 여기가 우리 자리다(v4 §6).
 *
 * 🔬 **실측으로 범위를 좁혔다**(완료 회차 95건 전수 · 표본 아님):
 *   · v4 가 계획한 "측정 성공했는데 브랜드 언급 0곳" 회차 = **0건 / 95건**
 *     → 전면 「0 결과 화면」을 만들면 **아무도 안 보는 화면**이 된다. 만들지 않았다.
 *   · 대신 **엔진 단위 0** 은 실제로 뜬다 — 「모름」 카드가 **8회차(9%)에 10장**.
 *     그중 **6장이 daum**(다음은 성공 275행 중 언급 136행 = **49%**. 나머지 엔진은 0~1%).
 *   · 🔴 **8/8 회차에서 "다른 엔진은 알고 있었다"** → *"이 AI만 모른다"* 는 **사실이다**.
 *
 * ⚠️ **여기서 채널을 지목하지 않는다.** `engineResponses` 에는 `citedSources` 필드가
 *   **아예 없다**(Tracking 에만 있다). "네이버 블로그에 쓰세요" 같은 문장은 이 카드가
 *   가진 근거로는 **지어내는 말**이 된다 — 처방은 근거를 갖춘 액션 섹션이 담당한다.
 */
function UnknownBody({
  isKo,
  knownCount,
}: {
  isKo: boolean;
  knownCount: number;
}) {
  // ③ 행동 — 🔴 **링크를 걸지 않는다.** 결과 페이지에 처방 섹션 앵커가 **없고**
  //   (`id=` 는 `g-good`·`g-warn`·`g-bad` 셋뿐), 없는 앵커로 `href` 를 만들면
  //   **죽은 링크**가 된다(N-32 가 `header.tsx` 에서 고친 것과 같은 결함).
  //   대신 처방 섹션은 이미 **진실거울 바로 다음**에 온다(`audit-result.tsx:1294`
  //   *"처방을 문제 인식 직후로 이동"*) → 방향만 가리키면 충분하다.
  const action = isKo
    ? "아래 처방에서 무엇부터 손볼지 알려드려요."
    : "The fixes below start with what matters most.";

  // ② 이유 — 다른 엔진이 아는 경우에만 그렇게 말한다(실측 8/8이지만 코드로도 지킨다).
  //   🔴 knownCount 가 0이면 "다른 AI는 알아요"가 거짓이 된다 → 문장을 갈라둔다.
  const reason =
    knownCount > 0
      ? isKo
        ? `다른 AI ${knownCount}곳은 이미 우리를 알고 있어요. 이 AI가 읽는 자료에 우리가 아직 없다는 뜻이에요.`
        : `${knownCount} other AI${knownCount > 1 ? "s" : ""} already know you. This one hasn't read about you yet.`
      : isKo
        ? "이 AI가 읽는 자료에 우리가 아직 없다는 뜻이에요."
        : "This AI hasn't read about you yet.";

  return (
    <div className="flex flex-col">
      {/* ① 상태 이름 — 점수가 아니라 **상태**를 말한다. */}
      <p className="font-medium text-sm text-zinc-300">
        {isKo ? "아직 우리를 모릅니다" : "Doesn't know you yet"}
      </p>
      <p className="mt-1 text-sm text-zinc-400 leading-relaxed">{reason}</p>
      <p className="mt-2 text-xs text-zinc-500 leading-relaxed">{action}</p>
    </div>
  );
}

function MirrorBody({
  engine,
  errored,
  unknown,
  isKo,
  brandName,
  knownCount,
}: {
  engine: EngineResponse;
  errored: boolean;
  unknown: boolean;
  isKo: boolean;
  brandName: string;
  knownCount: number;
}) {
  if (errored) {
    return (
      <p className="text-xs text-zinc-400 leading-relaxed">
        {isKo
          ? "이 AI 응답을 불러오지 못했습니다."
          : "Couldn't load this AI's response."}
      </p>
    );
  }
  if (unknown) {
    return <UnknownBody isKo={isKo} knownCount={knownCount} />;
  }
  return (
    <ExpandableQuote
      brandName={brandName}
      isKo={isKo}
      text={stripMarkdown(engine.excerpt)}
    />
  );
}

// 원문 인용 — 결함감사(2026-07-30) §6·§7:
//   - whitespace-pre-line 누락으로 줄바꿈이 전부 붙어 "벽글"이 됐음 → 복원.
//   - 긴 URL이 카드 밖으로 흘렀음 → overflow-wrap:anywhere.
//   - 1500자 excerpt가 카드 하나만 거대하게 만들었음 → 10줄 클램프 + 더 보기.
/**
 * 원문에서 **브랜드명만 형광 표시**한다.
 *
 * 🔴 왜 필요한가(B-①, 2026-08-10 세션N-16): 진실거울의 목적은 *"AI가 우리를 어떻게 말하나"* 인데,
 *   원문이 길어 **어디에 우리가 나오는지 눈으로 못 찾는다**. 리서치가 *"유일하게 문서화된
 *   신뢰 구현"* 이라 부른 Semrush 2단 패널의 핵심도 **브랜드 하이라이트**다(📕`06번`).
 *
 * 🔒 **XSS 표면 0** — `dangerouslySetInnerHTML` 을 쓰지 않는다. 문자열을 잘라 **React 노드 배열**로
 *   만든다(같은 저장소가 `sanitize.ts` 에서 태그를 제거하는 이유와 같은 원칙: HTML 을 만들지 않는다).
 * ⚠️ 정규식 특수문자는 이스케이프한다 — 브랜드명에 `.`·`+` 가 들어가면(`claude.ai`) 오매칭한다.
 */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function highlightBrand(text: string, brand: string): ReactNode {
  const name = brand.trim();
  // 1글자 브랜드는 오탐이 너무 많다(조사·접두어에 걸린다) → 그냥 원문.
  if (name.length < 2) {
    return text;
  }
  const parts = text.split(new RegExp(`(${escapeRegExp(name)})`, "gi"));
  if (parts.length === 1) {
    return text;
  }
  let offset = 0;
  return parts.map((part) => {
    // 키는 "이 조각이 원문 어디서 시작하는가" = 정적 문자열이라 인덱스 키가 아니다.
    const at = offset;
    offset += part.length;
    if (part.toLowerCase() !== name.toLowerCase()) {
      return part;
    }
    return (
      <mark
        className="rounded-[3px] bg-[var(--brand-2)]/20 px-0.5 font-medium text-[var(--brand-2)]"
        key={`b${at}`}
      >
        {part}
      </mark>
    );
  });
}

function ExpandableQuote({
  text,
  isKo,
  brandName,
}: {
  text: string;
  isKo: boolean;
  brandName: string;
}) {
  const body = text || (isKo ? "(응답 없음)" : "(no response)");
  // 진실의 거울은 엔진별 판정의 비교 요약이다. 원문 전문은 아래 `측정 원문`에만 둬
  // 같은 답변을 두 번 읽게 하지 않는다.
  const clampable = body.length > 120;

  return (
    <div>
      <blockquote
        className="line-clamp-3 whitespace-pre-line border-[var(--brand-2)]/30 border-l-2 pl-3 text-sm text-zinc-300 leading-relaxed [overflow-wrap:anywhere]"
      >
        {highlightBrand(body, brandName)}
      </blockquote>
      {clampable && (
        <p className="mt-2 text-xs text-zinc-500">
          {isKo
            ? "전문은 아래 ‘측정 원문’에서 확인할 수 있어요."
            : "Read the full response in Measurement evidence below."}
        </p>
      )}
    </div>
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
      <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-zinc-400">
        {isKo ? "오류" : "Error"}
      </span>
    );
  }
  if (!engine.brandMentioned) {
    return (
      <span className="rounded-full border border-[var(--brand-2)]/30 bg-[var(--brand-2)]/10 px-2 py-0.5 font-medium text-[10px] text-[var(--brand-2)]">
        {/* 🔴 **브리핑만 다른 말을 한다**(N-45 · #4-b B-5).
              브리핑은 7엔진과 **다른 질문**(효과·후기·장단점)을 던진다. 안 떴다는 건
              *"이 질의엔 브리핑 블록이 안 뜬다"*(정상 동작)이지 *"당신을 모른다"* 가
              아니다. 같은 문구를 쓰면 📕 최다 사고 유형(다르게 잰 것을 0 이라 부르기)이 된다. */}
        {engine.engineId === BRIEFING_ENGINE_ID
          ? isKo
            ? "이 질문엔 안 떠요"
            : "Not shown for this query"
          : isKo
            ? "당신을 모름"
            : "Doesn't know you"}
      </span>
    );
  }
  // 🔴 **`인용됨` → `말함`** (세션N-34 · v4 §4-a-2 축5 용어 충돌 해소).
  //   이 배지가 그리는 값은 `brandMentioned` = **답변 본문에 이름이 나왔나**(등장)이지
  //   **출처 링크로 우리 페이지가 걸렸나**(인용)가 아니다.
  //   🔴 같은 페이지의 `naver-vs-ai-gap.tsx:240` 은 *"「인용」은 출처 링크를 뜻해 다른 지표"*
  //     라며 그 단어를 금지하는데 **여기만 그 말을 쓰고 있었다** = 한 화면 안 용어 충돌.
  //   📕 정의는 `metric-dictionary.ts` 가 단독으로 갖는다(`METRICS.sov` vs `METRICS.citation`).
  let citedLabel = isKo ? "우리를 말함" : "Mentioned";
  // 🔴 truthy 검사(`if (engine.mentionPosition)`)였다 — `0` 을 null 로 삼켰다.
  //   같은 필드를 `naver-vs-ai-gap.tsx:67` 은 `!== null` 로 검사한다 = **한 필드에 두 규칙**
  //   (재설계안 v4 §4-a-1 ⑤). 판정 규칙은 하나여야 한다 → `!== null` 로 맞춘다.
  //   ⚠️ 순위는 1-base 라 실무상 0 이 오면 그건 파싱 이상이지, "순위 없음"이 아니다.
  //   그걸 조용히 숨기면 이 저장소가 반복해 온 "0 과 null 뭉개기"가 된다.
  if (engine.mentionPosition !== null) {
    // 순위도 같은 이유로 `인용` 을 뗀다 — 이건 **답변 안에서 몇 번째로 나왔나**다.
    citedLabel = isKo
      ? `${engine.mentionPosition}번째로 말함`
      : `Mentioned #${engine.mentionPosition}`;
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-[var(--signal-good)]/30 bg-[var(--signal-good)]/10 px-2 py-0.5 font-medium text-[10px] text-[var(--signal-good)]">
      {citedLabel}
    </span>
  );
}

/**
 * 감성 배지 문구.
 *
 * 🔬 S7-4차(2026-08-12) 실측: 진단서는 *"배지가 전부 '중립적으로 서술'이라 변별력 0"*
 *   이라고 했는데, 라이브 회차를 열어보니 **실제 분포가 중립 18 / 긍정 3** 이었다.
 *   = 배지가 틀린 게 아니라 **데이터가 정말 중립에 몰려 있다**.
 *   → 없는 차이를 만들어내지 않는다(그건 조작이다). 대신 **"중립"이 무슨 뜻인지**를
 *     `title` 로 붙인다 — AI 답변에서 중립은 "나쁘지 않다"가 아니라 **"밋밋해서 안 골라진다"**
 *     이고, 그게 곧 개선 대상이라는 걸 고객이 알아야 한다.
 *   ⚠️ `sentiment` 가 null 인 응답(실측 8건)은 호출부(`cited && engine.sentiment`)가
 *     이미 막고 있다 — null 을 "중립"으로 **표시하지 않는다**(없는 판정을 만들지 않는다).
 */
function sentimentLabel(sentiment: string, isKo: boolean): string {
  if (sentiment === "positive") {
    return isKo ? "긍정적으로 서술" : "Positive";
  }
  if (sentiment === "negative") {
    return isKo ? "부정적으로 서술" : "Negative";
  }
  return isKo ? "중립적으로 서술" : "Neutral";
}

/** 배지에 붙는 설명(마우스 올리면 뜬다). 중립이 왜 개선 대상인지 알려준다. */
function sentimentHint(sentiment: string, isKo: boolean): string {
  if (sentiment === "positive") {
    return isKo
      ? "AI가 우리를 추천하듯 말해요. 이 답변에 쓰인 표현을 다른 채널에도 퍼뜨리면 좋아요."
      : "The AI speaks favorably. Reuse this phrasing across your other channels.";
  }
  if (sentiment === "negative") {
    return isKo
      ? "AI가 부정적으로 말해요. 근거가 된 출처를 찾아 바로잡는 게 최우선이에요."
      : "The AI speaks negatively. Find and correct the source behind it first.";
  }
  return isKo
    ? "사실만 건조하게 말해요. 틀린 건 아니지만 고를 이유를 못 주는 상태라, 차별점이 담긴 문장을 늘리면 달라져요."
    : "Factual but flat — no reason to pick you. Adding differentiator sentences moves this.";
}
