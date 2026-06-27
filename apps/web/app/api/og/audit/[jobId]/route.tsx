// /api/og/audit/[jobId] — 동적 OG 이미지 (1200x630, research 13 한국 첫 사례)
//
// 카톡/X 링크 미리보기에 점수가 자랑스럽게 노출되도록.
// next/og의 ImageResponse 사용 (Edge 가능하지만 Node로 두어 DB 접근 가능).

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
      sentimentDistribution: { positive: number; neutral: number; negative: number };
      averageMentionPosition: number | null;
      topCitedDomains: Array<{ domain: string; count: number }>;
    };
  } | null;
}

function tier(score: number): { label: string; color: string } {
  if (score >= 76) return { label: "리더", color: "#10B981" };
  if (score >= 51) return { label: "경쟁 가능", color: "#3B82F6" };
  if (score >= 26) return { label: "막 시작", color: "#F59E0B" };
  return { label: "AI에서 안 보임", color: "#EF4444" };
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
    if (res.ok) job = (await res.json()) as JobShape;
  } catch {
    // ignore — fallback OG below
  }

  const brand = job?.result?.brandName ?? job?.domain ?? "Findable";
  const domain = job?.domain ?? "";
  const sov = job?.result?.metrics.sov ?? 0;
  const t = tier(sov);
  const mentioned = job?.result?.metrics.enginesWithMention.length ?? 0;
  const total = job?.result?.metrics.enginesCovered.length ?? 0;

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
        <span style={{ color: "#ff7a4d" }}>FINDABLE — AI VISIBILITY</span>
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
            {sov}
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
            / 100 SHARE OF VOICE
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
