import "server-only";

import {
  isAllowedByRobots,
  parseRobotsDisallow,
} from "@repo/audit/brand-catalog";
import { assertPublicUrl } from "@repo/audit/public-url-security";
import { log } from "@repo/observability/log";
import { type ContactBasis, seoulToday } from "../contact-basis";

/**
 * 공개 회사 메일 찾기 — 회사가 **자기 홈페이지에 문의·제휴용으로 공개한** 회사 메일 주소.
 *
 * 근거: 「2026-10-06~07 대표가 KISA 118 전화 확인 — 공개 문의·제휴용 회사 메일 수집·협업 제안 발송 문제없음 답변, 서면 회신 없음」
 *   → 수신 근거 ④ public_contact(`../contact-basis.ts`)로 쓴다.
 *   그 근거에 남길 것 = **찾은 페이지 주소 + 확인 날짜**(candidate.sourceUrl·fetchedAt → publicContactBasis).
 *
 * 안전장치(하나라도 걸리면 멈춘다):
 *  - 그 회사 홈페이지(같은 호스트 + www, 로케일 하위경로)만. 회사당 페이지 최대 6번, 순서대로·짧은 간격.
 *  - robots.txt 를 지킨다(와일드카드 해석은 brand-catalog 것을 그대로 쓴다 — 복사 금지).
 *    robots.txt 가 5xx·응답 없음이면 RFC 9309 대로 「전부 막힘」으로 본다.
 *  - 어느 페이지든 「이메일 무단수집 거부」 게시가 보이면 **즉시 멈추고 후보 0개**(정보통신망법 제50조의2).
 *  - 실패해도 throw 하지 않는다 — 회사 카드의 이 칸만 빈다. 로그엔 도메인 대신 상태 코드만.
 *  - 개인정보보호책임자 주소는 찾아도 맨 뒤(privacy) — 영업 발송 대상이 아니다(pickSalesContact 가 뺀다).
 */

export type ContactRole =
  | "partnership"
  | "general"
  | "press"
  | "cs"
  | "other"
  | "privacy";

export type ContactConfidence = "high" | "medium" | "low";

export interface ContactEmailCandidate {
  confidence: ContactConfidence;
  email: string;
  /** 페이지를 가져온 시각(ISO) — 수신 근거의 「확인 날짜」 */
  fetchedAt: string;
  /** 주소 바로 앞(없으면 뒤) 글자 ≤60자 — 역할 판단 근거 */
  label: string;
  /** 사람 이름처럼 보이는 주소(aiden.jung@, mkchoi@) — 후보로는 보여 주되 자동 1순위로 고르지 않는다(대표 결정 2026-10-07). */
  personalName: boolean;
  role: ContactRole;
  /** 메일 도메인이 사이트 도메인(또는 브랜드명이 들어간 도메인)과 같다 */
  sameDomain: boolean;
  /** 주소가 보인 페이지 — 수신 근거의 「공개된 페이지 주소」 */
  sourceUrl: string;
}

/**
 * ok = 후보 1개 이상 · none = 읽었지만 없음 · refused = 무단수집 거부 게시(후보 0)
 * blocked_by_robots = 홈페이지부터 robots 금지 · unavailable = 홈페이지/robots 응답 없음 · skipped = 도메인 이상
 */
export type ContactEmailStatus =
  | "ok"
  | "none"
  | "refused"
  | "blocked_by_robots"
  | "unavailable"
  | "skipped";

export interface ContactEmailResult {
  candidates: ContactEmailCandidate[];
  checkedUrls: string[];
  skippedReason?: string;
  status: ContactEmailStatus;
}

export interface FindContactEmailsInput {
  brandNames?: string[];
  domain: string;
  signal?: AbortSignal;
}

/** 테스트 주입용 — 운영 코드는 기본값만 쓴다. */
export interface FindContactEmailsDeps {
  assertUrl?: (url: URL) => Promise<void>;
  delayMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

const MAX_PAGES = 6;
const MAX_REDIRECTS = 4;
const PER_FETCH_TIMEOUT_MS = 8000;
const TOTAL_BUDGET_MS = 30_000;
const DEFAULT_DELAY_MS = 500;
const MAX_BODY_CHARS = 1_500_000;
const LABEL_MAX = 60;
const BEFORE_WINDOW = 160;
const AFTER_WINDOW = 40;
/** brand-catalog(FindableMeasurementBot)과 같은 꼴 — 누가 왜 읽는지 사이트 운영자가 알 수 있게. */
const USER_AGENT =
  "FindableContactBot/1.0 (+https://www.findable.co.kr/ko/contact)";

// ── 정규식(최상위) ──
const WWW_RE = /^www\./;
const PROTOCOL_RE = /^https?:\/\//;
const SCRIPT_LIKE_RE =
  /<(script|style|noscript|template)\b([^>]*)>([\s\S]*?)<\/\1\s*>/gi;
const LD_JSON_RE = /application\/ld\+json/i;
const COMMENT_RE = /<!--[\s\S]*?-->/g;
const CF_ELEMENT_RE =
  /<([a-z]+)\b[^>]*data-cfemail\s*=\s*["']([0-9a-f]+)["'][^>]*>[\s\S]*?<\/\1>/gi;
const CF_HREF_RE = /\/cdn-cgi\/l\/email-protection#([0-9a-f]+)/gi;
const MAILTO_ANCHOR_RE =
  /<a\b[^>]*href\s*=\s*["']\s*mailto:([^"'?]+)[^"']*["'][^>]*>([\s\S]*?)<\/a\s*>/gi;
const BLOCK_TAG_RE =
  /<\/?(?:p|div|br|li|ul|ol|tr|td|th|table|tbody|section|article|footer|header|nav|aside|h[1-6]|dl|dt|dd|address|hr)\b[^>]*>/gi;
const TAG_RE = /<[^>]+>/g;
const NUMERIC_ENTITY_RE = /&#(x[0-9a-f]+|\d+);/gi;
const NAMED_ENTITY_RE = /&(amp|lt|gt|quot|apos|nbsp|commat|period|#?\w+);/gi;
const INLINE_SPACE_RE = /[ \t\f\v 　]+/g;
const NEWLINES_RE = /\s*\n\s*/g;
const FULLWIDTH_AT_RE = /＠/g;
const BRACKET_AT_RE = /\s*[[({]\s*(?:at|골뱅이)\s*[\])}]\s*/gi;
const BRACKET_DOT_RE = /\s*[[({]\s*dot\s*[\])}]\s*/gi;
const SPACED_AT_RE =
  /\b([a-z0-9][a-z0-9._%+-]*)\s+at\s+((?:[a-z0-9-]+\.)+[a-z]{2,24})\b/gi;
const EMAIL_RE =
  /[a-z0-9][a-z0-9._%+-]{0,63}@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}/gi;
const SEGMENT_SPLIT_RE = /[\n|│｜·•]+/;
const LABEL_TRAIL_RE = /[\s:：\-–—=>/]+$/;
const LABEL_LEAD_RE = /^[\s:：\-–—)\]]+/;
const ASSET_TLD_RE =
  /^(?:png|jpe?g|gif|webp|svg|avif|ico|bmp|css|js|mjs|json|map|woff2?|ttf|otf|eot|mp4|webm|mp3|pdf|zip)$/;
const RETINA_LOCAL_RE = /^(?:.*[-_.])?\d+(?:\.\d+)?x$/;
const ANCHOR_RE =
  /<a\b[^>]*href\s*=\s*["']([^"'#][^"']*)["'][^>]*>([\s\S]*?)<\/a\s*>/gi;
const SKIP_PATH_RE =
  /login|logout|member|join|signup|sign-up|cart|basket|order|mypage|my-page|wishlist|checkout|search|product|goods|\/shop\/|review|\.(?:pdf|jpe?g|png|gif|zip|webp|svg|mp4)$/i;
const LINK_STRONG_RE =
  /제휴|협업|입점|파트너|partner|b2b|wholesale|도매|global|export|수출|distribut|contact|문의|inquir|enquir/i;
const LINK_WEAK_RE = /about|회사\s*소개|company|brand\s*story|브랜드\s*소개/i;
const CHARSET_HEADER_RE = /charset=["']?([\w-]+)/i;
const CHARSET_META_RE = /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i;
const HTML_TYPE_RE = /html|text\/plain|xml/i;
const ALNUM_LOWER_RE = /[^a-z0-9]/g;
const LEADING_PUNCT_RE = /^[._%+-]+/;

/**
 * 「이메일 무단수집 거부」 게시 — 띄어쓰기 변형이 많아 공백을 지운 글자에서 찾는다.
 * 예: 이메일무단수집거부 / 전자우편주소 무단 수집 거부 / 이메일 무단수집 거부 / 이메일주소무단수집거부
 */
const REFUSAL_COMPACT_RE =
  /(?:이메일|e-?mail|전자우편|메일)(?:주소)?(?:의)?무단(?:으로)?수집(?:을|의)?거부|무단수집거부|이메일수집거부/i;
const REFUSAL_EN_RE =
  /(?:refuse|reject|prohibit)\w*\s+(?:the\s+)?unauthori[sz]ed\s+(?:collection\s+of\s+)?e-?mail/i;
const WHITESPACE_RE = /\s+/g;

const ROLE_RANK: Record<ContactRole, number> = {
  partnership: 0,
  general: 1,
  press: 2,
  cs: 3,
  other: 4,
  privacy: 5,
};

/** 라벨 키워드(한·영). privacy 는 다른 키워드와 같이 있어도 우선한다(「개인정보 관련 문의」 = privacy). */
const PRIVACY_LABEL_RE =
  /개인\s*정보|privacy|\bdpo\b|data\s*protection|정보\s*보호\s*책임/i;
const LABEL_ROLES: [Exclude<ContactRole, "privacy" | "other">, RegExp][] = [
  [
    "partnership",
    /제휴|협업|협력\s*제안|제안|proposal|입점|b2b|wholesale|도매|수출|export|global\s*(?:sales|business|contact)|해외|oversea|海外|영업(?!\s*(?:시간|일))|마케팅|marketing|\btrade\b|distribut|partner|\bsales\b|영업\s*문의|사업\s*제안|business\s*(?:inquir|enquir|contact)/i,
  ],
  ["press", /\bpress\b|\bpr\b|홍보|보도|언론|media\s*(?:inquir|contact)/i],
  [
    "cs",
    /고객\s*센터|고객\s*상담|\bcs\b|c\/s|support|customer\s*(?:service|care|center)|상담|a\/s|as\s*문의/i,
  ],
  [
    "general",
    /대표\s*(?:메일|이메일|e-?mail|문의|주소)|문의|inquir|enquir|\binfo\b|contact|hello/i,
  ],
];

/** 라벨이 없을 때 주소 앞부분으로 보조 판단. */
const LOCAL_ROLES: [ContactRole, RegExp][] = [
  ["privacy", /^(?:privacy|dpo|personal[-_.]?info)/],
  [
    "partnership",
    /^(?:partner|partnership|b2b|biz|business|sales|global|export|wholesale|distribution|alliance|collab|trade|mkt|marketing)/,
  ],
  ["press", /^(?:pr|press|media)$/],
  ["cs", /^(?:cs|help|support|service|customer|care)/],
  ["general", /^(?:info|contact|hello|hi|inquiry|enquiry|ask|office)$/],
];

const FREE_MAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "naver.com",
  "daum.net",
  "hanmail.net",
  "kakao.com",
  "nate.com",
  "hotmail.com",
  "outlook.com",
  "live.com",
  "yahoo.com",
  "yahoo.co.kr",
  "icloud.com",
  "me.com",
  "korea.com",
  "hanmir.com",
  "empas.com",
  "paran.com",
  "proton.me",
  "protonmail.com",
]);

/** 예시·테스트·플랫폼(오류수집·쇼핑몰 솔루션) 주소 — 회사 연락처가 아니다. */
const BLOCKED_DOMAINS = [
  "example.com",
  "example.org",
  "example.net",
  "test.com",
  "domain.com",
  "email.com",
  "yourdomain.com",
  "yourcompany.com",
  "company.com",
  "sentry.io",
  "sentry-next.wixpress.com",
  "wixpress.com",
  "wix.com",
  "cafe24.com",
  "cafe24corp.com",
  "shopify.com",
  "godo.co.kr",
  "nhn-commerce.com",
  "makeshop.co.kr",
  "imweb.me",
];
const BLOCKED_TLDS = new Set(["test", "example", "invalid", "localhost"]);
const BLOCKED_LOCALS = new Set([
  "noreply",
  "no-reply",
  "donotreply",
  "do-not-reply",
  "mailer-daemon",
  "postmaster",
  "user",
  "name",
  "email",
  "your-email",
  "youremail",
]);

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  apos: "'",
  commat: "@",
  gt: ">",
  lt: "<",
  nbsp: " ",
  period: ".",
  quot: '"',
};

// ── 텍스트 정리 ──

function decodeEntities(text: string): string {
  return text
    .replace(NUMERIC_ENTITY_RE, (_, code: string) => {
      const n =
        code[0]?.toLowerCase() === "x"
          ? Number.parseInt(code.slice(1), 16)
          : Number(code);
      return Number.isFinite(n) && n > 0 && n < 0x11_00_00
        ? String.fromCodePoint(n)
        : " ";
    })
    .replace(
      NAMED_ENTITY_RE,
      (whole, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? whole
    );
}

/** Cloudflare 이메일 보호(data-cfemail) 해독 — 첫 바이트가 XOR 키. */
export function decodeCloudflareEmail(hex: string): string | null {
  if (hex.length < 4 || hex.length % 2 !== 0) {
    return null;
  }
  const key = Number.parseInt(hex.slice(0, 2), 16);
  let out = "";
  for (let i = 2; i < hex.length; i += 2) {
    // biome-ignore lint/suspicious/noBitwiseOperators: Cloudflare 난독화 규격이 XOR 이다
    out += String.fromCharCode(Number.parseInt(hex.slice(i, i + 2), 16) ^ key);
  }
  return out.includes("@") ? out : null;
}

/**
 * HTML → 줄 구분이 살아 있는 글자. mailto 링크는 「링크 글자 + 주소」로 펼쳐서
 * 「제휴 문의」 버튼 뒤에 숨은 주소도 라벨과 함께 읽히게 한다.
 */
export function htmlToText(html: string): string {
  const cleaned = html
    .replace(COMMENT_RE, " ")
    .replace(SCRIPT_LIKE_RE, (_, _tag: string, attrs: string, body: string) =>
      LD_JSON_RE.test(attrs) ? `\n${body}\n` : " "
    )
    .replace(CF_ELEMENT_RE, (_, _tag: string, hex: string) => {
      const email = decodeCloudflareEmail(hex);
      return email ? ` ${email} ` : " ";
    })
    .replace(CF_HREF_RE, (_, hex: string) => {
      const email = decodeCloudflareEmail(hex);
      return email ? `mailto:${email}` : "#";
    })
    .replace(MAILTO_ANCHOR_RE, (_, address: string, inner: string) => {
      let decoded = address;
      try {
        decoded = decodeURIComponent(address);
      } catch {
        /* 깨진 퍼센트 인코딩은 원문 그대로 */
      }
      return ` ${inner} ${decodeEntities(decoded).trim()} `;
    })
    .replace(BLOCK_TAG_RE, "\n")
    .replace(TAG_RE, " ");
  return decodeEntities(cleaned)
    .replace(INLINE_SPACE_RE, " ")
    .replace(NEWLINES_RE, "\n")
    .trim();
}

/** 「이메일 무단수집 거부」 게시가 있는가 — 원문(alt 포함)과 글자 양쪽에서 본다. */
export function hasCollectionRefusal(html: string): boolean {
  const text = decodeEntities(html.replace(TAG_RE, " "));
  const compactText = text.replace(WHITESPACE_RE, "");
  const compactRaw = decodeEntities(html).replace(WHITESPACE_RE, "");
  return (
    REFUSAL_COMPACT_RE.test(compactText) ||
    REFUSAL_COMPACT_RE.test(compactRaw) ||
    REFUSAL_EN_RE.test(text)
  );
}

// ── 도메인 판단 ──

function bareHost(value: string): string {
  return (
    value.trim().toLowerCase().replace(PROTOCOL_RE, "").split("/")[0] ?? ""
  ).replace(WWW_RE, "");
}

function domainMatches(emailDomain: string, bare: string): boolean {
  return emailDomain === bare || emailDomain.endsWith(`.${bare}`);
}

function isBlockedAddress(local: string, emailDomain: string): boolean {
  const tld = emailDomain.split(".").at(-1) ?? "";
  if (ASSET_TLD_RE.test(tld) || BLOCKED_TLDS.has(tld)) {
    return true;
  }
  if (RETINA_LOCAL_RE.test(local) || BLOCKED_LOCALS.has(local)) {
    return true;
  }
  return BLOCKED_DOMAINS.some((d) => domainMatches(emailDomain, d));
}

interface DomainContext {
  brandTokens: string[];
  siteDomains: string[];
}

function brandTokens(names: string[] | undefined): string[] {
  return (names ?? [])
    .map((n) => n.toLowerCase().replace(ALNUM_LOWER_RE, ""))
    .filter((n) => n.length >= 3);
}

function isSameDomain(emailDomain: string, ctx: DomainContext): boolean {
  if (ctx.siteDomains.some((d) => domainMatches(emailDomain, d))) {
    return true;
  }
  const labels = emailDomain.split(".");
  const head = labels.length > 1 ? labels.slice(0, -1).join("") : "";
  return ctx.brandTokens.some((token) => head.includes(token));
}

// ── 역할 판단 ──

function roleFromLabel(segment: string): ContactRole | null {
  if (PRIVACY_LABEL_RE.test(segment)) {
    return "privacy";
  }
  for (const [role, re] of LABEL_ROLES) {
    if (re.test(segment)) {
      return role;
    }
  }
  return null;
}

function roleFromLocal(local: string): ContactRole | null {
  for (const [role, re] of LOCAL_ROLES) {
    if (re.test(local)) {
      return role;
    }
  }
  return null;
}

function tidyLabel(text: string, fromEnd: boolean): string {
  const t = text.replace(LABEL_TRAIL_RE, "").replace(LABEL_LEAD_RE, "").trim();
  if (t.length <= LABEL_MAX) {
    return t;
  }
  return fromEnd ? t.slice(t.length - LABEL_MAX) : t.slice(0, LABEL_MAX);
}

interface Occurrence {
  email: string;
  label: string;
  role: ContactRole;
  roleFrom: "label" | "local" | "page" | "none";
}

/** 주소 바로 앞 구간(이전 주소 이후, 마지막 줄/구분자 조각) → 없으면 바로 뒤 조각. */
function classifyOccurrence(
  email: string,
  before: string,
  after: string,
  pageHint: ContactRole | null
): Occurrence {
  const beforeSegments = before
    .split(SEGMENT_SPLIT_RE)
    .map((s) => s.trim())
    .filter(Boolean);
  const lastBefore = beforeSegments.at(-1) ?? "";
  const firstAfter = after.split(SEGMENT_SPLIT_RE)[0]?.trim() ?? "";
  const beforeRole = roleFromLabel(lastBefore);
  if (beforeRole) {
    return {
      email,
      label: tidyLabel(lastBefore, true),
      role: beforeRole,
      roleFrom: "label",
    };
  }
  const afterRole = roleFromLabel(firstAfter);
  if (afterRole) {
    return {
      email,
      label: tidyLabel(firstAfter, false),
      role: afterRole,
      roleFrom: "label",
    };
  }
  const label = tidyLabel(lastBefore || firstAfter, !!lastBefore);
  const localRole = roleFromLocal(email.split("@")[0] ?? "");
  if (localRole) {
    return { email, label, role: localRole, roleFrom: "local" };
  }
  if (pageHint) {
    return { email, label, role: pageHint, roleFrom: "page" };
  }
  return { email, label, role: "other", roleFrom: "none" };
}

function normalizeObfuscation(text: string, ctx: DomainContext): string {
  return text
    .replace(FULLWIDTH_AT_RE, "@")
    .replace(BRACKET_AT_RE, "@")
    .replace(BRACKET_DOT_RE, ".")
    .replace(SPACED_AT_RE, (whole, local: string, domain: string) =>
      // 「us at booth.com」 같은 오탐을 막으려고 사이트/브랜드 도메인일 때만 바꾼다.
      isSameDomain(domain.toLowerCase(), ctx) ? `${local}@${domain}` : whole
    );
}

/** 한 페이지 HTML → 주소별 등장 기록(라벨·역할). 순수 함수. */
export function extractOccurrences(
  html: string,
  ctx: DomainContext,
  pageHint: ContactRole | null = null
): Occurrence[] {
  const text = normalizeObfuscation(htmlToText(html), ctx);
  const matches = [...text.matchAll(EMAIL_RE)];
  const out: Occurrence[] = [];
  matches.forEach((match, i) => {
    const raw = match[0];
    const start = match.index ?? 0;
    const end = start + raw.length;
    const email = raw.toLowerCase().replace(LEADING_PUNCT_RE, "");
    const [local = "", emailDomain = ""] = email.split("@");
    if (!(local && emailDomain) || isBlockedAddress(local, emailDomain)) {
      return;
    }
    const prev = matches[i - 1];
    const prevEnd = prev ? (prev.index ?? 0) + prev[0].length : 0;
    const nextStart = matches[i + 1]?.index ?? text.length;
    const before = text.slice(Math.max(prevEnd, start - BEFORE_WINDOW), start);
    const after = text.slice(end, Math.min(nextStart, end + AFTER_WINDOW));
    out.push(classifyOccurrence(email, before, after, pageHint));
  });
  return out;
}

// ── 후보 합치기·순위 ──

interface Sighting extends Occurrence {
  fetchedAt: string;
  sourceUrl: string;
}

function domainRank(c: ContactEmailCandidate): number {
  if (c.sameDomain) {
    return 0;
  }
  const domain = c.email.split("@")[1] ?? "";
  return FREE_MAIL_DOMAINS.has(domain) ? 2 : 1;
}

const CONFIDENCE_RANK: Record<ContactConfidence, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

export function compareCandidates(
  a: ContactEmailCandidate,
  b: ContactEmailCandidate
): number {
  return (
    ROLE_RANK[a.role] - ROLE_RANK[b.role] ||
    domainRank(a) - domainRank(b) ||
    CONFIDENCE_RANK[a.confidence] - CONFIDENCE_RANK[b.confidence] ||
    a.email.localeCompare(b.email)
  );
}

/** 같은 주소의 여러 라벨 중 가장 좋은 역할. 「other」는 라벨 없음과 같아서 다른 역할이 있으면 밀린다. */
function bestSighting(list: Sighting[]): Sighting {
  const labeled = list.filter((s) => s.role !== "other");
  const pool = labeled.length > 0 ? labeled : list;
  const fromRank = { label: 0, local: 1, page: 2, none: 3 } as const;
  return [...pool].sort(
    (a, b) =>
      ROLE_RANK[a.role] - ROLE_RANK[b.role] ||
      fromRank[a.roleFrom] - fromRank[b.roleFrom]
  )[0] as Sighting;
}

// 사람 이름 주소 판별 — 역할 낱말이 하나도 없고, 「이름.성」꼴이거나 영문 이니셜+한국 성씨(mkchoi)꼴이면 개인 주소로 본다.
const ROLE_WORD_RE =
  /(sales|global|market|mkt|info|contact|partner|ecomm|commerce|admin|help|support|team|biz|b2b|press|pr|hello|office|export|trade|cs|service|order|shop|store|brand|official|master|manager|webmaster|mail|ask|inquiry|wholesale|privacy|dpo|cpo|hr|recruit|career|ir|media|design|package|sourcing|china|japan|us|eu)/;
const KOREAN_SURNAMES =
  "kim|lee|park|choi|jung|jeong|kang|cho|jo|yoon|yun|jang|chang|lim|im|han|oh|seo|shin|kwon|hwang|ahn|an|song|yoo|yu|hong|jeon|ko|go|moon|yang|son|bae|baek|heo|nam|noh|roh|ha|kwak|sung|cha|joo|woo|min|ryu|na|jin|ji|eom|chae|won|cheon|bang|gong|hyun|ham|byun|yeom|yeo|choo|do|seok|sun|so|seol|ma|gil|wi|pyo|myung|ki|ban|ra|wang|geum|ok|yook|in|maeng|je|mo|nam|tak|kook|yeo|jin|eo|eun|pyeon|yong";
const INITIALS_SURNAME_RE = new RegExp(
  `^[a-z]{1,3}(?:${KOREAN_SURNAMES})\\d*$`
);
const NAME_DOT_RE = /^[a-z]{2,}[._][a-z]{2,}\d*$/;

export function looksPersonalEmail(email: string): boolean {
  const local = (email.split("@")[0] ?? "").toLowerCase();
  if (ROLE_WORD_RE.test(local)) {
    return false;
  }
  return NAME_DOT_RE.test(local) || INITIALS_SURNAME_RE.test(local);
}

export function mergeSightings(
  sightings: Sighting[],
  ctx: DomainContext
): ContactEmailCandidate[] {
  const byEmail = new Map<string, Sighting[]>();
  for (const s of sightings) {
    byEmail.set(s.email, [...(byEmail.get(s.email) ?? []), s]);
  }
  const out: ContactEmailCandidate[] = [];
  for (const [email, list] of byEmail) {
    const best = bestSighting(list);
    const emailDomain = email.split("@")[1] ?? "";
    const sameDomain = isSameDomain(emailDomain, ctx);
    const free = FREE_MAIL_DOMAINS.has(emailDomain);
    let confidence: ContactConfidence = "low";
    if (best.role !== "other") {
      confidence = best.roleFrom === "label" && !free ? "high" : "medium";
    }
    out.push({
      confidence,
      email,
      fetchedAt: best.fetchedAt,
      label: best.label,
      personalName: looksPersonalEmail(email),
      role: best.role,
      sameDomain,
      sourceUrl: best.sourceUrl,
    });
  }
  return out.sort(compareCandidates);
}

/**
 * 영업 발송용 첫 후보 — 개인정보보호책임자 주소와 사람 이름 주소는 자동으로 고르지 않는다.
 * 무료메일(gmail 등)이라도 용도(제휴·해외 문의)가 맞으면 순서대로 앞에 온다(대표 결정 2026-10-07).
 * 남은 게 사람 이름 주소뿐이면 null — 사람이 후보 목록에서 직접 고른다.
 */
export function pickSalesContact(
  candidates: ContactEmailCandidate[]
): ContactEmailCandidate | null {
  return (
    candidates.find((c) => c.role !== "privacy" && !c.personalName) ?? null
  );
}

/** 후보 → 수신 근거 ④ public_contact(공개 페이지 주소 + 확인 날짜). */
export function publicContactBasis(
  candidate: ContactEmailCandidate
): ContactBasis {
  return {
    date: seoulToday(new Date(candidate.fetchedAt)),
    detail: `${candidate.sourceUrl} 에 공개된 회사 메일(${candidate.email}${candidate.label ? `, 표시: ${candidate.label}` : ""})`,
    kind: "public_contact",
  };
}

// ── 링크 고르기 ──

interface LinkCandidate {
  hint: ContactRole | null;
  key: string;
  score: number;
  url: URL;
}

/** <a> 하나 → 같은 사이트의 문의·제휴·회사소개 후보(아니면 null). */
function linkCandidate(
  href: string,
  inner: string,
  pageUrl: URL,
  isAllowedHost: (host: string) => boolean
): LinkCandidate | null {
  let url: URL;
  try {
    url = new URL(decodeEntities(href).trim(), pageUrl);
  } catch {
    return null;
  }
  url.hash = "";
  const key = url.toString();
  if (
    !(
      (url.protocol === "https:" || url.protocol === "http:") &&
      isAllowedHost(url.host)
    ) ||
    key === pageUrl.toString()
  ) {
    return null;
  }
  let path = url.pathname + url.search;
  try {
    path = decodeURIComponent(path);
  } catch {
    /* 원문 사용 */
  }
  if (SKIP_PATH_RE.test(path)) {
    return null;
  }
  const anchorText = htmlToText(inner);
  const haystack = `${path} ${anchorText}`;
  let score = 0;
  if (LINK_STRONG_RE.test(haystack)) {
    score = 2;
  } else if (LINK_WEAK_RE.test(haystack)) {
    score = 1;
  }
  if (score === 0) {
    return null;
  }
  // 링크 글자가 「제휴」류면 그 페이지의 라벨 없는 주소를 제휴용으로 본다(신뢰도 medium).
  const hint =
    roleFromLabel(anchorText) === "partnership" ? "partnership" : null;
  return { hint, key, score, url };
}

/** 홈페이지 링크 중 문의·제휴·회사소개로 보이는 같은 사이트 페이지(점수순). */
export function discoverContactPages(
  html: string,
  pageUrl: URL,
  isAllowedHost: (host: string) => boolean
): { hint: ContactRole | null; url: URL }[] {
  const found = new Map<string, LinkCandidate>();
  for (const match of html.matchAll(ANCHOR_RE)) {
    const candidate = linkCandidate(
      match[1] ?? "",
      match[2] ?? "",
      pageUrl,
      isAllowedHost
    );
    if (candidate && !found.has(candidate.key)) {
      found.set(candidate.key, candidate);
    }
  }
  return [...found.values()]
    .sort((a, b) => b.score - a.score)
    .map(({ hint, url }) => ({ hint, url }));
}

// ── 가져오기 ──

type PageFetch =
  | { kind: "ok"; html: string; url: URL }
  | { kind: "robots"; url: URL }
  | { kind: "fail"; reason: string };

interface CrawlState {
  allowedHosts: Set<string>;
  assertUrl: (url: URL) => Promise<void>;
  deadline: number;
  fetchImpl: typeof fetch;
  outer?: AbortSignal;
  robots: Map<string, string[] | "unreachable">;
}

function fetchSignal(state: CrawlState): AbortSignal | null {
  const remaining = state.deadline - Date.now();
  if (remaining <= 0 || state.outer?.aborted) {
    return null;
  }
  const timeout = AbortSignal.timeout(
    Math.min(PER_FETCH_TIMEOUT_MS, remaining)
  );
  return state.outer ? AbortSignal.any([state.outer, timeout]) : timeout;
}

async function readBody(response: Response): Promise<string> {
  const buffer = await response.arrayBuffer();
  const head = new TextDecoder("utf-8").decode(buffer.slice(0, 4096));
  const charset =
    CHARSET_HEADER_RE.exec(response.headers.get("content-type") ?? "")?.[1] ??
    CHARSET_META_RE.exec(head)?.[1] ??
    "utf-8";
  let text: string;
  try {
    text = new TextDecoder(charset.toLowerCase()).decode(buffer);
  } catch {
    text = new TextDecoder("utf-8").decode(buffer);
  }
  return text.slice(0, MAX_BODY_CHARS);
}

async function robotsFor(
  url: URL,
  state: CrawlState
): Promise<string[] | "unreachable"> {
  const cached = state.robots.get(url.origin);
  if (cached) {
    return cached;
  }
  const signal = fetchSignal(state);
  let result: string[] | "unreachable" = "unreachable";
  if (signal) {
    try {
      const robotsUrl = new URL("/robots.txt", url.origin);
      await state.assertUrl(robotsUrl);
      const response = await state.fetchImpl(robotsUrl, {
        cache: "no-store",
        headers: { accept: "text/plain", "user-agent": USER_AGENT },
        redirect: "follow",
        signal,
      });
      if (response.ok) {
        result = parseRobotsDisallow(await readBody(response));
      } else if (response.status >= 400 && response.status < 500) {
        result = []; // 4xx = robots.txt 없음 → 제한 없음(RFC 9309)
      }
    } catch {
      result = "unreachable";
    }
  }
  state.robots.set(url.origin, result);
  return result;
}

/** hop 마다: 사이트 범위 → robots → 예산. 통과하면 null. */
async function hopGate(
  url: URL,
  state: CrawlState,
  adoptOffSite: boolean
): Promise<Exclude<PageFetch, { kind: "ok" }> | null> {
  if (!state.allowedHosts.has(url.host)) {
    if (!adoptOffSite) {
      return { kind: "fail", reason: "off_site_redirect" };
    }
    // 홈페이지가 다른 도메인으로 옮겨 간 경우만 그 도메인을 이 회사 사이트로 받아들인다.
    const bare = bareHost(url.host);
    state.allowedHosts.add(bare).add(`www.${bare}`);
  }
  const robots = await robotsFor(url, state);
  if (robots === "unreachable") {
    return { kind: "fail", reason: "robots_unreachable" };
  }
  if (!isAllowedByRobots(url.pathname + url.search, robots)) {
    return { kind: "robots", url };
  }
  return null;
}

async function requestOnce(
  url: URL,
  state: CrawlState
): Promise<Response | Exclude<PageFetch, { kind: "ok" }>> {
  const signal = fetchSignal(state);
  if (!signal) {
    return { kind: "fail", reason: "budget_exhausted" };
  }
  try {
    await state.assertUrl(url);
    return await state.fetchImpl(url, {
      cache: "no-store",
      headers: {
        accept: "text/html,application/xhtml+xml",
        "accept-language": "ko,en;q=0.8",
        "user-agent": USER_AGENT,
      },
      redirect: "manual",
      signal,
    });
  } catch {
    return { kind: "fail", reason: "network" };
  }
}

/** 한 페이지 가져오기 — 리다이렉트를 직접 따라가며 hop 마다 사이트·robots·공개주소를 다시 확인. */
async function fetchPage(
  start: URL,
  state: CrawlState,
  adoptOffSite: boolean
): Promise<PageFetch> {
  let url = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    // 리다이렉트 hop 은 앞 응답이 있어야 다음 주소를 알므로 순서대로 기다린다.
    const blocked = await hopGate(url, state, adoptOffSite);
    if (blocked) {
      return blocked;
    }
    const response = await requestOnce(url, state);
    if (!(response instanceof Response)) {
      return response;
    }
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      try {
        url = new URL(location, url);
      } catch {
        return { kind: "fail", reason: "bad_redirect" };
      }
      continue;
    }
    if (!response.ok) {
      return { kind: "fail", reason: `http_${response.status}` };
    }
    const type = response.headers.get("content-type") ?? "text/html";
    if (!HTML_TYPE_RE.test(type)) {
      return { kind: "fail", reason: "not_html" };
    }
    return { html: await readBody(response), kind: "ok", url };
  }
  return { kind: "fail", reason: "too_many_redirects" };
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true }
    );
  });
}

interface PageVisit {
  hint: ContactRole | null;
  url: URL;
}

interface CrawlOutcome {
  /** 페이지 요청 횟수(실패 포함, robots.txt 제외) — MAX_PAGES 상한 */
  attempts: number;
  checkedUrls: string[];
  refused: boolean;
  sightings: Sighting[];
  skippedReason?: string;
}

/** 홈페이지 다음 페이지들을 순서대로 — 거부 게시가 보이면 바로 멈춘다. */
async function crawlRest(
  queue: PageVisit[],
  state: CrawlState,
  ctx: DomainContext,
  deps: { delayMs: number; now: () => Date },
  outcome: CrawlOutcome
): Promise<void> {
  const visited = new Set(outcome.checkedUrls);
  for (const page of queue) {
    if (outcome.attempts >= MAX_PAGES) {
      return;
    }
    if (visited.has(page.url.toString())) {
      continue;
    }
    visited.add(page.url.toString());
    // 상대 서버 부담을 줄이려고 일부러 순서대로·간격을 둔다(병렬 금지).
    await sleep(deps.delayMs, state.outer);
    const result = await fetchPage(page.url, state, false);
    if (result.kind !== "robots") {
      outcome.attempts += 1;
    }
    if (result.kind === "fail" && result.reason === "budget_exhausted") {
      outcome.skippedReason = "budget_exhausted";
      return;
    }
    if (result.kind !== "ok") {
      continue;
    }
    // 다른 링크가 같은 최종 주소로 리다이렉트된 경우 두 번 세지 않는다.
    if (
      visited.has(result.url.toString()) &&
      result.url.toString() !== page.url.toString()
    ) {
      continue;
    }
    visited.add(result.url.toString());
    outcome.checkedUrls.push(result.url.toString());
    if (hasCollectionRefusal(result.html)) {
      outcome.refused = true;
      return;
    }
    const fetchedAt = deps.now().toISOString();
    for (const occ of extractOccurrences(result.html, ctx, page.hint)) {
      outcome.sightings.push({
        ...occ,
        fetchedAt,
        sourceUrl: result.url.toString(),
      });
    }
  }
}

/**
 * 홈페이지 — https://도메인 → https://www → http://www 순서. 다음 후보로 넘어가는 건
 * 접속 자체가 안 될 때뿐(robots 금지·HTTP 오류는 그 사이트의 답으로 보고 멈춘다).
 * 예: drg.co.kr 은 443 포트가 닫혀 있다(2026-10-07 실측).
 */
async function fetchHomepage(
  bare: string,
  state: CrawlState
): Promise<PageFetch> {
  const starts = [
    `https://${bare}/`,
    `https://www.${bare}/`,
    `http://www.${bare}/`,
  ];
  let last: PageFetch = { kind: "fail", reason: "network" };
  for (const start of starts) {
    // 앞 후보가 실패해야 다음을 시도하므로 순서대로.
    last = await fetchPage(new URL(start), state, true);
    const retryable =
      last.kind === "fail" &&
      (last.reason === "network" || last.reason === "robots_unreachable");
    if (!retryable) {
      return last;
    }
  }
  return last;
}

function homepageFailure(
  result: Exclude<PageFetch, { kind: "ok" }>
): ContactEmailResult {
  if (result.kind === "robots") {
    return {
      candidates: [],
      checkedUrls: [],
      skippedReason: "robots_disallow_homepage",
      status: "blocked_by_robots",
    };
  }
  return {
    candidates: [],
    checkedUrls: [],
    skippedReason: result.reason,
    status: "unavailable",
  };
}

/**
 * 회사 홈페이지에서 공개 연락 메일 후보를 찾는다. throw 하지 않는다.
 * 순서: robots.txt → 홈페이지(푸터 사업자정보) → 홈페이지 링크 중 문의·제휴·회사소개(최대 5쪽).
 */
export async function findContactEmails(
  input: FindContactEmailsInput,
  deps: FindContactEmailsDeps = {}
): Promise<ContactEmailResult> {
  const bare = bareHost(input.domain);
  if (!bare.includes(".")) {
    return {
      candidates: [],
      checkedUrls: [],
      skippedReason: "invalid_domain",
      status: "skipped",
    };
  }
  const state: CrawlState = {
    allowedHosts: new Set([bare, `www.${bare}`]),
    assertUrl: deps.assertUrl ?? assertPublicUrl,
    deadline: Date.now() + TOTAL_BUDGET_MS,
    fetchImpl: deps.fetchImpl ?? fetch,
    outer: input.signal,
    robots: new Map(),
  };
  const now = deps.now ?? (() => new Date());
  const ctx: DomainContext = {
    // 사이트 이름(purito.com → purito)도 브랜드 토큰 — purito.co.kr 같은 다른 TLD 회사 메일을 같은 회사로 본다.
    brandTokens: brandTokens([
      ...(input.brandNames ?? []),
      bare.split(".")[0] ?? "",
    ]),
    siteDomains: [bare],
  };

  const home = await fetchHomepage(bare, state);
  if (home.kind !== "ok") {
    log.warn("[ax-mail:contact-email] homepage unavailable", {
      reason: home.kind === "fail" ? home.reason : "robots",
    });
    return homepageFailure(home);
  }
  // 홈페이지가 옮겨 간 도메인도 「같은 회사 도메인」으로 본다.
  const homeBare = bareHost(home.url.host);
  if (homeBare !== bare) {
    ctx.siteDomains.push(homeBare);
  }
  const outcome: CrawlOutcome = {
    attempts: 1,
    checkedUrls: [home.url.toString()],
    refused: hasCollectionRefusal(home.html),
    sightings: [],
  };
  if (!outcome.refused) {
    const fetchedAt = now().toISOString();
    for (const occ of extractOccurrences(home.html, ctx)) {
      outcome.sightings.push({
        ...occ,
        fetchedAt,
        sourceUrl: home.url.toString(),
      });
    }
    const queue = discoverContactPages(home.html, home.url, (host) =>
      state.allowedHosts.has(host)
    );
    await crawlRest(
      queue,
      state,
      ctx,
      { delayMs: deps.delayMs ?? DEFAULT_DELAY_MS, now },
      outcome
    );
  }
  if (outcome.refused) {
    return {
      candidates: [],
      checkedUrls: outcome.checkedUrls,
      skippedReason: "email_collection_refused",
      status: "refused",
    };
  }
  const candidates = mergeSightings(outcome.sightings, ctx);
  return {
    candidates,
    checkedUrls: outcome.checkedUrls,
    ...(outcome.skippedReason ? { skippedReason: outcome.skippedReason } : {}),
    status: candidates.length > 0 ? "ok" : "none",
  };
}
