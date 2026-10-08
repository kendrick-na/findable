/**
 * 영업 리드 — 측정 스냅샷을 읽어 「초안을 만들어도 되는가」를 판정하고,
 * 측정 숫자만으로 협업 제안 메일 초안을 조립한다.
 *
 * 원칙 (대표 지시 2026-09-29 · 템플릿 2026-10-06)
 * - 메일에 들어가는 숫자는 전부 스냅샷에서 코드가 센 값이다. 문장은 고정 틀에 숫자만 끼운다.
 *   숫자가 없으면 그 문장을 통째로 뺀다 — 추정으로 채우지 않는다.
 * - 매출 영향 줄은 대표가 확인한 연매출(annualRevenue)이 있을 때만. 매출을 추정하지 않는다.
 * - "매출이 오른다" 같은 효과 보장 문구를 쓰지 않는다. 첨부 없음(리포트 링크). 발송 기능 없음.
 * - 정보통신망법 제50조 제4항: 전송자 명칭·연락처와 수신거부 방법을 밝힌다.
 * - 수신 근거(명함·요청·6개월 내 기존 고객)가 없으면 초안을 만들지 않는다 → contact-basis.ts.
 *   발송 판단은 사람이 한다 — 이 코드는 초안까지만 만든다.
 */
import {
  type ContactBasis,
  contactBasisProblem,
  subjectForBasis,
} from "./contact-basis";
import snapshotJson from "./data/leads-snapshot.json";

export type LeadTrack = "prospect" | "existing" | "inbound";
export type LeadIndustry =
  | "beauty"
  | "b2b"
  | "existing"
  | "finance"
  | "partner";

export interface LeadContact {
  checkedOn: string;
  /** 수신 근거. 없으면 작성기에서 운영자가 입력해야 초안을 만들 수 있다. */
  contactBasis?: ContactBasis | null;
  email: string;
  role: string;
  sourceUrl: string;
}

/** 다른 대상으로 오인식된 관찰 — 예: 영어로 "Franz"를 물으면 같은 이름의 메신저 앱을 소개. */
export interface EntityConfusion {
  /** 오인식을 보인 엔진(측정 엔진 표기 그대로) */
  engines: string[];
  /** 대신 소개된 대상, 목적어 형태 — 예: "같은 이름의 메신저 앱" */
  otherEntity: string;
  /** 물어본 이름 그대로 — 예: "Franz" */
  query: string;
  queryLanguage: "en" | "ko" | null;
}

export interface LeadMeasurement {
  answers: number;
  answersWithCitations: number;
  engines: string[];
  entityConfusion?: EntityConfusion | null;
  hook: {
    excerpt: string | null;
    excerptEngine: string | null;
    independentCorrect: number | null;
    label: string | null;
    labelCount: number;
  } | null;
  measuredOn: string | null;
  officialCited: number;
  productConfirmed: number;
}

/** 브랜드명 없는 카테고리 구매 질문 측정(스냅샷 category 블록 중 메일에 쓰는 부분). */
export interface LeadCategory {
  answers: number;
  leaders: { brand: string; mentioned: number }[];
  mentioned: number;
  questions: number;
}

export interface Lead {
  /** 대표가 확인한 연매출(공시·IR 등 출처 필수). 추정치 금지. */
  annualRevenue?: { krw: number; source: string } | null;
  brand: string;
  brandEn: string | null;
  category?: LeadCategory | null;
  company: string;
  contact: LeadContact | null;
  domain: string;
  id: string;
  industry: LeadIndustry;
  measurement: LeadMeasurement | null;
  priority: number;
  reportUrl: string | null;
  segment: string;
  track: LeadTrack;
}

export type Blocker =
  | "inbound"
  | "not_measured"
  | "no_date"
  | "no_observation"
  | "judges_disagree"
  | "no_contact"
  | "no_report"
  | "no_contact_basis";

export type Observation =
  | {
      kind: "recognition";
      answers: number;
      confirmed: number;
      label: string | null;
      labelCount: number;
      excerpt: string | null;
      excerptEngine: string | null;
    }
  | {
      kind: "citation";
      answersWithCitations: number;
      officialCited: number;
    };

export interface LeadReadiness {
  blockers: Blocker[];
  /** 수신 근거만 빼고 다 갖췄다 — 초안 문안은 보여주고, 근거 입력 뒤 저장할 수 있다. */
  composable: boolean;
  observation: Observation | null;
  /** 수신 근거까지 다 갖췄다 — 바로 Gmail 초안을 만들 수 있다. */
  ready: boolean;
}

/** 두 판정기(제품 판정기 vs 독립 2차 판정)의 차이가 전체 답변의 이 비율을 넘으면 숫자를 쓰지 않는다. */
export const MAX_JUDGE_GAP_RATE = 0.25;
/** 출처 인용 관찰은 출처가 달린 답변이 이보다 적으면 쓰지 않는다(표본이 너무 작다). */
export const MIN_CITED_ANSWERS = 8;
/** 매출 영향 줄의 가정 — 연매출 중 AI 추천을 거쳐 결정되는 비중(대표 확정 2026-10-06). */
export const AI_INFLUENCED_REVENUE_RATE = 0.07;

export const OUTREACH_SENDER = {
  displayName: "Findable",
  email: "contact@findable.co.kr",
  legalName: "Findable(인디고차일드)",
} as const;

/** 메일에 넣는 리포트 링크 — 운영 웹의 v12 공개 링크(43자 토큰)만 허용한다. */
const REPORT_URL_RE = /^https:\/\/www\.findable\.co\.kr\/r\/[A-Za-z0-9_-]{43}$/;
const REPORT_URL_IN_BODY_RE =
  /https:\/\/www\.findable\.co\.kr\/r\/[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/;

export function isPublishedReportUrl(url: string | null | undefined): boolean {
  return Boolean(url && REPORT_URL_RE.test(url));
}

export function hasReportLink(body: string): boolean {
  return REPORT_URL_IN_BODY_RE.test(body);
}

export function loadLeads(): Lead[] {
  return (snapshotJson as unknown as { leads: Lead[] }).leads;
}

function judgesAgree(m: LeadMeasurement): boolean {
  const independent = m.hook?.independentCorrect;
  if (independent == null || m.answers === 0) {
    return false;
  }
  return (
    Math.abs(independent - m.productConfirmed) / m.answers <= MAX_JUDGE_GAP_RATE
  );
}

/**
 * 관찰 1줄 고르기.
 * 1순위 = 「AI 가 이 브랜드를 맞게 안다」 — 판정기 2개가 서로 맞을 때만(라운드랩처럼 7 vs 24 면 금지).
 * 2순위 = 「공식 사이트 인용 수」 — 출처 URL 대조라 판정기 오류와 무관.
 */
export function pickObservation(m: LeadMeasurement): {
  observation: Observation | null;
  disagree: boolean;
} {
  const disagree = m.hook != null && !judgesAgree(m);
  if (m.hook && !disagree) {
    return {
      disagree,
      observation: {
        kind: "recognition",
        answers: m.answers,
        confirmed: m.productConfirmed,
        label: m.hook.label,
        labelCount: m.hook.labelCount,
        excerpt: m.hook.excerpt,
        excerptEngine: m.hook.excerptEngine,
      },
    };
  }
  if (m.answersWithCitations >= MIN_CITED_ANSWERS) {
    return {
      disagree,
      observation: {
        kind: "citation",
        answersWithCitations: m.answersWithCitations,
        officialCited: m.officialCited,
      },
    };
  }
  return { disagree, observation: null };
}

export function leadReadiness(
  lead: Lead,
  now: Date = new Date()
): LeadReadiness {
  const blockers: Blocker[] = [];
  if (lead.track === "inbound") {
    blockers.push("inbound");
  }
  let observation: Observation | null = null;
  const m = lead.measurement;
  if (m) {
    const picked = pickObservation(m);
    observation = picked.observation;
    if (!m.measuredOn) {
      blockers.push("no_date");
    }
    if (picked.disagree) {
      blockers.push("judges_disagree");
    }
    if (!observation) {
      blockers.push("no_observation");
    }
  } else {
    blockers.push("not_measured");
  }
  if (!lead.contact) {
    blockers.push("no_contact");
  }
  // 링크 없으면 초안 없음 — 첨부 대신 승인된 리포트 링크로만 근거를 보여준다.
  if (!isPublishedReportUrl(lead.reportUrl)) {
    blockers.push("no_report");
  }
  if (contactBasisProblem(lead.contact?.contactBasis, now)) {
    blockers.push("no_contact_basis");
  }
  // 판정기가 엇갈려도 인용 관찰로 대체할 수 있으면 막지 않는다 — 다만 경고로 남긴다.
  const hard = blockers.filter(
    (b) => !(b === "judges_disagree" && observation?.kind === "citation")
  );
  return {
    blockers,
    observation,
    composable: hard.every((b) => b === "no_contact_basis"),
    ready: hard.length === 0,
  };
}

function josa(word: string, withBatchim: string, without: string): string {
  const code = word.charCodeAt(word.length - 1);
  const isHangul = code >= 0xac_00 && code <= 0xd7_a3;
  return isHangul && (code - 0xac_00) % 28 !== 0 ? withBatchim : without;
}

/** 엔진 id·표기를 화면 이름으로 맞추고 ChatGPT 부터 고정 순서로 정렬한다. */
const ENGINE_NAMES: Record<string, string> = {
  chatgpt: "ChatGPT",
  openai: "ChatGPT",
  gpt: "ChatGPT",
  gemini: "Gemini",
  google: "Gemini",
  claude: "Claude",
  anthropic: "Claude",
  perplexity: "Perplexity",
};
const ENGINE_ORDER = ["ChatGPT", "Gemini", "Claude", "Perplexity"];

export function engineDisplayNames(engines: string[]): string[] {
  const names = [
    ...new Set(engines.map((e) => ENGINE_NAMES[e.toLowerCase()] ?? e)),
  ];
  const rank = (name: string) => {
    const i = ENGINE_ORDER.indexOf(name);
    return i === -1 ? ENGINE_ORDER.length : i;
  };
  return names.sort((a, b) => rank(a) - rank(b));
}

const COUNT_WORDS: Record<number, string> = { 2: "두", 3: "세", 4: "네" };

function confusionSentence(
  e: EntityConfusion,
  measuredEngines: string[]
): string | null {
  const engines = engineDisplayNames(e.engines);
  if (!(engines.length && e.query.trim() && e.otherEntity.trim())) {
    return null;
  }
  const all = engineDisplayNames(measuredEngines);
  const everyEngine =
    engines.length >= 2 &&
    COUNT_WORDS[engines.length] &&
    all.every((name) => engines.includes(name));
  const who = everyEngine
    ? `${COUNT_WORDS[engines.length]} 곳 모두`
    : `${engines.join("·")}에서는`;
  let language = "";
  if (e.queryLanguage === "en") {
    language = "영어로 ";
  } else if (e.queryLanguage === "ko") {
    language = "한국어로 ";
  }
  return `${language}"${e.query}"${josa(e.query, "을", "를")} 물으면 ${who} ${e.otherEntity}${josa(e.otherEntity, "을", "를")} 소개했습니다.`;
}

function categorySentence(lead: Lead, c: LeadCategory): string | null {
  if (!(c.questions > 0 && c.answers > 0)) {
    return null;
  }
  const subject = `${lead.brand}${josa(lead.brand, "이", "가")}`;
  return c.mentioned === 0
    ? `브랜드명을 넣지 않은 구매 질문 ${c.questions}개(답변 ${c.answers}개)에서는 ${subject} 한 번도 언급되지 않았습니다.`
    : `브랜드명을 넣지 않은 구매 질문 ${c.questions}개(답변 ${c.answers}개)에서 ${subject} 언급된 답변은 ${c.mentioned}개였습니다.`;
}

/** 가장 큰 발견 한 문장 — 오인식 > 카테고리 질문 누락. 근거 데이터가 없으면 null(문장 생략). */
function findingSentence(lead: Lead, m: LeadMeasurement): string | null {
  if (m.entityConfusion) {
    const sentence = confusionSentence(m.entityConfusion, m.engines);
    if (sentence) {
      return sentence;
    }
  }
  return lead.category ? categorySentence(lead, lead.category) : null;
}

/** 제목 괄호 속 후킹 — 측정에서 나온 짧은 사실. 없으면 null(괄호 없이 제목만). */
export function subjectHook(lead: Lead): string | null {
  const confusion = lead.measurement?.entityConfusion;
  if (
    confusion &&
    confusionSentence(confusion, lead.measurement?.engines ?? [])
  ) {
    const engines = engineDisplayNames(confusion.engines);
    return `${engines.includes("ChatGPT") ? "ChatGPT" : engines[0]} 오인식 확인`;
  }
  const c = lead.category;
  if (c && c.questions > 0 && c.answers > 0 && c.mentioned === 0) {
    return "AI 답변 누락 확인";
  }
  return null;
}

export function outreachSubject(lead: Lead): string {
  const hook = subjectHook(lead);
  const base = `${lead.brand} AI 검색 진단 결과 공유드립니다`;
  return hook ? `${base} (${hook})` : base;
}

/**
 * 월 금액을 읽기 쉬운 한 자리 어림값으로 — 42,350,000 → "4천만 원", 1.35억 → "1억 원".
 * 백만 원 미만은 null(문장 생략).
 */
export function readableMonthlyAmount(krw: number): string | null {
  if (!(Number.isFinite(krw) && krw >= 1_000_000)) {
    return null;
  }
  let magnitude = Math.floor(Math.log10(krw));
  let digit = Math.round(krw / 10 ** magnitude);
  if (digit === 10) {
    digit = 1;
    magnitude += 1;
  }
  if (magnitude >= 8) {
    const eok = digit * 10 ** (magnitude - 8);
    return `${eok.toLocaleString("ko-KR")}억 원`;
  }
  return magnitude === 7 ? `${digit}천만 원` : `${digit}백만 원`;
}

/** 연매출 × 7% ÷ 12. 확인된 연매출이 없으면 null — 매출을 추정하지 않는다. */
export function monthlyAiInfluencedRevenue(lead: Lead): string | null {
  const krw = lead.annualRevenue?.krw;
  if (!(krw && krw > 0 && lead.annualRevenue?.source.trim())) {
    return null;
  }
  return readableMonthlyAmount((krw * AI_INFLUENCED_REVENUE_RATE) / 12);
}

function impactSentences(lead: Lead): string[] {
  const lines: string[] = [];
  const monthly = monthlyAiInfluencedRevenue(lead);
  if (monthly) {
    lines.push(
      `저희 추정으로는 ${lead.brand} 매출 중 월 약 ${monthly} 규모가 AI 추천을 거쳐 결정되고 있습니다.`
    );
  }
  const c = lead.category;
  const leader = c?.leaders.find((l) => l.brand !== lead.brand);
  if (c && leader && c.answers > 0 && leader.mentioned > c.mentioned) {
    lines.push(
      `같은 구매 질문의 답변 ${c.answers}개 중 ${leader.mentioned}개에는 ${leader.brand}${josa(leader.brand, "이", "가")} 언급됐습니다.`
    );
  }
  return lines;
}

function categoryPhrase(lead: Lead): string {
  if (lead.segment.includes("뷰티")) {
    return "화장품을 고를 때";
  }
  if (lead.industry === "b2b" || lead.segment.includes("B2B")) {
    return "거래처를 찾을 때";
  }
  if (lead.industry === "finance") {
    return "금융 상품을 비교할 때";
  }
  return "제품이나 서비스를 고를 때";
}

function observationClause(lead: Lead, o: Observation): string {
  if (o.kind === "recognition") {
    return `정확히 소개한 답변은 ${o.confirmed}번이었습니다.`;
  }
  return `출처가 달린 답변 ${o.answersWithCitations}번 중 공식 사이트(${lead.domain})를 출처로 쓴 답변은 ${o.officialCited}번이었습니다.`;
}

export const UNSUBSCRIBE_LINE =
  "더 이상 연락을 원치 않으시면 이 메일에 '수신거부'라고 회신해 주세요.";
export const UNSUBSCRIBE_LINE_EN =
  'If you would rather not hear from us again, just reply "unsubscribe" to this email.';

/** 초안 조립. readiness.composable 이 아니면 null — 화면에서 작성기를 띄우지 않는다. */
export function composeOutreachDraft(
  lead: Lead,
  readiness: LeadReadiness = leadReadiness(lead)
): { body: string; recipient: string; subject: string } | null {
  const m = lead.measurement;
  const o = readiness.observation;
  if (
    !(
      readiness.composable &&
      m?.measuredOn &&
      o &&
      lead.contact &&
      lead.reportUrl &&
      isPublishedReportUrl(lead.reportUrl)
    )
  ) {
    return null;
  }
  const brand = lead.brand;
  const engines = engineDisplayNames(m.engines).join("·");
  const finding = findingSentence(lead, m);
  const impact = impactSentences(lead);
  const lines = [
    `안녕하세요, ${brand} 마케팅 담당자님.`,
    "AI 검색 진단 서비스 Findable을 운영하는 나현덕입니다.",
    "",
    `최근 고객들이 ${categoryPhrase(lead)} ChatGPT 같은 AI에 먼저 묻는 경우가 늘고 있어,`,
    `${brand}${josa(brand, "이", "가")} AI에서 어떻게 소개되는지 직접 확인해 보았습니다.`,
    "",
    "확인한 내용",
    `- ${engines}에 ${brand}${josa(brand, "을", "를")} ${m.answers}번 물었고, ${observationClause(lead, o)}`,
    ...(finding ? [`- ${finding}`] : []),
    "",
    ...(impact.length ? ["영향", ...impact.map((s) => `- ${s}`), ""] : []),
    "답변 원문과 개선 방향은 아래 링크에 정리해 두었습니다.",
    lead.reportUrl,
    "",
    "괜찮으시다면 15분 정도 통화로 결과를 설명드리고, 함께 개선할 수 있는 방법을 제안드리고 싶습니다.",
    "",
    "감사합니다.",
    "나현덕 드림",
    "Findable 대표 | www.findable.co.kr",
    "",
    `보낸 사람: ${OUTREACH_SENDER.legalName} · ${OUTREACH_SENDER.email}`,
    UNSUBSCRIBE_LINE,
    UNSUBSCRIBE_LINE_EN,
  ];
  return {
    recipient: lead.contact.email,
    subject: subjectForBasis(
      outreachSubject(lead),
      lead.contact.contactBasis?.kind
    ),
    body: lines.join("\n"),
  };
}

/** 서버 검증용 — 전송자 연락처와 수신거부 안내가 빠진 초안은 저장하지 않는다(제50조 제4항). */
export function hasSenderNotice(body: string): boolean {
  return body.includes(OUTREACH_SENDER.email) && body.includes("수신거부");
}

/** 효과 보장 표현 — 초안에 들어 있으면 저장하지 않는다. */
const GUARANTEE_RE =
  /(매출|판매|전환|유입|문의)(이|을|가|률|율)?\s*(오르|오릅|올라|올려|상승|증가|늘어|늘려|늘립|두\s*배)|반드시|보장(합니다|해|됩|드립)|100%\s*(노출|상승|인용)/;

export function hasGuaranteeClaim(text: string): boolean {
  return GUARANTEE_RE.test(text);
}
