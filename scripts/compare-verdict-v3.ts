// Read-only operator tool (2026-10-05). 저장된 측정 1회차를 판정 v3 로 **다시 판정만** 해서
// v2(저장값)와 나란히 보여 준다. 엔진에 다시 묻지 않는다 — 판정기(LLM) 호출만 한다.
// 운영 전환(버전 2→3) 전에 차이를 사람이 검토하는 재료다. 설계: docs/_적용/측정알고리즘_v3_설계안_20261005.md
//
// 사용:
//   NODE_PATH=packages/audit/node_modules npx tsx scripts/compare-verdict-v3.ts <saved-audit.json> [--rules-only] [--refresh-identity]
//   (packages/ai 는 @repo/observability 를 직접 의존하지 않아 NODE_PATH 로 audit 쪽 해석을 빌린다)
//   · <saved-audit.json> = AuditJob 행 또는 그 result(JSON). DB 에 직접 붙지 않는다.
//   · --rules-only        판정기 호출 없이 규칙(되물음·동명 도메인)만 — 비용 0
//   · --refresh-identity  공식 홈페이지를 한 번 읽어 상호(법인명)를 채운다(과거 회차엔 없음)
// 판정기 키는 실행하는 프로세스의 환경변수에서 읽는다(이 파일에 없음).
import { readFileSync } from "node:fs";
import { detectBrandMention } from "../packages/ai/lib/engines/utils";
import {
  detectAmbiguity,
  hasRivalDomain,
  verifyMentionV3,
} from "../packages/ai/lib/mention-verdict-v3";
import { resolveOfficialSiteIdentity } from "../packages/audit/official-site-identity";

const args = process.argv.slice(2);
const inputPath = args.find((arg) => !arg.startsWith("--"));
if (!inputPath) {
  throw new Error(
    "Usage: compare-verdict-v3 <saved-audit.json> [--rules-only] [--refresh-identity]"
  );
}
const rulesOnly = args.includes("--rules-only");
const snapshot = JSON.parse(readFileSync(inputPath, "utf8"));
const result = snapshot.result ?? snapshot;
const brandName: string = result.brandName;
const domain: string = result.domain;
const brandVariants: string[] = result.brandVariants ?? [];
let officialSite = result.measurementContext?.officialSiteIdentity ?? null;
if (args.includes("--refresh-identity")) {
  const fresh = await resolveOfficialSiteIdentity(domain);
  officialSite = { ...(officialSite ?? {}), ...(fresh ?? {}) };
}
if (!(brandName && domain && Array.isArray(result.engineResponses))) {
  throw new Error("Snapshot must include brandName, domain, engineResponses");
}

interface Row {
  citedSources?: Array<{ domain?: string; url?: string }>;
  engineId: string;
  errorMessage?: string | null;
  isStub?: boolean;
  mentionQuality?: string;
  promptText?: string;
  rawResponse?: string;
}

const out: Record<string, string>[] = [];
for (const row of result.engineResponses as Row[]) {
  if (row.errorMessage || row.isStub || !row.rawResponse) {
    continue;
  }
  const input = {
    brandName,
    brandVariants,
    brandDomain: domain,
    citedDomains: (row.citedSources ?? [])
      .map((source) => source.domain ?? source.url ?? "")
      .filter(Boolean),
    officialSite,
    text: row.rawResponse,
    stringMatched: detectBrandMention(row.rawResponse, brandName, brandVariants)
      .mentioned,
  };
  let v3: string;
  let reason = "";
  let evidence = "";
  if (rulesOnly) {
    if (!input.stringMatched) {
      v3 = "absent";
    } else if (detectAmbiguity(input.text)) {
      v3 = "ambiguous";
      reason = "clarification";
    } else if (hasRivalDomain(input)) {
      v3 = "different_entity";
      reason = "rival_domain";
    } else {
      v3 = "(needs judge)";
    }
  } else {
    const verdict = await verifyMentionV3(input);
    v3 = verdict.quality;
    reason = verdict.reason ?? "";
    evidence = verdict.evidence ?? "";
  }
  out.push({
    engine: row.engineId,
    prompt: (row.promptText ?? "").slice(0, 40),
    v2: row.mentionQuality ?? "",
    v3,
    changed:
      v3 === "(needs judge)" || (row.mentionQuality ?? "") === v3 ? "" : "◀",
    reason,
    evidence: evidence.slice(0, 80),
  });
}
console.table(out);
const changed = out.filter((row) => row.changed).length;
console.log(
  `rows=${out.length} changed=${changed} legalName=${officialSite?.legalName ?? "(none)"}`
);
