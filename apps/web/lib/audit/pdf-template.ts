// 무료 Audit 1페이지 PDF의 HTML 템플릿
// Pretendard CDN 폰트 사용. Puppeteer가 페이지 로드 후 PDF로 변환.

import type { AuditMetrics, EngineId } from "@repo/ai/lib/engines";

export interface AuditPdfData {
  brandName: string;
  domain: string;
  language: "ko" | "en" | "both";
  promptsCount: number;
  engineResponses: Array<{
    engineId: string;
    brandMentioned: boolean;
    mentionPosition: number | null;
    sentiment: "positive" | "neutral" | "negative" | null;
    sov: number | null;
    durationMs: number;
    isStub: boolean;
    errorMessage: string | null;
    excerpt: string;
  }>;
  metrics: AuditMetrics;
  topRecommendations: string[];
  generatedAt: string;
}

const ENGINE_LABELS: Record<string, string> = {
  chatgpt: "ChatGPT",
  "chatgpt-web": "ChatGPT (Web)",
  claude: "Claude",
  perplexity: "Perplexity",
  gemini: "Gemini",
  hyperclova: "HyperCLOVA X",
  naver: "Naver",
  daum: "Daum",
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function sentimentBadge(sentiment: string | null): string {
  if (sentiment === "positive") return `<span class="badge badge-positive">긍정</span>`;
  if (sentiment === "negative") return `<span class="badge badge-negative">부정</span>`;
  if (sentiment === "neutral") return `<span class="badge badge-neutral">중립</span>`;
  return `<span class="badge badge-muted">N/A</span>`;
}

function mentionBadge(mentioned: boolean, position: number | null, isStub: boolean): string {
  if (isStub) return `<span class="badge badge-muted">미설정</span>`;
  if (!mentioned) return `<span class="badge badge-negative">미언급</span>`;
  if (position) return `<span class="badge badge-positive">${position}위</span>`;
  return `<span class="badge badge-positive">언급</span>`;
}

export function renderAuditPdfHtml(data: AuditPdfData): string {
  const sov = data.metrics.sov;
  const mentionRate = data.metrics.enginesCovered.length === 0
    ? 0
    : Math.round((data.metrics.enginesWithMention.length / data.metrics.enginesCovered.length) * 100);

  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<title>Findable AI 가시성 진단 리포트 — ${escapeHtml(data.brandName)}</title>
<link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin />
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.css" />
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { font-family: 'Pretendard', -apple-system, BlinkMacSystemFont, system-ui, sans-serif; color: #0a0a0a; }
  @page { size: A4; margin: 0; }
  body { width: 210mm; min-height: 297mm; padding: 14mm 14mm 12mm; font-size: 10.5pt; line-height: 1.5; }

  .header { display: flex; justify-content: space-between; align-items: flex-end; padding-bottom: 10px; border-bottom: 2px solid #0a0a0a; }
  .brand { font-size: 11pt; font-weight: 700; letter-spacing: -0.02em; }
  .brand .product { color: #6366f1; }
  .meta { font-size: 8pt; color: #6b7280; text-align: right; line-height: 1.4; }

  .title { margin-top: 14px; font-size: 16pt; font-weight: 800; letter-spacing: -0.03em; }
  .subtitle { margin-top: 4px; font-size: 9.5pt; color: #4b5563; }

  .scorecard { margin-top: 14px; display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
  .card { padding: 10px 12px; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; }
  .card .label { font-size: 8pt; color: #6b7280; text-transform: uppercase; letter-spacing: 0.04em; }
  .card .value { margin-top: 4px; font-size: 18pt; font-weight: 800; letter-spacing: -0.02em; }
  .card .unit { font-size: 9pt; font-weight: 500; color: #6b7280; margin-left: 2px; }
  .card.primary { background: #eef2ff; border-color: #c7d2fe; }
  .card.primary .value { color: #4338ca; }

  .section { margin-top: 16px; }
  .section h2 { font-size: 11pt; font-weight: 700; padding-bottom: 4px; border-bottom: 1px solid #e5e7eb; margin-bottom: 8px; letter-spacing: -0.02em; }

  table { width: 100%; border-collapse: collapse; font-size: 9pt; }
  th, td { padding: 6px 8px; text-align: left; border-bottom: 1px solid #f3f4f6; }
  th { background: #f9fafb; font-weight: 600; color: #4b5563; font-size: 8.5pt; text-transform: uppercase; letter-spacing: 0.03em; }
  td.center { text-align: center; }
  td.engine { font-weight: 600; }
  td.excerpt { color: #6b7280; font-size: 8.5pt; }

  .badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 8pt; font-weight: 600; line-height: 1.4; }
  .badge-positive { background: #dcfce7; color: #166534; }
  .badge-negative { background: #fee2e2; color: #991b1b; }
  .badge-neutral { background: #fef3c7; color: #92400e; }
  .badge-muted { background: #f3f4f6; color: #6b7280; }

  .recs { display: grid; gap: 6px; }
  .rec { padding: 8px 10px; background: #fafafa; border-left: 3px solid #6366f1; border-radius: 4px; font-size: 9.5pt; line-height: 1.5; }
  .rec-num { display: inline-block; width: 18px; height: 18px; line-height: 18px; text-align: center; font-size: 8.5pt; font-weight: 700; color: #fff; background: #6366f1; border-radius: 999px; margin-right: 6px; }

  .footer { position: fixed; bottom: 8mm; left: 14mm; right: 14mm; display: flex; justify-content: space-between; font-size: 7.5pt; color: #9ca3af; border-top: 1px solid #f3f4f6; padding-top: 6px; }
  .footer a { color: #6366f1; text-decoration: none; }

  .stub-warning { margin-top: 8px; padding: 8px 10px; background: #fef3c7; border-radius: 4px; font-size: 8.5pt; color: #92400e; }

  .why-findable { page-break-before: always; margin-top: 24px; }
  .why-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; margin-top: 8px; }
  .why-col { padding: 10px 12px; background: #fafafa; border-radius: 6px; border-top: 2px solid #6366f1; }
  .why-label { font-size: 8pt; font-weight: 700; color: #6366f1; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 6px; }
  .why-list { margin: 0; padding: 0 0 0 14px; font-size: 8.5pt; line-height: 1.5; color: #374151; }
  .why-list li { margin-bottom: 4px; }
</style>
</head>
<body>
<div class="header">
  <div class="brand">
    <span class="product">Findable</span> · 한국 최초 Agentic GEO Platform
  </div>
  <div class="meta">
    Generated ${escapeHtml(data.generatedAt)}<br/>
    findable.co.kr
  </div>
</div>

<h1 class="title">${escapeHtml(data.brandName)}의 AI 가시성 진단 (${escapeHtml(data.domain)})</h1>
<p class="subtitle">${data.promptsCount}개 프롬프트 × ${data.metrics.enginesCovered.length}개 AI 엔진 = ${data.metrics.enginesCovered.length * data.promptsCount}회 호출 분석</p>

<div class="scorecard">
  <div class="card primary">
    <div class="label">Share of Voice</div>
    <div class="value">${sov}<span class="unit">/100</span></div>
  </div>
  <div class="card">
    <div class="label">언급 엔진</div>
    <div class="value">${data.metrics.enginesWithMention.length}<span class="unit">/${data.metrics.enginesCovered.length}</span></div>
  </div>
  <div class="card">
    <div class="label">평균 인용 순위</div>
    <div class="value">${data.metrics.averageMentionPosition ? `${data.metrics.averageMentionPosition}위` : "N/A"}</div>
  </div>
  <div class="card">
    <div class="label">Sentiment</div>
    <div class="value" style="font-size:13pt">
      ${data.metrics.sentimentDistribution.positive}<span class="unit" style="color:#166534">긍</span>
      ${data.metrics.sentimentDistribution.neutral}<span class="unit" style="color:#92400e">중</span>
      ${data.metrics.sentimentDistribution.negative}<span class="unit" style="color:#991b1b">부</span>
    </div>
  </div>
</div>

${data.metrics.stubCount > 0 ? `
<div class="stub-warning">
  ⚠ ${data.metrics.stubCount}개 엔진이 stub 모드로 실행됐습니다. (API 키 미설정) 정식 측정을 위해 환경변수 설정이 필요합니다.
</div>` : ""}

<div class="section">
  <h2>엔진별 응답 요약</h2>
  <table>
    <thead>
      <tr>
        <th>엔진</th>
        <th class="center">언급</th>
        <th class="center">Sentiment</th>
        <th class="center">SoV</th>
        <th>응답 발췌</th>
      </tr>
    </thead>
    <tbody>
      ${dedupeByEngine(data.engineResponses).map((r) => `
        <tr>
          <td class="engine">${escapeHtml(ENGINE_LABELS[r.engineId] ?? r.engineId)}</td>
          <td class="center">${mentionBadge(r.brandMentioned, r.mentionPosition, r.isStub)}</td>
          <td class="center">${sentimentBadge(r.sentiment)}</td>
          <td class="center">${r.sov !== null ? `${Math.round(r.sov * 100)}%` : "—"}</td>
          <td class="excerpt">${escapeHtml(truncate(r.excerpt, 120))}</td>
        </tr>
      `).join("")}
    </tbody>
  </table>
</div>

<div class="section">
  <h2>Top 3 개선 추천 (Princeton GEO 알고리즘 기반)</h2>
  <div class="recs">
    ${data.topRecommendations.map((rec, i) => `
      <div class="rec"><span class="rec-num">${i + 1}</span>${escapeHtml(rec)}</div>
    `).join("")}
  </div>
</div>

${data.metrics.topCitedDomains.length > 0 ? `
<div class="section">
  <h2>주요 인용 출처 도메인</h2>
  <table>
    <thead>
      <tr>
        <th>도메인</th>
        <th class="center" style="width:80px">인용 횟수</th>
      </tr>
    </thead>
    <tbody>
      ${data.metrics.topCitedDomains.map((d) => `
        <tr>
          <td>${escapeHtml(d.domain)}</td>
          <td class="center">${d.count}</td>
        </tr>
      `).join("")}
    </tbody>
  </table>
</div>` : ""}

<div class="section why-findable">
  <h2>Why Findable</h2>
  <div class="why-grid">
    <div class="why-col">
      <div class="why-label">Why Now</div>
      <ul class="why-list">
        <li>2024.11 ChatGPT Search 출시 — 검색의 정의가 답변으로 바뀜</li>
        <li>2026.02 Profound, $96M Series C / $1B 유니콘 (Lightspeed)</li>
        <li>GEO 시장 CAGR 45.5%, $1.48B(2026) → $17.02B(2034)</li>
      </ul>
    </div>
    <div class="why-col">
      <div class="why-label">Why Findable</div>
      <ul class="why-list">
        <li>한국 AI 엔진 독점 추적 — HyperCLOVA X · Naver · Daum 직접 통합</li>
        <li>Korean Entity Grounding — 한국어 표기 변형 통합 추적 (Ahrefs 한국어판)</li>
        <li>Princeton KDD'24 GEO + ICLR'26 AutoGEO 알고리즘 한국어 적용</li>
      </ul>
    </div>
    <div class="why-col">
      <div class="why-label">Why Now (Team)</div>
      <ul class="why-list">
        <li>인디고차일드 — 6년 K-콘텐츠·IP 마케팅 (서울시 · 남양주시 · 워터밤)</li>
        <li>2024 노동부 생성형 AI 활용 경진대회 최우수상</li>
        <li>대표 나현덕 — 동국대 핀테크블록체인학과 대학원생</li>
      </ul>
    </div>
  </div>
</div>

<div class="footer">
  <span>Findable · 한국어·영어 AI 답변 가시성 추적 플랫폼</span>
  <span><a href="https://findable.co.kr">findable.co.kr</a> · 무료 진단 무제한</span>
</div>
</body>
</html>`;
}

function truncate(s: string, max: number): string {
  if (!s) return "";
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…`;
}

// 엔진별 첫 응답만 표에 표시 (1프롬프트만 대표). 여러 프롬프트는 행이 쌓여 1페이지를 넘김.
function dedupeByEngine<T extends { engineId: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const r of rows) {
    if (seen.has(r.engineId)) continue;
    seen.add(r.engineId);
    result.push(r);
  }
  return result;
}

// EngineId 사용 — 컴파일러 의존성 유지용 (안 쓰면 import 제거됨)
const _typeAnchor: EngineId = "chatgpt";
void _typeAnchor;
