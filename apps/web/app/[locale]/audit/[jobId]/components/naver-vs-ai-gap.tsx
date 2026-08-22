// Naver vs AI Answer Gap Card (D-048, 2026-05-07)
//
// 목적:
//   네이버 검색에서 1위인 광고주가 ChatGPT 답변에서는 안 보이는 갭을 시각화.
//   D2SF 시너지 방안 A — Hello Max 패턴 미러.
//   "광고주의 AI 시대 가시성 인프라" 메시지 라이브 증거.
//
// 데이터 소스:
//   audit-result의 engineResponses에서 naver/naver-briefing/hyperclova vs
//   chatgpt/chatgpt-web/claude/perplexity/gemini 그룹 비교.
//
// 시각화:
//   - 좌: "한국 채널 (네이버·하이퍼클로바·다음)" 평균 인용률
//   - 우: "글로벌 AI (ChatGPT·Claude·Perplexity·Gemini)" 평균 인용률
//   - 가운데: 갭 표시 + 액션 추천

"use client";

import { filterByRegion } from "@repo/audit/market-scope";
import { shortRankLabel } from "@repo/audit/rank-label";

interface EngineResponse {
  brandMentioned: boolean;
  engineId: string;
  errorMessage: string | null;
  isStub: boolean;
  // 🔴 S7-3차(2026-08-12) 추가 — AI 답변 목록의 크기(순위의 **분모**).
  //   엔진 응답에는 원래 있던 값인데(`packages/ai/.../types.ts`) 이 카드가 안 읽어서
  //   "평균 3.2위"를 분모 없이 말하고 있었다.
  mentionListSize?: number | null;
  mentionPosition: number | null;
}

interface Props {
  engineResponses: EngineResponse[];
  isKo: boolean;
}

// 🔴 권역 분류는 `@repo/audit/market-scope` 가 단일 진실이다(세션N-34).
//   여기 사설 Set 두 벌이 있었다. 지금은 목록이 우연히 일치하지만 **판정 규칙이 다르다**:
//   market-scope 는 *모르는 엔진을 글로벌로* 본다(글로벌 LLM 이 계속 느는 쪽이라).
//   사설 GLOBAL_ENGINES 는 닫힌 목록이라 **새 엔진이 추가되면 어느 쪽에도 안 잡혀
//   조용히 사라진다** — 화면에서 엔진이 누락돼도 아무도 모른다.

function calcRate(responses: EngineResponse[]) {
  const valid = responses.filter((r) => !(r.isStub || r.errorMessage));
  if (valid.length === 0) {
    return { rate: 0, mentioned: 0, total: 0 };
  }
  const mentioned = valid.filter((r) => r.brandMentioned).length;
  return {
    rate: Math.round((mentioned / valid.length) * 100),
    mentioned,
    total: valid.length,
  };
}

function calcAvgPosition(responses: EngineResponse[]) {
  const positions = responses
    .filter((r) => r.brandMentioned && r.mentionPosition !== null)
    .map((r) => r.mentionPosition as number);
  if (positions.length === 0) {
    return null;
  }
  return (
    Math.round((positions.reduce((a, b) => a + b, 0) / positions.length) * 10) /
    10
  );
}

/**
 * 순위의 **분모** — AI 답변 목록의 평균 크기.
 * 🔴 S7-3차(2026-08-12): 순위만 말하고 분모를 감추면 "3.2위"가 5개 중인지 50개 중인지
 *   알 수 없다. 순위를 낸 것과 **같은 응답 집합**에서 구해야 둘이 어긋나지 않는다.
 *   목록 크기를 못 받은 회차(도입 전 job)는 null → 표기에서 분모가 조용히 빠진다.
 */
function calcAvgListSize(responses: EngineResponse[]) {
  const sizes = responses
    .filter(
      (r) =>
        r.brandMentioned &&
        r.mentionPosition !== null &&
        typeof r.mentionListSize === "number"
    )
    .map((r) => r.mentionListSize as number);
  if (sizes.length === 0) {
    return null;
  }
  return Math.round(sizes.reduce((a, b) => a + b, 0) / sizes.length);
}

// 각주용 라벨 (오류로 제외된 엔진 고지)
const GAP_ENGINE_LABELS: Record<string, string> = {
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
 * 엔진별 언급 성적 (전수감사 2026-08-02 §A-2).
 * "네이버 채널 50%"라는 합계만 보여주니 사용자가 "왜 50%인지" 물었다 —
 * 근거(어느 엔진이 몇 번 놓쳤는지)는 데이터에 이미 있으므로 그대로 보여준다.
 */
function perEngineBreakdown(responses: EngineResponse[]) {
  const byEngine = new Map<string, { hit: number; total: number }>();
  for (const r of responses) {
    if (r.isStub || r.errorMessage) {
      continue;
    }
    const cur = byEngine.get(r.engineId) ?? { hit: 0, total: 0 };
    cur.total += 1;
    if (r.brandMentioned) {
      cur.hit += 1;
    }
    byEngine.set(r.engineId, cur);
  }
  return [...byEngine.entries()]
    .map(([engineId, s]) => ({
      engineId,
      label: GAP_ENGINE_LABELS[engineId] ?? engineId,
      ...s,
    }))
    .sort((a, b) => a.hit / a.total - b.hit / b.total); // 약한 엔진 먼저
}

export function NaverVsAiGap({ engineResponses, isKo }: Props) {
  const koreanResponses = filterByRegion(engineResponses, "korea");
  const globalResponses = filterByRegion(engineResponses, "global");
  // 결함감사(2026-07-30) §11: calcRate가 오류 응답을 조용히 분모에서 빼는데,
  // 화면 위쪽엔 그 엔진들의 오류 카드가 보여 "100%"가 모순처럼 읽혔음 → 명시 고지.
  const excludedLabels = [
    ...new Set(
      engineResponses
        .filter((r) => r.errorMessage && !r.isStub)
        .map((r) => GAP_ENGINE_LABELS[r.engineId] ?? r.engineId)
    ),
  ];

  if (koreanResponses.length === 0 || globalResponses.length === 0) {
    return null; // 어느 한쪽 데이터 없으면 카드 자체 미표시
  }

  const korean = calcRate(koreanResponses);
  const global = calcRate(globalResponses);
  const koreanPos = calcAvgPosition(koreanResponses);
  const globalPos = calcAvgPosition(globalResponses);

  // 🔴 S7-3차(2026-08-12) — 순위 표기를 `@repo/audit/rank-label` 로 단일화한다.
  //   분모(목록 크기)는 **엔진 응답에 원래 있던 값**인데 이 카드가 안 읽고 있었다.
  //   분모를 못 구한 회차는 함수가 알아서 숫자만 말한다(없는 근거를 지어내지 않는다).
  const koreanRankLabel = shortRankLabel(
    {
      averagePosition: koreanPos,
      listSize: calcAvgListSize(koreanResponses),
    },
    isKo
  );
  const globalRankLabel = shortRankLabel(
    {
      averagePosition: globalPos,
      listSize: calcAvgListSize(globalResponses),
    },
    isKo
  );
  const koreanBreakdown = perEngineBreakdown(koreanResponses);
  const globalBreakdown = perEngineBreakdown(globalResponses);
  // 처방을 일반론이 아니라 "가장 많이 놓친 엔진 이름"으로 말한다(전수감사 §A-2).
  const weakestKorean = koreanBreakdown.find((e) => e.hit < e.total);

  const gap = korean.rate - global.rate;
  const koreanLeads = gap > 10;
  const globalLeads = gap < -10;
  const balanced = !(koreanLeads || globalLeads);

  // 🔴 S7-c(2026-08-11) — 배지 아래 라벨. 예전엔 "격차" 한 단어였고 방향은 **화살표**가
  //   말했는데, `globalLeads`(gap 이 음수)에 **상승 화살표**가 붙어 「↗ -46%p」로 보였다
  //   = 3초 안에 방향을 거꾸로 읽는다(NN/g 2). → 방향을 **글자**가 책임진다.
  let gapDirectionLabel = isKo ? "격차 — 양쪽 비슷" : "Gap — balanced";
  if (koreanLeads) {
    gapDirectionLabel = isKo
      ? "격차 — 한국 AI가 더 많이 말해요"
      : "Gap — Korean AI cites more";
  } else if (globalLeads) {
    gapDirectionLabel = isKo
      ? "격차 — 글로벌 AI가 더 많이 말해요"
      : "Gap — global AI cites more";
  }

  let headline = "";
  let recommendation = "";
  if (koreanLeads) {
    headline = isKo
      ? `네이버 채널은 ${korean.rate}%인데, 글로벌 AI는 ${global.rate}%입니다.`
      : `Naver channels are at ${korean.rate}%, but global AI is only ${global.rate}%.`;
    recommendation = isKo
      ? "한국에서는 잘 발견되지만 글로벌 AI 답변에서는 공백이 큽니다. 영문 콘텐츠·해외 인용 소스 확보가 필요합니다."
      : "You're well discovered in Korea but have a large gap in global AI answers. Securing English content and overseas citation sources is needed.";
  } else if (globalLeads) {
    headline = isKo
      ? `글로벌 AI는 ${global.rate}%인데, 네이버 채널은 ${korean.rate}%입니다.`
      : `Global AI is at ${global.rate}%, but Naver channels are only ${korean.rate}%.`;
    // "한국 사용자는 못 찾습니다"는 54% 같은 값에 과장 — 실측 엔진명으로 대체.
    if (isKo && weakestKorean) {
      recommendation = `격차의 주범은 ${weakestKorean.label}입니다 — ${weakestKorean.total}번 물어 ${weakestKorean.total - weakestKorean.hit}번 브랜드를 언급하지 않았습니다. 해당 채널에 노출될 콘텐츠(네이버 AI 브리핑·블로그)부터 보강하세요.`;
    } else if (isKo) {
      recommendation =
        "글로벌 대비 한국 채널 언급이 약합니다. 네이버 AI 브리핑·블로그 SEO 강화가 필요합니다.";
    } else {
      recommendation =
        "Your global position is strong, but Korean channels mention you less. Strengthening Naver AI Briefing and blog SEO is needed.";
    }
  } else {
    headline = isKo
      ? `한국·글로벌 AI 답변 가시성이 균형을 이룹니다 (${korean.rate}% vs ${global.rate}%).`
      : `Korean and global AI visibility are balanced (${korean.rate}% vs ${global.rate}%).`;
    recommendation = isKo
      ? "양쪽 채널 모두 안정적으로 측정됩니다. 다음 단계는 점유율 자체를 끌어올리는 콘텐츠 전략입니다."
      : "Both channels measure stably. The next step is a content strategy to lift share of voice itself.";
  }

  return (
    <section className="rounded-2xl border border-zinc-800 bg-gradient-to-br from-zinc-900/80 to-zinc-950 p-6 md:p-8">
      <div className="mb-4 flex items-center gap-2">
        <span className="inline-flex h-1.5 w-1.5 rounded-full bg-indigo-400" />
        <span className="font-medium text-xs text-zinc-400">
          Naver × Global AI · Visibility Gap
        </span>
      </div>

      {/* 섹션 목적 한 줄 — "이 카드가 뭘 알려주는가" (결함감사 §11) */}
      <p className="mb-3 text-[13px] text-zinc-400 leading-relaxed">
        {isKo
          ? // 용어 통일(전수감사 §A-2): 여기서 재는 건 답변 본문 "언급"이다.
            // "인용"은 출처 링크를 뜻해(세션J Mention/Citation 분리) 다른 지표.
            "한국 사용자가 쓰는 AI(네이버·하이퍼클로바·다음)와 글로벌 AI가 답변에서 브랜드를 언급한 비율을 비교해, 어느 채널의 GEO부터 보강할지 알려주는 카드입니다."
          : "Compares how often Korean AIs (Naver · HyperCLOVA · Daum) vs global AIs mention your brand — so you know which channel to strengthen first."}
      </p>

      {/* 한글은 정사각 격자라 음수 자간이 가독성을 깎는다 → 한글일 때만 tracking 제거 */}
      <h3
        className={`mb-2 font-medium text-[20px] text-zinc-100 leading-snug md:text-[24px] ${
          isKo ? "" : "tracking-tight"
        }`}
      >
        {headline}
      </h3>
      <p className="mb-6 text-[14px] text-zinc-400 leading-relaxed">
        {recommendation}
      </p>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_auto_1fr] md:items-center">
        {/* 좌측: 한국 채널 */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
          <div className="mb-3 flex items-center justify-between">
            <span className="font-medium text-xs text-zinc-400">
              {isKo ? "한국 채널" : "Korean channels"}
            </span>
            <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 font-medium text-[10px] text-emerald-400">
              {isKo
                ? "네이버 · 하이퍼클로바 · 다음"
                : "Naver · HyperCLOVA · Daum"}
            </span>
          </div>
          <div className="flex items-end gap-2">
            <span className="font-medium text-[40px] text-zinc-100 leading-none tracking-tight">
              {korean.rate}
              <span className="font-medium text-[20px] text-zinc-400">%</span>
            </span>
          </div>
          <div className="mt-2 text-[12px] text-zinc-400">
            {isKo
              ? `언급 ${korean.mentioned} / 측정 ${korean.total}`
              : `Mentioned ${korean.mentioned} / Measured ${korean.total}`}
            {/* 🔴 S7-3차(2026-08-12) — 예전엔 `평균 3.2위` 라는 **맨 숫자**였다.
                같은 페이지 상단 KPI 는 `평균 12개 중 · 19개 응답 평균` 처럼 분모를
                밝히는데 여기만 감췄다 — "3.2위"는 목록이 5개일 때와 50개일 때 뜻이
                전혀 다르다. → 표기를 `@repo/audit/rank-label` 로 **단일화**한다. */}
            {koreanRankLabel !== null && ` · ${koreanRankLabel}`}
          </div>
          {/* 엔진별 근거 — "50%가 어디서 왔는지" 합계만으론 알 수 없다(§A-2) */}
          <div className="mt-3 flex flex-wrap gap-1.5">
            {koreanBreakdown.map((e) => (
              <span
                className={`rounded-md border px-1.5 py-0.5 font-mono text-[10px] ${
                  e.hit === e.total
                    ? "border-white/10 text-zinc-400"
                    : "border-amber-500/25 bg-amber-500/5 text-amber-300/90"
                }`}
                key={e.engineId}
              >
                {e.label} {e.hit}/{e.total}
              </span>
            ))}
          </div>
        </div>

        {/* 가운데: 갭 표시 */}
        <div className="flex items-center justify-center md:flex-col">
          <div
            className={`flex items-center gap-1 rounded-full border px-3 py-1.5 font-mono text-[12px] ${
              koreanLeads
                ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
                : globalLeads
                  ? "border-rose-500/30 bg-rose-500/10 text-rose-300"
                  : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
            }`}
          >
            {/* 🔴 S7-c(2026-08-11) — 예전에는 `globalLeads`(=gap 이 **음수**)일 때
                **상승 화살표(TrendingUp)** 를 붙였다. 의도는 "글로벌이 우세"였지만
                화면에는 **「↗ -46%p」** 로 나와 3초 안에 **방향을 거꾸로** 읽게 만들었다
                (NN/g 2 · 마이너스 숫자에 상승 기호). 아이콘은 어느 쪽이 큰지를 못 말한다.
                → 화살표를 빼고 **누가 앞서는지 글자로** 말한다. 색은 그대로 두되
                  라벨이 방향을 책임진다. */}
            <span>
              {balanced
                ? isKo
                  ? "균형"
                  : "Balanced"
                : `${gap > 0 ? "+" : ""}${gap}%p`}
            </span>
          </div>
          <span className="mt-2 max-w-[8rem] text-center font-medium text-xs text-zinc-400">
            {gapDirectionLabel}
          </span>
        </div>

        {/* 우측: 글로벌 AI */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
          <div className="mb-3 flex items-center justify-between">
            <span className="font-medium text-xs text-zinc-400">
              {isKo ? "글로벌 AI" : "Global AI"}
            </span>
            <span className="rounded-full bg-indigo-500/10 px-2 py-0.5 font-medium text-[10px] text-indigo-400">
              ChatGPT · Claude · Perplexity · Gemini
            </span>
          </div>
          <div className="flex items-end gap-2">
            <span className="font-medium text-[40px] text-zinc-100 leading-none tracking-tight">
              {global.rate}
              <span className="font-medium text-[20px] text-zinc-400">%</span>
            </span>
          </div>
          <div className="mt-2 text-[12px] text-zinc-400">
            {isKo
              ? `언급 ${global.mentioned} / 측정 ${global.total}`
              : `Mentioned ${global.mentioned} / Measured ${global.total}`}
            {globalRankLabel !== null && ` · ${globalRankLabel}`}
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {globalBreakdown.map((e) => (
              <span
                className={`rounded-md border px-1.5 py-0.5 font-mono text-[10px] ${
                  e.hit === e.total
                    ? "border-white/10 text-zinc-400"
                    : "border-amber-500/25 bg-amber-500/5 text-amber-300/90"
                }`}
                key={e.engineId}
              >
                {e.label} {e.hit}/{e.total}
              </span>
            ))}
          </div>
        </div>
      </div>

      <p className="mt-4 text-[11px] text-zinc-400 leading-relaxed">
        {isKo
          ? "* 측정 수 = 성공한 응답 수(프롬프트 × 엔진). 언급률은 측정 성공 기준이며, 답변 본문에 브랜드가 나오는지를 셉니다(출처 링크 인용과는 다른 지표)."
          : "* Measured = successful responses (prompts × engines). Mention rate counts the brand appearing in answer text (distinct from source-link citations)."}
        {excludedLabels.length > 0 &&
          (isKo
            ? ` ${excludedLabels.join("·")}는 일시 오류로 이번 비교에서 제외했습니다.`
            : ` ${excludedLabels.join(" · ")} failed temporarily and are excluded.`)}
      </p>
    </section>
  );
}
