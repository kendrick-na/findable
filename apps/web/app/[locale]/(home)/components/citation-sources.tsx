// AI 가 브랜드를 말할 때 **무엇을 근거로 삼았나** — 실측 인용 출처
//
// 🔴 2026-08-16 신설. 이 데이터는 우리 차별점의 **가장 직접적인 증거**인데
//    지금까지 랜딩 어디에도 없었다(로그인 후 결과 화면에만 있었다).
//
//    실측(k-geo-bench v0.1 · 5사 153회 인용):
//      blog.naver.com 95회(62%) · namu.wiki 22회 · 나머지도 대부분 한국 UGC
//      🔴 **브랜드 공식 홈페이지는 153회 중 4회(2.6%)**
//    → "내 사이트를 고치는 것"만으로는 AI 답변이 안 바뀐다는 뜻이고,
//      그 근거지가 **네이버 블로그**라는 건 글로벌 GEO 도구가 안 재는 축이다
//      (경쟁사 4곳 랜딩 fetch: naver·hyperclova·daum 언급 0건).
//
// 📐 형식 근거 — Peec f005(실측 프레임): 실제 도메인 + 인용수 + **역할 태그**
//    (`You`·`Competitor`·`UGC`). 우리는 `공식`·`UGC·커뮤니티`로 가른다.
// ⛔ 회사가 만든 성과 숫자 금지(경쟁사 4곳 공통 규율) → 전부 원본 집계값이다.

import { loadCitationData } from "./sov-chart-data";

interface CitationSourcesProps {
  locale?: string;
}

// biome(useTopLevelRegex): 정규식은 최상위 상수로 — 렌더마다 재컴파일되지 않게.
//   ⚠️ 판정 순서가 의미를 가진다(위키 → 영상 → 뉴스 → 나머지). 상수로 빼면서도
//   `sourceKind` 안의 if 순서를 그대로 유지한다.
const WIKI_HOST = /wiki/;
const VIDEO_HOST = /youtube/;
const NEWS_HOST = /news|daum|mobiinside|openads/;

/** 도메인 성격 — 화면에 태그로 보여준다 */
function sourceKind(domain: string, owned: boolean) {
  if (owned) {
    return { ko: "브랜드 공식", en: "Owned" } as const;
  }
  if (WIKI_HOST.test(domain)) {
    return { ko: "위키", en: "Wiki" } as const;
  }
  if (VIDEO_HOST.test(domain)) {
    return { ko: "영상", en: "Video" } as const;
  }
  if (NEWS_HOST.test(domain)) {
    return { ko: "뉴스·매체", en: "News" } as const;
  }
  return { ko: "UGC·커뮤니티", en: "UGC" } as const;
}

export const CitationSources = ({ locale = "ko" }: CitationSourcesProps) => {
  const isKo = locale.startsWith("ko");
  const lp = isKo ? "/ko" : "";
  const data = loadCitationData();
  const top = data.sources.slice(0, 6);
  const ownedShare = data.total ? (data.ownedCount / data.total) * 100 : 0;
  const max = top.at(0)?.count ?? 1;

  return (
    <div
      className="rounded-xl border border-[var(--findable-hairline)] bg-[var(--findable-surface-1)] p-8"
      style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)" }}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between">
        <div>
          <p
            className="text-[12px] text-[var(--findable-ink-subtle)]"
            style={{ fontFamily: "var(--findable-font-sans)" }}
          >
            Citation Sources
          </p>
          <h3
            className="mt-1 text-[16px] text-[var(--findable-ink)]"
            style={{ fontFamily: "var(--findable-font-sans)", fontWeight: 500 }}
          >
            {isKo
              ? "AI는 무엇을 보고 우리 브랜드를 말하나"
              : "What AI reads before it talks about your brand"}
          </h3>
        </div>
        <div
          className="flex items-center gap-2 text-[11px] text-[var(--findable-ink-tertiary)]"
          style={{ fontFamily: "var(--findable-font-mono)" }}
        >
          <span className="rounded-full border border-[var(--findable-primary)]/30 bg-[var(--findable-primary)]/10 px-2 py-0.5 text-[var(--findable-primary)]">
            {isKo ? "실측" : "Measured"}
          </span>
          <span>
            {isKo
              ? `인용 ${data.total}회 · ${data.measuredAt}`
              : `${data.total} citations · ${data.measuredAt}`}
          </span>
        </div>
      </div>

      {/* 도메인 막대 — 값이 큰 것 하나가 압도적이라 막대가 그 자체로 메시지가 된다 */}
      <div className="mt-7 space-y-3">
        {top.map((s) => {
          const kind = sourceKind(s.domain, s.owned);
          return (
            // 🔴 390px 실측(2026-08-16): 가로 1줄(라벨150+막대+숫자86+태그92)이면
            //   폭이 모자라 **막대가 0px 로 찌그러진다**(이 화면의 핵심이 사라진다).
            //   → 모바일은 2줄(위: 도메인+숫자 / 아래: 막대), PC 는 1줄.
            <div
              className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3"
              key={s.domain}
            >
              <div className="flex items-baseline justify-between gap-3 sm:contents">
                <span
                  className="truncate text-[12px] text-[var(--findable-ink)] sm:w-[190px] sm:shrink-0"
                  style={{ fontFamily: "var(--findable-font-mono)" }}
                >
                  {s.domain}
                </span>
                <span
                  className="shrink-0 text-[11px] text-[var(--findable-ink-tertiary)] sm:order-2 sm:w-[86px] sm:text-right"
                  style={{ fontFamily: "var(--findable-font-mono)" }}
                >
                  {s.count}
                  {isKo ? "회" : ""} · {Math.round(s.share)}%
                </span>
              </div>
              <span className="relative h-[10px] w-full overflow-hidden rounded-sm bg-[var(--findable-surface-2)] sm:order-1 sm:h-[18px] sm:flex-1">
                <span
                  className="absolute inset-y-0 left-0 rounded-sm"
                  style={{
                    width: `${(s.count / max) * 100}%`,
                    backgroundColor: s.owned
                      ? "var(--findable-ink-tertiary)"
                      : "var(--findable-primary)",
                    opacity: s.owned ? 0.5 : 0.75,
                  }}
                />
              </span>
              <span className="hidden text-[10px] text-[var(--findable-ink-subtle)] sm:order-3 sm:block sm:w-[92px] sm:shrink-0">
                {isKo ? kind.ko : kind.en}
              </span>
            </div>
          );
        })}
      </div>

      {/* 🔴 이 화면이 말하는 한 문장 */}
      <div className="mt-6 flex flex-col gap-2 border-[var(--findable-hairline)] border-t pt-4 text-[11px] sm:flex-row sm:items-center sm:justify-between">
        <p
          className="text-[var(--findable-ink-muted)]"
          style={{
            fontFamily: "var(--findable-font-sans)",
            wordBreak: "keep-all",
          }}
        >
          {/* 🔴 원본은 브랜드별 **상위 5개 도메인**이라 "전체 인용"이 아니다.
              "상위 인용 출처 중"이라고 범위를 정확히 쓴다 — 과장하면 이 화면의
              존재 이유(정직한 실측)가 무너진다. */}
          {isKo ? (
            <>
              상위 인용 출처 중 브랜드 공식 도메인은{" "}
              <strong className="text-[var(--findable-ink)]">
                {ownedShare < 1
                  ? ownedShare.toFixed(1)
                  : Math.round(ownedShare)}
                %
              </strong>{" "}
              — 내 사이트만 고쳐서는 AI 답변이 잘 바뀌지 않습니다.
            </>
          ) : (
            <>
              Among the top cited sources, owned domains are just{" "}
              <strong className="text-[var(--findable-ink)]">
                {ownedShare < 1
                  ? ownedShare.toFixed(1)
                  : Math.round(ownedShare)}
                %
              </strong>{" "}
              — fixing your own site alone rarely moves the answer.
            </>
          )}
        </p>
        <a
          className="shrink-0 text-[var(--findable-primary)] hover:underline"
          href={`${lp}/research/k-geo-bench-v0_1`}
          style={{ fontFamily: "var(--findable-font-sans)" }}
        >
          {isKo ? "데이터셋 보기 →" : "View the dataset →"}
        </a>
      </div>
    </div>
  );
};
