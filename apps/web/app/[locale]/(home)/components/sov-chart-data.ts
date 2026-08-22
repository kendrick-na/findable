// 홈 SoV 차트 실측 데이터 — 공개 데이터셋 k-geo-bench v0.1
//
// 🔴 2026-08-16 — 이 파일이 생긴 이유:
//   sov-chart 는 `seedRandom()` 난수로 점 분포를 그리면서 `Last 30 days`·실존 도메인·
//   `n ≈ 200 responses` 를 붙여 **측정한 것처럼** 보이게 했다. 날조를 세 번에 걸쳐
//   걷어냈지만(b73ca5a·6760b01·0fdc25d) 데이터가 가짜인 한 구멍은 계속 생긴다.
//   → **데이터 자체를 진짜로 바꾼다.**
//
// 원본: `apps/web/public/data/k-geo-bench-v0_1.jsonl` (5사 · 7엔진 · 브랜드당 4프롬프트)
//   `/report`·`/research` 가 쓰는 것과 **같은 파일**이다(숫자 두 벌 금지 규칙).
//
// ⚠️ 이 데이터의 한계는 숨기지 않고 화면에 적는다:
//   ①2026-05 시점 ②측정한 5사가 전부 K-뷰티(우리가 그때 돌린 게 그것뿐이다.
//     Findable 자체는 업종 제한이 없다 — runner.ts:95 프롬프트가 업종 무관)
//   ③naver 는 5사 중 3사만 유효(나머지는 stub) — 표본 수를 라벨에 같이 쓴다

import { readFileSync } from "node:fs";
import { join } from "node:path";

interface EngineRun {
  is_stub?: boolean;
  mention: boolean;
  position: number | null;
  sentiment: string;
  sov: number | null;
}

interface BenchRow {
  brand_name: string;
  engine_summary: Record<string, EngineRun[]>;
  measured_at: string;
  metrics: {
    top_cited_domains: { domain: string; count: number }[];
  };
}

export interface EngineStat {
  /** 브랜드 평균 SoV (%) */
  avg: number;
  /** 데이터셋 키 (chatgpt · naver …) */
  id: string;
  /** 한국 엔진인가 — 차트에서 색을 가른다 */
  korean: boolean;
  /** 화면 표기명 */
  label: string;
  /** 브랜드별 값 — 점 분포로 그린다(난수가 아니라 실제 5개 점) */
  points: number[];
}

const ENGINE_META: { id: string; label: string; korean: boolean }[] = [
  { id: "chatgpt", label: "ChatGPT", korean: false },
  { id: "claude", label: "Claude", korean: false },
  { id: "perplexity", label: "Perplexity", korean: false },
  { id: "gemini", label: "Gemini", korean: false },
  { id: "hyperclova", label: "HyperCLOVA", korean: true },
  { id: "naver", label: "네이버", korean: true },
  { id: "daum", label: "다음", korean: true },
];

/** stub(실측 아님)과 sov=null 을 걷어낸 뒤 평균. 유효 실행이 없으면 null */
function averageSov(runs: EngineRun[] | undefined): number | null {
  if (!runs) {
    return null;
  }
  const real = runs.filter((r) => !r.is_stub && r.sov !== null);
  if (real.length === 0) {
    return null;
  }
  return (real.reduce((s, r) => s + (r.sov ?? 0), 0) / real.length) * 100;
}

export interface SoVChartData {
  brandCount: number;
  engines: EngineStat[];
  measuredAt: string;
}

export interface CitedSource {
  count: number;
  domain: string;
  /** 브랜드가 직접 운영하는 도메인인가 */
  owned: boolean;
  /** 전체 인용 중 비중(%) */
  share: number;
}

export interface CitationData {
  brandCount: number;
  measuredAt: string;
  /** 브랜드 공식 도메인이 인용된 횟수 */
  ownedCount: number;
  sources: CitedSource[];
  total: number;
}

/** 브랜드가 직접 운영하는 도메인 판별 — 측정 대상 5사의 자사몰 */
const OWNED_HINTS = ["medicube", "roundlab", "anua", "dalba", "beautyofjoseon"];

function isOwned(domain: string): boolean {
  return OWNED_HINTS.some((h) => domain.includes(h));
}

/**
 * AI 가 브랜드를 말할 때 **무엇을 근거로 삼았나**.
 *
 * 🔴 이게 우리 차별점의 실측 증거다. 글로벌 GEO 도구는 이 축을 안 잰다
 *    (경쟁사 4곳 랜딩 fetch 결과 naver·hyperclova·daum 언급 0건).
 *
 * ⚠️ **한계 — 화면 문구가 이걸 지켜야 한다.**
 *    원본 `top_cited_domains` 는 **브랜드별 상위 5개**만 담는다(전체 인용 목록이 아니다).
 *    따라서 여기서 나온 비율은 "전체 인용 중"이 아니라 **"상위 인용 출처 중"** 이다.
 *    ⛔ 화면에 "전체 인용의 N%" 라고 쓰지 말 것.
 */
export function loadCitationData(): CitationData {
  const rows = readBench();
  const agg = new Map<string, number>();
  for (const row of rows) {
    for (const d of row.metrics.top_cited_domains) {
      agg.set(d.domain, (agg.get(d.domain) ?? 0) + d.count);
    }
  }
  const total = [...agg.values()].reduce((s, v) => s + v, 0);
  const sources: CitedSource[] = [...agg.entries()]
    .map(([domain, count]) => ({
      domain,
      count,
      share: total ? (count / total) * 100 : 0,
      owned: isOwned(domain),
    }))
    .sort((a, b) => b.count - a.count);

  return {
    sources,
    total,
    ownedCount: sources.filter((s) => s.owned).reduce((s, x) => s + x.count, 0),
    brandCount: rows.length,
    measuredAt: latestMonth(rows),
  };
}

/**
 * 데이터셋의 **측정 응답 수**(5사 × 7엔진 × 4프롬프트 = 140).
 * `/research` 페이지가 쓰는 값과 같아야 하므로 원본에서 센다(하드코딩 금지).
 */
export function loadDatasetResponseCount(): number {
  return readBench().reduce(
    (sum, row) =>
      sum +
      Object.values(row.engine_summary).reduce((s, runs) => s + runs.length, 0),
    0
  );
}

/** JSONL 원본 읽기 — 두 로더가 같은 경로를 쓴다(수치 두 벌 금지) */
function readBench(): BenchRow[] {
  const file = join(process.cwd(), "public", "data", "k-geo-bench-v0_1.jsonl");
  return readFileSync(file, "utf-8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as BenchRow);
}

/** 데이터셋에서 가장 늦은 측정월(YYYY-MM) */
function latestMonth(rows: BenchRow[]): string {
  return rows
    .map((r) => r.measured_at.slice(0, 7))
    .sort()
    .at(-1) as string;
}

export function loadSoVChartData(): SoVChartData {
  const rows = readBench();

  const engines: EngineStat[] = ENGINE_META.map((meta) => {
    const points = rows
      .map((r) => averageSov(r.engine_summary[meta.id]))
      .filter((v): v is number => v !== null);
    const avg =
      points.length > 0 ? points.reduce((s, v) => s + v, 0) / points.length : 0;
    return { ...meta, avg, points };
  });

  return {
    engines,
    brandCount: rows.length,
    measuredAt: latestMonth(rows),
  };
}
