"use client";

import {
  type CompetitorRank,
  extractCompetitorLandscape,
  isMyBrand,
} from "@repo/audit/competitor-extract";
import { Info } from "lucide-react";

interface CompetitorBenchmarkProps {
  brandName: string;
  brandVariants?: string[];
  excerpts: string[];
  isKo: boolean;
  /** ⛔ 거르는 목록이 아니라 **표기 병합 사전**(👤 승인 ⓐ). 구 job 엔 없다 → optional. */
  registeredCompetitors?: Array<{ aliases?: string[]; name: string } | string>;
}

const T = (isKo: boolean) => ({
  // eyebrow도 제목과 같은 약속 수준으로 맞춘다 — "경쟁사 벤치마크"라고 해두고
  //   제목만 "함께 거론한 이름들"로 낮추면 한 카드가 두 말을 한다.
  eyebrow: isKo
    ? "함께 언급된 브랜드 (추정)"
    : "Co-mentioned brands (estimate)",
  // 🔴 제목을 데이터가 실제로 말하는 것으로 (2026-08-06 세션N-7)
  //   "경쟁 지형"은 **검증된 경쟁사**라는 뜻으로 읽힌다. 그러나 이 값은 AI 답변의 번호목록을
  //   파싱한 것이라 무관한 이름이 섞인다(실측: 5throck 진단에 Zara·Urban Outfitters).
  //   B2B 제조 관점에서 "우리 진짜 경쟁사는 하나도 없다"가 나오면 신뢰가 무너진다
  //   → 제목이 약속을 낮추면 같은 데이터가 "참고 정보"로 정직하게 읽힌다.
  headline: isKo
    ? "AI가 함께 거론한 이름들"
    : "Names the AI mentioned alongside you",
  sub: isKo
    ? "AI가 이 카테고리를 물었을 때 함께 거론한 브랜드들의 상대적 언급 점유율입니다."
    : "Relative mention share of brands the AI listed alongside you.",
  you: isKo ? "내 브랜드" : "You",
  mentions: isKo ? "언급" : "mentions",
  avgRank: isKo ? "평균 순위" : "avg rank",
  notFound: isKo
    ? "AI 답변의 경쟁 목록에서 내 브랜드가 아직 잡히지 않았습니다. 경쟁사들은 거론되는데 내 브랜드는 빠져 있다는 신호입니다."
    : "Your brand wasn't found in the AI's competitor list yet — competitors are named while you're absent.",
  lowSample: isKo
    ? "표본이 적어 참고용입니다. 정밀 비교는 경쟁사 직접 측정(Pro)에서 제공됩니다."
    : "Small sample — indicative only. Precise comparison in Pro.",
  disclaimer: isKo
    ? "LLM이 나열한 인기 목록 기반 추정치입니다. 절대 순위가 아니라 AI 답변 내 상대 등장 빈도입니다."
    : "Estimate based on the LLM's popularity list — relative mention frequency, not an absolute ranking.",
});

// 신뢰할 만한 최소 표본(번호목록 항목 수). 미만이면 저신뢰 배지.
const MIN_SAMPLE = 6;
// 상위 몇 개까지 표시.
const TOP_N = 6;

/**
 * ✅ **등록 경쟁사·표기 변형 병합이 적용된다**(N-45 · 남은일 #9 해결).
 *
 * 예전엔 이 화면이 **audit 결과 JSON** 만 받는데 그 JSON 에 브랜드 관계가 없어서
 * 병합 없이 그렸다 → 같은 브랜드가 「아모레퍼시픽」과 「Amorepacific」 으로 따로
 * 세어져 **앱 대시보드와 공개 리포트의 숫자가 갈렸다**.
 * 이제 **러너가 결과에 실어준다**(`runner.ts` · `Json` 컬럼이라 마이그레이션 없음).
 *
 * ⛔ 등록 경쟁사는 **거르는 목록이 아니라 표기 병합 사전**이다(👤 승인 ⓐ · N-44).
 *   화이트리스트로 쓰면 SoV 분모가 바뀌어 점유율이 부풀고, 「우리가 몰랐던 경쟁사」가
 *   화면에서 사라진다.
 *
 * ⚠️ 구 job 은 두 값이 없다 → 기본값 `[]` = **예전과 똑같이 동작한다**(회귀 0).
 * ⚠️ 무료 진단은 `registeredCompetitors` 가 늘 비어 있다(`brandId` 가 없다).
 */
export function CompetitorBenchmark({
  excerpts,
  brandName,
  brandVariants = [],
  isKo,
  registeredCompetitors = [],
}: CompetitorBenchmarkProps) {
  const t = T(isKo);
  const landscape = extractCompetitorLandscape(
    excerpts,
    brandName,
    brandVariants,
    // 4번째 인자 = 표기 병합 사전. 앱 대시보드(`analysis-data.ts`)와 **같은 값·같은 함수**.
    registeredCompetitors
  );

  // 경쟁 지형이 사실상 없으면(항목 2개 미만) 렌더 생략 — 빈 카드 방지.
  if (landscape.ranking.length < 2) {
    return null;
  }

  // 🔴 변별력 없는 분포는 그리지 않는다 (2026-08-06 세션N-7).
  //   라이브 실측 5건 중 3건이 사실상 동률이었다(Haegyung 2·2·2·2·2·2 · 5throck 3·3·3·2·2·2 ·
  //   클로드 8·8·8·8·5·5). 이때 화면은 "경쟁 지형"이라는 이름으로 **아무 정보도 없는 막대 6개**를
  //   보여주고, 게다가 무관한 이름(Zara·Urban Outfitters·"사람 이름/닉네임")이 섞여
  //   **"이 툴은 우리 업종을 모른다"는 신뢰 파괴 지점**이 됐다.
  //   판정은 `@repo/audit` 단일 진실 모듈에 있다(같은 실수를 소비자마다 반복하지 않도록).
  //   ⚠️ 섹션을 없애는 게 아니다 — SK하이닉스(마이크론·삼성전자·인텔)·나이키(아디다스·뉴발란스)는
  //   실제로 유용해서 그대로 표시된다.
  if (!landscape.discriminative) {
    return null;
  }

  const rows = landscape.ranking.slice(0, TOP_N);
  const maxSov = Math.max(...rows.map((r) => r.shareOfVoice), 1);
  const lowConfidence = landscape.sampleSize < MIN_SAMPLE;

  return (
    <section className="relative overflow-hidden rounded-2xl border border-white/10 bg-zinc-900/60 p-6 backdrop-blur-sm md:p-8">
      <div className="font-medium text-[var(--brand-2)] text-xs">
        {t.eyebrow}
      </div>
      {/* 한글은 정사각 격자라 음수 자간이 가독성을 깎는다 → 한글일 때만 tracking 제거 */}
      <h3
        className={`mt-2 font-semibold text-xl text-zinc-100 ${
          isKo ? "" : "tracking-tight"
        }`}
      >
        {t.headline}
      </h3>
      <p className="mt-1 text-sm text-zinc-400">{t.sub}</p>

      {!landscape.brandFound && (
        <div className="mt-4 rounded-xl border border-amber-500/25 bg-amber-500/5 p-3 text-amber-200/90 text-sm">
          {t.notFound}
        </div>
      )}

      <ul className="mt-5 flex flex-col gap-2.5">
        {rows.map((row) => (
          <CompetitorRow
            brandName={brandName}
            brandVariants={brandVariants}
            isKo={isKo}
            key={row.name}
            maxSov={maxSov}
            row={row}
            you={t.you}
          />
        ))}
      </ul>

      <div className="mt-4 flex items-start gap-2 text-xs text-zinc-400">
        <Info aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <p>
          {t.disclaimer}
          {lowConfidence ? ` ${t.lowSample}` : ""}
        </p>
      </div>
    </section>
  );
}

const CompetitorRow = ({
  row,
  maxSov,
  brandName,
  brandVariants,
  you,
  isKo,
}: {
  row: CompetitorRank;
  maxSov: number;
  brandName: string;
  brandVariants: string[];
  you: string;
  isKo: boolean;
}) => {
  const mine = isMyBrand(row.name, brandName, brandVariants);
  const widthPct = Math.max(4, Math.round((row.shareOfVoice / maxSov) * 100));

  return (
    <li className="flex items-center gap-3">
      <span
        className={`w-28 shrink-0 truncate text-sm ${
          mine ? "font-semibold text-[var(--brand-2)]" : "text-zinc-300"
        }`}
        title={row.name}
      >
        {/* 감사 9번 — 브랜드명은 자동번역 대상이 아니다(2026-08-07 세션N-8).
            경쟁사 목록은 외국 브랜드가 많아 번역·음역 위험이 가장 크다. */}
        <span translate="no">{row.name}</span>
        {mine && (
          <span className="ml-1 rounded-full bg-[var(--brand-2)]/15 px-1.5 py-0.5 font-normal text-[10px] text-[var(--brand-2)]">
            {you}
          </span>
        )}
      </span>

      <div className="h-6 flex-1 overflow-hidden rounded bg-zinc-800/60">
        <div
          className="h-full rounded transition-all"
          style={{
            width: `${widthPct}%`,
            background: mine
              ? "var(--brand-2)"
              : "color-mix(in srgb, var(--brand-2) 22%, transparent)",
          }}
        />
      </div>

      <span className="w-10 shrink-0 text-right text-sm text-zinc-200 tabular-nums">
        {row.shareOfVoice}%
      </span>
      <span className="hidden w-16 shrink-0 text-right text-xs text-zinc-400 tabular-nums sm:inline">
        {isKo ? `${row.averageRank}위` : `#${row.averageRank}`}
      </span>
    </li>
  );
};
