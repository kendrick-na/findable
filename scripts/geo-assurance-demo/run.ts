// 메디큐브 GEO Assurance 데모 실행기
//
// 목적: "AI 팩트 정합률(AI Fact Accuracy)" 실측 — Findable의 GEO Assurance 신규 기능 데모.
//   브랜드 정답표(ground truth) 10문항을 4개 글로벌 AI 엔진에 질의하고,
//   각 답변을 Claude LLM-judge로 정답과 대조해 일치/부분/불일치로 채점.
//   → 엔진별·전체 팩트 정합률 % 산출 + 틀린 답변(킬러 사례) 포착.
//
// ⚠️ 독립 실행 스크립트. 기존 audit 파이프라인/패키지를 건드리지 않는다(CLAUDE.md §3, §7.0).
//   기존 global-adapters.ts와 동일한 AI SDK v6 + AI Gateway 패턴만 재사용.
//
// 실행:
//   cd apps/web && AI_GATEWAY_API_KEY=... npx tsx ../../scripts/geo-assurance-demo/run.ts
//   (또는 .env.local 로드 후 실행)

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { generateText } from "ai";
import {
  type GroundTruthItem,
  MEDICUBE_BRAND,
  MEDICUBE_GROUND_TRUTH,
} from "./medicube-ground-truth";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── .env.local 수동 로드 (독립 스크립트라 next-forge env 로더 미사용) ──
function loadEnvLocal() {
  const candidates = [
    join(__dirname, "../../apps/web/.env.local"),
    join(__dirname, "../../.env.local"),
  ];
  for (const path of candidates) {
    try {
      const raw = readFileSync(path, "utf8");
      for (const line of raw.split("\n")) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
        if (!m) {
          continue;
        }
        const key = m[1];
        let val = m[2].trim();
        if (
          (val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))
        ) {
          val = val.slice(1, -1);
        }
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    } catch {
      /* 파일 없으면 skip */
    }
  }
}
loadEnvLocal();

// ── 질의 대상 엔진 (글로벌 4 — AI Gateway 통해 호출) ──
const ENGINES: { id: string; label: string; model: string }[] = [
  {
    id: "chatgpt",
    label: "ChatGPT",
    model: process.env.FINDABLE_MODEL_CHATGPT ?? "openai/gpt-5.4",
  },
  {
    id: "claude",
    label: "Claude",
    model: process.env.FINDABLE_MODEL_CLAUDE ?? "anthropic/claude-sonnet-4.6",
  },
  {
    id: "perplexity",
    label: "Perplexity",
    model: process.env.FINDABLE_MODEL_PERPLEXITY ?? "perplexity/sonar",
  },
  {
    id: "gemini",
    label: "Gemini",
    model: process.env.FINDABLE_MODEL_GEMINI ?? "google/gemini-2.5-flash",
  },
];

const JUDGE_MODEL =
  process.env.FINDABLE_MODEL_JUDGE ?? "anthropic/claude-sonnet-4.6";

type Verdict = "match" | "partial" | "mismatch" | "no_answer";

interface Scored {
  answer: string;
  engineId: string;
  engineLabel: string;
  fact: string;
  gtId: string;
  question: string;
  reason: string;
  verdict: Verdict;
}

function assertGateway() {
  if (!(process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN)) {
    throw new Error(
      "AI Gateway 인증 미설정. AI_GATEWAY_API_KEY 또는 VERCEL_OIDC_TOKEN 필요. (apps/web/.env.local 확인)"
    );
  }
}

// 1) 엔진에 질문 던지기 (global-adapters.ts와 동일 패턴)
async function askEngine(model: string, question: string): Promise<string> {
  const { text } = await generateText({
    model,
    system:
      "당신은 한국어 사용자를 위한 검색 어시스턴트입니다. 사실 기반으로 간결하게 답하세요. 모르면 모른다고 하세요.",
    prompt: question,
    providerOptions: { gateway: { tags: ["findable", "geo-assurance-demo"] } },
  });
  return text.trim();
}

// 2) Claude LLM-judge — 답변이 정답과 일치하는지 채점 (zod 미사용, JSON 파싱)
function parseVerdict(raw: string): { verdict: Verdict; reason: string } {
  // ```json ... ``` 또는 순수 JSON 모두 대응
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const obj = JSON.parse(jsonMatch[0]);
      const v = String(obj.verdict ?? "").toLowerCase();
      if (
        v === "match" ||
        v === "partial" ||
        v === "mismatch" ||
        v === "no_answer"
      ) {
        return { verdict: v as Verdict, reason: String(obj.reason ?? "") };
      }
    } catch {
      /* fallthrough */
    }
  }
  // 파싱 실패 시 키워드 fallback
  const low = raw.toLowerCase();
  if (low.includes("mismatch")) {
    return { verdict: "mismatch", reason: raw.slice(0, 120) };
  }
  if (low.includes("partial")) {
    return { verdict: "partial", reason: raw.slice(0, 120) };
  }
  if (low.includes("no_answer")) {
    return { verdict: "no_answer", reason: raw.slice(0, 120) };
  }
  if (low.includes("match")) {
    return { verdict: "match", reason: raw.slice(0, 120) };
  }
  return { verdict: "partial", reason: `판정 파싱 실패: ${raw.slice(0, 80)}` };
}

async function judge(
  item: GroundTruthItem,
  answer: string
): Promise<{ verdict: Verdict; reason: string }> {
  if (!answer || answer.length < 2) {
    return { verdict: "no_answer", reason: "빈 응답" };
  }
  const { text } = await generateText({
    model: JUDGE_MODEL,
    system:
      "당신은 엄격한 사실 검증관이다. AI 답변이 '정답(fact)'과 사실적으로 일치하는지 판정한다.\n" +
      "- match: 정답의 핵심 사실을 정확히 담음\n" +
      "- partial: 부분적으로 맞으나 핵심 일부 누락/모호\n" +
      "- mismatch: 정답과 다른 사실을 말함(틀림) 또는 다른 브랜드/회사로 혼동\n" +
      "- no_answer: 모른다고 하거나 답을 회피함\n" +
      "브랜드 표기 변형(메디큐브/Medicube)은 동일하게 취급. 관대하게 주지 말 것.\n" +
      '반드시 JSON만 출력: {"verdict":"match|partial|mismatch|no_answer","reason":"한국어 한 문장"}',
    prompt: `질문: ${item.question}\n\n정답(fact): ${item.fact}\n\nAI 답변: ${answer}\n\n위 AI 답변을 판정하라. JSON만 출력하라.`,
  });
  return parseVerdict(text.trim());
}

async function main() {
  assertGateway();
  console.log(
    `\n🔍 메디큐브 GEO Assurance 데모 — ${ENGINES.length}개 엔진 × ${MEDICUBE_GROUND_TRUTH.length}문항\n`
  );

  const results: Scored[] = [];

  for (const item of MEDICUBE_GROUND_TRUTH) {
    for (const eng of ENGINES) {
      try {
        const answer = await askEngine(eng.model, item.question);
        const { verdict, reason } = await judge(item, answer);
        results.push({
          engineId: eng.id,
          engineLabel: eng.label,
          gtId: item.id,
          question: item.question,
          fact: item.fact,
          answer,
          verdict,
          reason,
        });
        const icon = {
          match: "✅",
          partial: "🟡",
          mismatch: "❌",
          no_answer: "⬜",
        }[verdict];
        console.log(
          `${icon} [${eng.label}] ${item.id}: ${verdict} — ${reason.slice(0, 60)}`
        );
      } catch (err) {
        results.push({
          engineId: eng.id,
          engineLabel: eng.label,
          gtId: item.id,
          question: item.question,
          fact: item.fact,
          answer: "",
          verdict: "no_answer",
          reason: `오류: ${err instanceof Error ? err.message : String(err)}`,
        });
        console.log(`⚠️ [${eng.label}] ${item.id}: 오류`);
      }
    }
  }

  // ── 집계 ──
  const score = (v: Verdict) => (v === "match" ? 1 : v === "partial" ? 0.5 : 0);
  const total = results.length;
  const accuracy =
    Math.round(
      (results.reduce((s, r) => s + score(r.verdict), 0) / total) * 1000
    ) / 10;

  const byEngine: Record<
    string,
    {
      label: string;
      acc: number;
      match: number;
      partial: number;
      mismatch: number;
      no_answer: number;
    }
  > = {};
  for (const eng of ENGINES) {
    const rows = results.filter((r) => r.engineId === eng.id);
    const acc =
      Math.round(
        (rows.reduce((s, r) => s + score(r.verdict), 0) / rows.length) * 1000
      ) / 10;
    byEngine[eng.id] = {
      label: eng.label,
      acc,
      match: rows.filter((r) => r.verdict === "match").length,
      partial: rows.filter((r) => r.verdict === "partial").length,
      mismatch: rows.filter((r) => r.verdict === "mismatch").length,
      no_answer: rows.filter((r) => r.verdict === "no_answer").length,
    };
  }

  // 킬러 사례: 틀린 답변(mismatch)
  const killers = results.filter((r) => r.verdict === "mismatch");

  console.log(`\n${"=".repeat(50)}`);
  console.log(`📊 전체 AI 팩트 정합률: ${accuracy}%  (${total}개 응답)`);
  console.log(`${"=".repeat(50)}`);
  for (const eng of ENGINES) {
    const e = byEngine[eng.id];
    console.log(
      `  ${e.label.padEnd(12)} ${e.acc}%  (✅${e.match} 🟡${e.partial} ❌${e.mismatch} ⬜${e.no_answer})`
    );
  }
  console.log(`\n❌ 틀린 답변(킬러 사례): ${killers.length}건`);
  for (const k of killers) {
    console.log(
      `  - [${k.engineLabel}] ${k.question}\n    → AI: "${k.answer.slice(0, 100)}..."\n    → 정답: ${k.fact}`
    );
  }

  // ── 결과 저장 (JSON + 사람이 읽을 리포트) ──
  const out = {
    brand: MEDICUBE_BRAND.name,
    ranAt: new Date().toISOString(),
    engines: ENGINES.map((e) => ({ id: e.id, label: e.label, model: e.model })),
    overallAccuracy: accuracy,
    byEngine,
    killerCases: killers.map((k) => ({
      engine: k.engineLabel,
      question: k.question,
      answer: k.answer,
      fact: k.fact,
      reason: k.reason,
    })),
    rows: results,
  };
  const jsonPath = join(__dirname, "result.json");
  writeFileSync(jsonPath, JSON.stringify(out, null, 2), "utf8");
  console.log(`\n💾 저장: ${jsonPath}`);
}

main().catch((e) => {
  console.error("데모 실행 실패:", e);
  process.exit(1);
});
