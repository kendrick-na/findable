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

import { TrendingDown, TrendingUp } from "lucide-react";

interface EngineResponse {
  engineId: string;
  brandMentioned: boolean;
  mentionPosition: number | null;
  isStub: boolean;
  errorMessage: string | null;
}

interface Props {
  engineResponses: EngineResponse[];
  isKo: boolean;
}

const KOREAN_ENGINES = new Set(["naver", "naver-briefing", "hyperclova", "daum"]);
const GLOBAL_ENGINES = new Set([
  "chatgpt",
  "chatgpt-web",
  "claude",
  "perplexity",
  "gemini",
]);

function calcRate(responses: EngineResponse[]) {
  const valid = responses.filter((r) => !r.isStub && !r.errorMessage);
  if (valid.length === 0) return { rate: 0, mentioned: 0, total: 0 };
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
  if (positions.length === 0) return null;
  return Math.round((positions.reduce((a, b) => a + b, 0) / positions.length) * 10) / 10;
}

export function NaverVsAiGap({ engineResponses, isKo }: Props) {
  const koreanResponses = engineResponses.filter((r) => KOREAN_ENGINES.has(r.engineId));
  const globalResponses = engineResponses.filter((r) => GLOBAL_ENGINES.has(r.engineId));

  if (koreanResponses.length === 0 || globalResponses.length === 0) {
    return null; // 어느 한쪽 데이터 없으면 카드 자체 미표시
  }

  const korean = calcRate(koreanResponses);
  const global = calcRate(globalResponses);
  const koreanPos = calcAvgPosition(koreanResponses);
  const globalPos = calcAvgPosition(globalResponses);

  const gap = korean.rate - global.rate;
  const koreanLeads = gap > 10;
  const globalLeads = gap < -10;
  const balanced = !koreanLeads && !globalLeads;

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
    recommendation = isKo
      ? "역수출 포지션은 강하지만 한국 사용자는 우리 브랜드를 못 찾습니다. 네이버 AI 브리핑·블로그 SEO 강화가 필요합니다."
      : "Your global position is strong, but Korean users can't find your brand. Strengthening Naver AI Briefing and blog SEO is needed.";
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
        <span className="font-mono text-[11px] text-zinc-500 uppercase tracking-[0.18em]">
          Naver × Global AI · Visibility Gap
        </span>
      </div>

      <h3 className="mb-2 font-medium text-[20px] text-zinc-100 leading-snug tracking-tight md:text-[24px]">
        {headline}
      </h3>
      <p className="mb-6 text-[14px] text-zinc-400 leading-relaxed">{recommendation}</p>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_auto_1fr] md:items-center">
        {/* 좌측: 한국 채널 */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
          <div className="mb-3 flex items-center justify-between">
            <span className="font-mono text-[11px] text-zinc-500 uppercase tracking-[0.14em]">
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
              <span className="font-medium text-[20px] text-zinc-500">%</span>
            </span>
          </div>
          <div className="mt-2 text-[12px] text-zinc-500">
            {isKo
              ? `인용 ${korean.mentioned} / 측정 ${korean.total}`
              : `Cited ${korean.mentioned} / Measured ${korean.total}`}
            {koreanPos !== null &&
              (isKo ? ` · 평균 ${koreanPos}위` : ` · avg #${koreanPos}`)}
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
            {koreanLeads && <TrendingDown aria-hidden="true" className="h-3.5 w-3.5" />}
            {globalLeads && <TrendingUp aria-hidden="true" className="h-3.5 w-3.5" />}
            <span>
              {balanced
                ? isKo
                  ? "균형"
                  : "Balanced"
                : `${gap > 0 ? "+" : ""}${gap}%p`}
            </span>
          </div>
          <span className="mt-2 font-mono text-[10px] text-zinc-600 uppercase tracking-[0.12em]">
            {isKo ? "격차" : "Gap"}
          </span>
        </div>

        {/* 우측: 글로벌 AI */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
          <div className="mb-3 flex items-center justify-between">
            <span className="font-mono text-[11px] text-zinc-500 uppercase tracking-[0.14em]">
              {isKo ? "글로벌 AI" : "Global AI"}
            </span>
            <span className="rounded-full bg-indigo-500/10 px-2 py-0.5 font-medium text-[10px] text-indigo-400">
              ChatGPT · Claude · Perplexity · Gemini
            </span>
          </div>
          <div className="flex items-end gap-2">
            <span className="font-medium text-[40px] text-zinc-100 leading-none tracking-tight">
              {global.rate}
              <span className="font-medium text-[20px] text-zinc-500">%</span>
            </span>
          </div>
          <div className="mt-2 text-[12px] text-zinc-500">
            {isKo
              ? `인용 ${global.mentioned} / 측정 ${global.total}`
              : `Cited ${global.mentioned} / Measured ${global.total}`}
            {globalPos !== null &&
              (isKo ? ` · 평균 ${globalPos}위` : ` · avg #${globalPos}`)}
          </div>
        </div>
      </div>
    </section>
  );
}
