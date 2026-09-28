/**
 * 영업 리드 — 측정 스냅샷을 읽어 「초안을 만들어도 되는가」를 판정하고,
 * 측정 숫자만으로 콜드메일 초안을 조립한다.
 *
 * 원칙 (대표 지시 2026-09-29)
 * - 메일에 들어가는 숫자는 전부 스냅샷에서 코드가 센 값이다. 문장은 고정 틀에 숫자만 끼운다.
 * - "매출이 오른다" 같은 효과 보장 문구를 쓰지 않는다. 첨부 없음. 발송 기능 없음.
 * - 정보통신망법 제50조 제4항: 광고성 정보에는 전송자 명칭·연락처와 수신거부 방법을 밝힌다.
 *   ⚠️ 같은 조 제1항은 전자우편 광고도 **수신자의 명시적 사전 동의**를 요구한다.
 *   발송 판단은 사람이 한다 — 이 코드는 초안까지만 만든다.
 */
import snapshotJson from "./data/leads-snapshot.json";

export type LeadTrack = "prospect" | "existing" | "inbound";
export type LeadIndustry = "beauty" | "b2b" | "existing" | "finance" | "partner";

export interface LeadContact {
  checkedOn: string;
  email: string;
  role: string;
  sourceUrl: string;
}

export interface LeadMeasurement {
  answers: number;
  answersWithCitations: number;
  engines: string[];
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

export interface Lead {
  brand: string;
  brandEn: string | null;
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
  | "no_contact";

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
  observation: Observation | null;
  ready: boolean;
}

/** 두 판정기(제품 판정기 vs 독립 2차 판정)의 차이가 전체 답변의 이 비율을 넘으면 숫자를 쓰지 않는다. */
export const MAX_JUDGE_GAP_RATE = 0.25;
/** 출처 인용 관찰은 출처가 달린 답변이 이보다 적으면 쓰지 않는다(표본이 너무 작다). */
export const MIN_CITED_ANSWERS = 8;

export const OUTREACH_SENDER = {
  displayName: "Findable",
  email: "contact@findable.co.kr",
} as const;

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

export function leadReadiness(lead: Lead): LeadReadiness {
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
  // 판정기가 엇갈려도 인용 관찰로 대체할 수 있으면 막지 않는다 — 다만 경고로 남긴다.
  const hard = blockers.filter(
    (b) => !(b === "judges_disagree" && observation?.kind === "citation")
  );
  return { blockers, observation, ready: hard.length === 0 };
}

function josa(word: string, withBatchim: string, without: string): string {
  const code = word.charCodeAt(word.length - 1);
  const isHangul = code >= 0xac_00 && code <= 0xd7_a3;
  return isHangul && (code - 0xac_00) % 28 !== 0 ? withBatchim : without;
}

function observationSentence(lead: Lead, o: Observation): string {
  if (o.kind === "recognition") {
    return `답변 ${o.answers}개 중 ${lead.brand}${josa(lead.brand, "을", "를")} 정확히 설명한 답변은 ${o.confirmed}개였습니다.`;
  }
  return `출처 링크가 달린 답변 ${o.answersWithCitations}개 중 공식 사이트(${lead.domain})를 출처로 쓴 답변은 ${o.officialCited}개였습니다.`;
}

function formatDate(iso: string): string {
  const [y, mo, d] = iso.split("-").map(Number);
  return `${y}년 ${mo}월 ${d}일`;
}

export const UNSUBSCRIBE_LINE =
  "더 이상 이런 메일을 받지 않으시려면 이 메일에 '수신거부'라고 회신해 주세요.";

/** 초안 조립. readiness.ready 가 아니면 null — 화면에서 저장 버튼을 잠근다. */
export function composeOutreachDraft(
  lead: Lead,
  readiness: LeadReadiness = leadReadiness(lead)
): { body: string; recipient: string; subject: string } | null {
  const m = lead.measurement;
  const o = readiness.observation;
  if (!(readiness.ready && m?.measuredOn && o && lead.contact)) {
    return null;
  }
  const engines = m.engines.join("·");
  const lines = [
    `안녕하세요, ${lead.company} ${lead.brand} 담당자님.`,
    "AI 검색 답변 속 브랜드 노출을 진단하는 파인더블(Findable)의 나현덕입니다.",
    "",
    `${formatDate(m.measuredOn)}, ${engines}에 ${lead.brand} 관련 질문을 넣고 받은 답변 ${m.answers}개를 확인했습니다.`,
    observationSentence(lead, o),
  ];
  if (o.kind === "recognition" && o.excerpt && o.excerptEngine) {
    lines.push(`(예: ${o.excerptEngine} 답변 원문 — "${o.excerpt}")`);
  }
  lines.push(
    "",
    lead.reportUrl
      ? `질문별 답변 원문과 출처는 아래 페이지에 정리해 두었습니다.\n${lead.reportUrl}`
      : "질문별 답변 원문과 출처를 정리한 결과가 있습니다. 회신 주시면 보내드리겠습니다.",
    "",
    "—",
    "나현덕 | 대표",
    "파인더블(Findable)",
    "AI 시대의 브랜드 검색 노출 진단·처방",
    "www.findable.co.kr",
    "",
    `[광고] 전송자: 파인더블(Findable) · ${OUTREACH_SENDER.email}`,
    UNSUBSCRIBE_LINE
  );
  return {
    recipient: lead.contact.email,
    subject: `(광고) ${lead.brand} AI 검색 답변 확인 결과 공유드립니다`,
    body: lines.join("\n"),
  };
}

/** 서버 검증용 — 광고 표기와 수신거부 안내가 빠진 초안은 저장하지 않는다. */
export function hasAdNotice(subject: string, body: string): boolean {
  return subject.trim().startsWith("(광고)") && body.includes("수신거부");
}

/** 효과 보장 표현 — 초안에 들어 있으면 저장하지 않는다. */
const GUARANTEE_RE =
  /매출(이|을)?\s*(오르|올려|상승|증가)|반드시\s*(오르|노출)|보장합니다|100%\s*(노출|상승)/;

export function hasGuaranteeClaim(text: string): boolean {
  return GUARANTEE_RE.test(text);
}
