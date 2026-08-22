export interface ContentQualityResult {
  checks: {
    bodyLength: boolean;
    evidencePresent: boolean;
    evidenceSpecific: boolean;
    headingStructure: boolean;
    keywordRepetition: boolean;
    linkCount: boolean;
    originality: boolean;
    claimSafety: boolean;
    sourcePresent: boolean;
  };
  status: "passed" | "warning" | "failed";
  summary: string;
}

const LINK_RE = /\[[^\]]+\]\([^)]+\)|https?:\/\/\S+/g;
const HEADING_RE = /^##\s+\S+/m;
const NUMBER_RE = /\d+(?:[.,]\d+)?%?|측정|measurement/i;
const SOURCE_RE = /출처|근거|source|evidence|according to/i;
const UNSAFE_PLACEHOLDER_RE =
  /업계 조사에 따르면.{0,40}(?:도입률|성장률|점유율).{0,20}\d+%|industry research.{0,60}\d+%/i;
const NON_WORD_RE = /[^\p{L}\p{N}\s]/gu;
const WHITESPACE_RE = /\s+/;
const SENTENCE_BOUNDARY_RE = /[.!?。！？]\s*/;

function hasKeywordStuffing(title: string, body: string): boolean {
  const terms = title
    .toLowerCase()
    .replace(NON_WORD_RE, " ")
    .split(WHITESPACE_RE)
    .filter((term) => term.length >= 3);
  if (terms.length === 0) {
    return false;
  }
  const normalized = body.toLowerCase();
  const words = Math.max(1, normalized.split(WHITESPACE_RE).length);
  return terms.some((term) => {
    const count = normalized.split(term).length - 1;
    return count >= 12 && count / words > 0.035;
  });
}

function hasMeaningfulEvidence(value: unknown): boolean {
  if (typeof value === "string") {
    return value.trim().length >= 4;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return true;
  }
  if (Array.isArray(value)) {
    return value.some(hasMeaningfulEvidence);
  }
  if (value && typeof value === "object") {
    return Object.values(value).some(hasMeaningfulEvidence);
  }
  return false;
}

function hasRepeatedFiller(body: string): boolean {
  const sentences = body
    .replace(/^#+\s+/gm, "")
    .split(SENTENCE_BOUNDARY_RE)
    .map((sentence) => sentence.replace(WHITESPACE_RE, " ").trim())
    .filter((sentence) => sentence.length >= 20);
  const counts = new Map<string, number>();
  for (const sentence of sentences) {
    const normalized = sentence.toLowerCase();
    const count = (counts.get(normalized) ?? 0) + 1;
    if (count >= 3) {
      return true;
    }
    counts.set(normalized, count);
  }
  return false;
}

export function checkContentQuality(input: {
  bodyMarkdown: string;
  sourceEvidence?: unknown;
  title: string;
}): ContentQualityResult {
  const body = input.bodyMarkdown.trim();
  const evidenceSpecific = hasMeaningfulEvidence(input.sourceEvidence);
  const checks = {
    bodyLength: body.length >= 700,
    evidencePresent:
      NUMBER_RE.test(body) &&
      input.sourceEvidence !== null &&
      input.sourceEvidence !== undefined,
    evidenceSpecific,
    headingStructure: HEADING_RE.test(body),
    keywordRepetition: !hasKeywordStuffing(input.title, body),
    linkCount: (body.match(LINK_RE) ?? []).length <= 30,
    originality: !hasRepeatedFiller(body),
    claimSafety: !UNSAFE_PLACEHOLDER_RE.test(body),
    sourcePresent: SOURCE_RE.test(body),
  };
  const failures = Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);
  const critical = [
    "bodyLength",
    "evidencePresent",
    "evidenceSpecific",
    "keywordRepetition",
    "originality",
    "claimSafety",
  ].some((name) => failures.includes(name));
  let status: ContentQualityResult["status"] = "passed";
  if (critical) {
    status = "failed";
  } else if (failures.length > 0) {
    status = "warning";
  }
  return {
    checks,
    status,
    summary:
      failures.length === 0
        ? "근거·구조·반복·링크 검사를 통과했습니다."
        : `보완이 필요한 항목: ${failures.join(", ")}`,
  };
}
