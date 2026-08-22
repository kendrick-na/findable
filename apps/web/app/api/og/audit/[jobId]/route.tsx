// /api/og/audit/[jobId] — 동적 OG 이미지 (1200x630, research 13 한국 첫 사례)
//
// 카톡/X 링크 미리보기에 점수가 자랑스럽게 노출되도록.
// next/og의 ImageResponse 사용 (Edge 가능하지만 Node로 두어 DB 접근 가능).

import {
  geoAxisScores,
  type ScoreTier,
  scoreTier,
  TIER_LABEL_KO,
  uniqueEngineCount,
} from "@repo/audit/geo-score";
// 🔴 세션N-28 — 분모는 `countMeasurementCoverage` 단일 진실을 쓴다.
//   종전엔 `measuredEngineCount`(= 고유엔진 − 오류엔진)를 썼는데 그 규칙이 결과 화면의
//   「7/6·117%」 버그와 **같은 원인**이다(1회라도 실패한 엔진을 통째로 제외).
import { countMeasurementCoverage } from "@repo/audit/measurement-coverage";
import { ImageResponse } from "next/og";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface JobShape {
  domain: string;
  result: {
    brandName: string;
    metrics: {
      sov: number;
      enginesCovered: string[];
      enginesWithMention: string[];
      sentimentDistribution: {
        positive: number;
        neutral: number;
        negative: number;
      };
      averageMentionPosition: number | null;
      topCitedDomains: Array<{ domain: string; count: number }>;
      errors?: Array<{ engineId: string; message: string }>;
    };
    /** 🔴 분모 계산용(세션N-28). `metrics.enginesCovered` 는 **시도 단위**라
     *  거기서는 "어느 응답이 성공했나"를 알 수 없다 — 실측: perplexity 가 5회 시도 중
     *  3회만 성공했는데 enginesCovered 에는 5회 전부 들어 있다.
     *  → 응답별 성공/실패는 이 배열에만 있다. `/api/audit/<id>` 가 이미 내려준다. */
    engineResponses?: Array<{
      engineId: string;
      errorMessage?: string | null;
      isStub?: boolean;
    }>;
  } | null;
}

// 감사 10번(2026-08-07 세션N-8): 임계값 76/51/26을 여기서 복제하지 않는다.
//   `@repo/audit/geo-score`가 단일 진실 — 하나만 바꿔 화면·메일과 어긋나던 구조 제거.
//   (같은 계열 사고가 이미 한 번 이 OG 이미지를 깨뜨린 전례가 있다 — 결함감사 §OG)
//   색은 OG 이미지 전용이라 여기 남긴다(등급→색 매핑은 이 파일의 표현 관심사).
const TIER_COLOR: Record<ScoreTier, string> = {
  leader: "#10B981",
  competitive: "#3B82F6",
  emerging: "#F59E0B",
  critical: "#EF4444",
};

function tier(score: number): { label: string; color: string } {
  const t = scoreTier(score);
  return { label: TIER_LABEL_KO[t], color: TIER_COLOR[t] };
}

export async function GET(
  request: Request,
  context: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await context.params;

  // 같은 origin에서 데이터 fetch
  const url = new URL(request.url);
  const apiUrl = `${url.origin}/api/audit/${jobId}`;
  let job: JobShape | null = null;
  try {
    const res = await fetch(apiUrl, { cache: "no-store" });
    if (res.ok) {
      job = (await res.json()) as JobShape;
    }
  } catch {
    // ignore — fallback OG below
  }

  const brand = job?.result?.brandName ?? job?.domain ?? "Findable";
  const domain = job?.domain ?? "";
  // 결함감사(2026-07-30) §OG: 이전엔 SoV를 점수 자리에 그대로 노출해 결과 페이지의
  // GEO 점수(5축 합계)와 다른 숫자가 공유 이미지에 나갔음 → geo-score 단일 진실로 통일.
  const metrics = job?.result?.metrics;
  const score = metrics ? geoAxisScores(metrics).total : 0;
  const t = tier(score);
  // P1-g(2026-07-27): metrics 배열은 응답 단위(엔진×프롬프트=중복)라 고유화 필수.
  // 분모는 측정 성공 엔진(오류 제외) — 결과 페이지 언급률과 동일 기준.
  const mentioned = uniqueEngineCount(metrics?.enginesWithMention ?? []);
  // 🔴 세션N-28: 결과 화면과 **같은 함수**로 분모를 구한다(종전 `measuredEngineCount` 는
  //   1회라도 실패한 엔진을 통째로 빼서 「7/6」 같은 값을 만들었다).
  //   engineResponses 가 없는 옛 회차는 고유 엔진 수로 폴백한다(분자보다 작아지지 않게).
  const total = job?.result?.engineResponses
    ? countMeasurementCoverage(job.result.engineResponses).measured
    : uniqueEngineCount(metrics?.enginesCovered ?? []);

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background:
          "linear-gradient(135deg, #0a0a0a 0%, #1a0a2e 50%, #0a0a0a 100%)",
        padding: 80,
        position: "relative",
      }}
    >
      {/* 글로우 */}
      <div
        style={{
          position: "absolute",
          top: -200,
          right: -200,
          width: 600,
          height: 600,
          borderRadius: 9999,
          background: t.color,
          opacity: 0.18,
          filter: "blur(80px)",
          display: "flex",
        }}
      />

      {/* 상단 — 도메인 + 라벨 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontSize: 22,
          color: "#a1a1aa",
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          fontFamily: "monospace",
        }}
      >
        <span>{domain}</span>
        <span style={{ color: "#ff7a4d" }}>FINDABLE · AI VISIBILITY</span>
      </div>

      {/* 본문 — 점수 거대 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 60,
          marginTop: 40,
          flex: 1,
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
          }}
        >
          <div
            style={{
              fontSize: 280,
              fontWeight: 800,
              color: t.color,
              lineHeight: 1,
              letterSpacing: "-0.04em",
              display: "flex",
            }}
          >
            {score}
          </div>
          <div
            style={{
              fontSize: 22,
              color: "#71717a",
              letterSpacing: "0.2em",
              textTransform: "uppercase",
              marginTop: 12,
              display: "flex",
              fontFamily: "monospace",
            }}
          >
            / 100 GEO SCORE
          </div>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            paddingLeft: 60,
            borderLeft: "1px solid rgba(255,255,255,0.1)",
          }}
        >
          <div
            style={{
              fontSize: 36,
              color: "#fafafa",
              fontWeight: 600,
              lineHeight: 1.15,
              letterSpacing: "-0.02em",
              display: "flex",
            }}
          >
            {brand}
          </div>
          <div
            style={{
              fontSize: 28,
              color: t.color,
              marginTop: 16,
              fontWeight: 600,
              display: "flex",
            }}
          >
            {t.label}
          </div>
          <div
            style={{
              fontSize: 22,
              color: "#a1a1aa",
              marginTop: 24,
              lineHeight: 1.5,
              display: "flex",
            }}
          >
            AI 엔진 {total}곳 중 {mentioned}곳에서 언급
          </div>
        </div>
      </div>

      {/* 하단 CTA */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontSize: 22,
          color: "#71717a",
          paddingTop: 24,
          borderTop: "1px solid rgba(255,255,255,0.08)",
        }}
      >
        <span>findable.co.kr</span>
        <span style={{ color: "#ff7a4d" }}>내 점수 측정 →</span>
      </div>
    </div>,
    {
      width: 1200,
      height: 630,
    }
  );
}
