import { log } from "@repo/observability/log";
import { assertPublicUrl, normalizePublicUrl } from "./public-url-security";

const FETCH_TIMEOUT_MS = 20_000;
const MAX_REDIRECTS = 3;
const MAX_RESPONSE_BYTES = 1_000_000;
/** 푸터 사업자 정보를 찾느라 더 읽는 상한(전체 바이트). 넘으면 찾은 데까지로 끝낸다. */
const FOOTER_SEARCH_BYTES = 600_000;
const USER_AGENT =
  "FindableMeasurementBot/1.0 (+https://www.findable.co.kr/ko/contact)";
const BODY_PARAGRAPH_RE = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
const META_TAG_RE = /<meta\b[^>]*>/gi;
const META_NAME_RE = /(?:name|property)\s*=\s*["']([^"']+)["']/i;
const META_CONTENT_RE = /content\s*=\s*["']([^"']*)["']/i;
const HEAD_CLOSED_RE = /<\/head\s*>/i;
const SENTENCE_END_RE = /[.!?。！？]/;
const NON_VISIBLE_BLOCK_RE =
  /<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;

export interface OfficialSiteIdentity {
  /** 사업자등록번호(000-00-00000). 한국 통신판매 사이트는 푸터 게시가 의무다. */
  businessNumber?: string | null;
  description: string | null;
  finalUrl: string;
  h1: string | null;
  /**
   * 푸터의 상호·회사명(예: 「바이오센서연구소(주)」, 2026-10-05). 브랜드명이 흔한 단어일 때
   * 「같은 회사」임을 가르는 가장 강한 공식 사실이다. 판정 v3 의 근거로만 쓴다.
   */
  legalName?: string | null;
  siteName: string | null;
  title: string | null;
}

const BUSINESS_NUMBER_RE =
  /사업자\s*등록\s*번호\s*[:：]?\s*(\d{3}-\d{2}-\d{5})/;
const LEGAL_NAME_RE =
  /(?:상호(?:명)?|회사명|법인명|업체명)\s*[:：]\s*([^\n|:：]{2,60}?)(?=\s*(?:\||대표|사업자|주소|전화|tel|통신판매|개인정보|이메일|e-?mail|$))/i;
const LEGAL_NAME_MAX_LENGTH = 40;

/** 푸터 사업자 정보 — 보이는 글자에서만 읽는다(주석·스크립트 제외). */
export function extractBusinessInfo(contentHtml: string): {
  businessNumber: string | null;
  legalName: string | null;
} {
  const text = decodeEntities(
    contentHtml
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(br|\/p|\/div|\/li|\/span|\/dd|\/dt)\b[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/[ \t ]+/g, " ")
    .replace(/\n\s*/g, "\n");
  const legal = text.match(LEGAL_NAME_RE)?.[1]?.trim() ?? "";
  return {
    businessNumber: text.match(BUSINESS_NUMBER_RE)?.[1] ?? null,
    legalName: legal && legal.length <= LEGAL_NAME_MAX_LENGTH ? legal : null,
  };
}

/** 고객이 앱에서 직접 입력한 공식 정보(Brand.legalName·businessNumber, 2026-10-06). */
export interface CustomerIdentityInput {
  businessNumber?: string | null;
  legalName?: string | null;
}

const CUSTOMER_LEGAL_NAME_MIN = 2;
const CUSTOMER_LEGAL_NAME_MAX = 60;
const NON_DIGIT_RE = /\D/g;

/** 상호: 앞뒤 공백만 걷고 ㈜·(주)·주식회사 등은 그대로 둔다. 2~60자가 아니면 없는 값. */
export function normalizeCustomerLegalName(
  value: string | null | undefined
): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed.length >= CUSTOMER_LEGAL_NAME_MIN &&
    trimmed.length <= CUSTOMER_LEGAL_NAME_MAX
    ? trimmed
    : null;
}

/** 사업자등록번호: 숫자 10자리만 받아 000-00-00000 으로 맞춘다. 아니면 없는 값. */
export function normalizeCustomerBusinessNumber(
  value: string | null | undefined
): string | null {
  const digits = (value ?? "").replace(NON_DIGIT_RE, "");
  if (digits.length !== 10) {
    return null;
  }
  return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
}

/**
 * 고객 입력 > 푸터 추출값, **필드별로** 합친다. 고객 값이 없거나 형식이 틀리면 푸터 값을
 * 그대로 쓰고, 둘 다 없으면 원래 객체를 그대로 돌려준다(키도 새로 만들지 않는다).
 * 판정기의 상호·사업자번호 앵커(hasRegisteredEntityAnchor·판정 v3)가 이 값을 읽는다.
 */
export function mergeCustomerIdentity(
  site: OfficialSiteIdentity,
  customer: CustomerIdentityInput | null | undefined
): OfficialSiteIdentity {
  const legalName = normalizeCustomerLegalName(customer?.legalName);
  const businessNumber = normalizeCustomerBusinessNumber(
    customer?.businessNumber
  );
  if (!(legalName || businessNumber)) {
    return site;
  }
  return {
    ...site,
    ...(legalName ? { legalName } : {}),
    ...(businessNumber ? { businessNumber } : {}),
  };
}

/**
 * Some otherwise public sites return a bot challenge or an empty HTML shell to
 * serverless fetchers. A signed-in customer has already confirmed the domain,
 * name, industry, and market before an organisation measurement is created.
 *
 * This intentionally contains no invented page evidence: callers must expose
 * that it is a registration fallback (`identityGrounded: false`). It is never
 * available to an anonymous/free audit, where that confirmation does not exist.
 */
export function registeredBrandIdentityFallback(input: {
  brandId?: string;
  brandName?: string;
  domain: string;
}): OfficialSiteIdentity | null {
  if (!(input.brandId && input.brandName?.trim())) {
    return null;
  }
  return {
    description: null,
    finalUrl: input.domain,
    h1: null,
    siteName: null,
    title: null,
  };
}

export function extractOfficialSiteIdentity(
  html: string,
  finalUrl: string
): OfficialSiteIdentity | null {
  // A server-rendered template can contain literal HTML-looking strings inside
  // script/style blocks. They are not visible site evidence and must not be
  // accepted as the brand's description or heading.
  const contentHtml = html.replace(NON_VISIBLE_BLOCK_RE, "");
  const identity = {
    finalUrl,
    title: tagText(contentHtml, "title"),
    description:
      metaContent(contentHtml, "description") ??
      metaContent(contentHtml, "og:description") ??
      bodyDescription(contentHtml),
    h1: tagText(contentHtml, "h1"),
    siteName: metaContent(contentHtml, "og:site_name"),
    ...extractBusinessInfo(contentHtml),
  };
  return identity.title ||
    identity.description ||
    identity.h1 ||
    identity.siteName
    ? identity
    : null;
}

/** A short visible service statement is better evidence than a generic title. */
function bodyDescription(html: string): string | null {
  const visibleHtml = html.replace(NON_VISIBLE_BLOCK_RE, "");
  for (const match of visibleHtml.matchAll(BODY_PARAGRAPH_RE)) {
    const value = plainText(match[1]);
    // Ignore navigation labels and slogan fragments; require a sentence.
    if (
      value.length >= 24 &&
      value.length <= 350 &&
      SENTENCE_END_RE.test(value)
    ) {
      return value.slice(0, 250);
    }
  }
  return null;
}

function decodeEntities(value: string): string {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function plainText(value: string): string {
  return decodeEntities(value.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function tagText(html: string, tag: string): string | null {
  const match = html.match(
    new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i")
  );
  const value = plainText(match?.[1] ?? "");
  return value || null;
}

function metaContent(html: string, key: string): string | null {
  for (const match of html.matchAll(META_TAG_RE)) {
    const tag = match[0];
    const name = tag.match(META_NAME_RE)?.[1];
    if (name?.toLowerCase() !== key.toLowerCase()) {
      continue;
    }
    const content = tag.match(META_CONTENT_RE)?.[1] ?? "";
    return plainText(content) || null;
  }
  return null;
}

/** Read only enough of a potentially large homepage to identify its brand. */
export async function readIdentityHtml(
  response: Response,
  signal?: AbortSignal
): Promise<string> {
  if (!response.body) {
    return "";
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  const cancel = () => {
    reader.cancel().catch(() => undefined);
  };
  signal?.addEventListener("abort", cancel, { once: true });
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    const remaining = MAX_RESPONSE_BYTES - bytes;
    const chunk = value.subarray(0, remaining);
    bytes += chunk.byteLength;
    text += decoder.decode(chunk, { stream: true });
    // A generic title with no description is insufficient for entity matching.
    // Keep reading the bounded body to find a visible service statement.
    if (
      HEAD_CLOSED_RE.test(text) &&
      (metaContent(text, "description") ||
        metaContent(text, "og:description")) &&
      extractOfficialSiteIdentity(text, "")
    ) {
      await reader.cancel().catch(() => undefined);
      return text + decoder.decode();
    }
    if (bytes >= MAX_RESPONSE_BYTES) {
      await reader.cancel().catch(() => undefined);
      if (extractOfficialSiteIdentity(text, "")) {
        return text + decoder.decode();
      }
      throw new Error("RESPONSE_TOO_LARGE");
    }
  }
  signal?.removeEventListener("abort", cancel);
  return text + decoder.decode();
}

/** 푸터를 더 읽을 시간 상한 — 넘기면 오류 없이 그때까지 읽은 데서 끝낸다. */
const FOOTER_SEARCH_MS = 3000;

/** 식별 구간 뒤에서 푸터 상호를 찾는다. 600KB(전체)·3초를 넘기면 오류 없이 멈춘다. */
async function readFooter(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  decoder: TextDecoder,
  startBytes: number
): Promise<string> {
  let bytes = startBytes;
  let footer = "";
  const deadline = Date.now() + FOOTER_SEARCH_MS;
  while (
    bytes < FOOTER_SEARCH_BYTES &&
    !extractBusinessInfo(footer.replace(NON_VISIBLE_BLOCK_RE, "")).legalName
  ) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      break;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    let next: ReadableStreamReadResult<Uint8Array> | null;
    try {
      next = await Promise.race([
        reader.read(),
        new Promise<null>((resolve) => {
          timer = setTimeout(() => resolve(null), remainingMs);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
    if (!next || next.done) {
      break;
    }
    const chunk = next.value.subarray(0, FOOTER_SEARCH_BYTES - bytes);
    bytes += chunk.byteLength;
    footer += decoder.decode(chunk, { stream: true });
  }
  return footer;
}

/**
 * 판정용 식별 정보(title·description·H1·siteName)는 **기존과 똑같이** `readIdentityHtml`
 * 이 멈추던 지점까지에서만 읽고(v2 판정 입력 불변 — 컨트롤타워 검증 2026-10-05 지적),
 * 그 뒤로는 푸터의 상호·사업자번호만 찾는다. 추가 읽기는 600KB·3초 상한, 넘으면 조용히 멈춘다.
 */
export async function readIdentityAndFooter(
  response: Response,
  signal?: AbortSignal
): Promise<{ footerHtml: string; html: string }> {
  if (!response.body) {
    return { html: "", footerHtml: "" };
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  const cancel = () => {
    reader.cancel().catch(() => undefined);
  };
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    // 1단계 — readIdentityHtml 과 같은 규칙으로 식별 정보 구간을 정한다.
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        const html = text + decoder.decode();
        return { html, footerHtml: "" };
      }
      const chunk = value.subarray(0, MAX_RESPONSE_BYTES - bytes);
      bytes += chunk.byteLength;
      text += decoder.decode(chunk, { stream: true });
      if (
        HEAD_CLOSED_RE.test(text) &&
        (metaContent(text, "description") ||
          metaContent(text, "og:description")) &&
        extractOfficialSiteIdentity(text, "")
      ) {
        break;
      }
      if (bytes >= MAX_RESPONSE_BYTES) {
        if (extractOfficialSiteIdentity(text, "")) {
          return { html: text + decoder.decode(), footerHtml: "" };
        }
        throw new Error("RESPONSE_TOO_LARGE");
      }
    }
    const html = text;
    // 2단계 — 푸터만 찾는다(식별 정보에는 섞지 않는다).
    // 푸터 읽기 중 바깥 타임아웃·중단이 와도 이미 확보한 식별 구간은 버리지 않는다.
    const footerHtml = await readFooter(reader, decoder, bytes).catch(() => "");
    return { html, footerHtml };
  } finally {
    await reader.cancel().catch(() => undefined);
    signal?.removeEventListener("abort", cancel);
  }
}

async function fetchHomepage(
  initialUrl: URL,
  parentSignal?: AbortSignal
): Promise<{ footerHtml: string; html: string; finalUrl: URL }> {
  let current = new URL(initialUrl);
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    await assertPublicUrl(current);
    const controller = new AbortController();
    const abortFromParent = () =>
      controller.abort(
        parentSignal?.reason ?? new DOMException("Aborted", "AbortError")
      );
    if (parentSignal?.aborted) {
      abortFromParent();
    } else {
      parentSignal?.addEventListener("abort", abortFromParent, { once: true });
    }
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(current, {
        cache: "no-store",
        headers: {
          accept: "text/html,application/xhtml+xml",
          "user-agent": USER_AGENT,
        },
        redirect: "manual",
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timeout);
      throw error;
    }
    try {
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location || redirect === MAX_REDIRECTS) {
          throw new Error("REDIRECT_FAILED");
        }
        current = new URL(location, current);
        continue;
      }
      if (!(response.status >= 200 && response.status < 300)) {
        throw new Error(`HTTP_${response.status}`);
      }
      const contentType =
        response.headers.get("content-type")?.toLowerCase() ?? "";
      if (!contentType.includes("text/html")) {
        throw new Error("NOT_HTML");
      }
      const { html, footerHtml } = await readIdentityAndFooter(
        response,
        controller.signal
      );
      return { html, footerHtml, finalUrl: current };
    } finally {
      clearTimeout(timeout);
      parentSignal?.removeEventListener("abort", abortFromParent);
    }
  }
  throw new Error("REDIRECT_FAILED");
}

/**
 * 언급 판정용 공식 엔티티 단서를 홈페이지에서 한 번만 확보한다.
 * 실패 시 null을 반환한다. 호출자는 식별 근거 없이는 측정을 중단한다.
 */
export async function resolveOfficialSiteIdentity(
  domain: string,
  signal?: AbortSignal
): Promise<OfficialSiteIdentity | null> {
  try {
    if (signal?.aborted) {
      throw signal.reason ?? new DOMException("Aborted", "AbortError");
    }
    const { html, footerHtml, finalUrl } = await fetchHomepage(
      normalizePublicUrl(domain),
      signal
    );
    const identity = extractOfficialSiteIdentity(html, finalUrl.toString());
    if (!identity) {
      throw new Error("IDENTITY_EMPTY");
    }
    if (footerHtml && !(identity.legalName && identity.businessNumber)) {
      const footer = extractBusinessInfo(
        footerHtml.replace(NON_VISIBLE_BLOCK_RE, "")
      );
      return {
        ...identity,
        legalName: identity.legalName ?? footer.legalName,
        businessNumber: identity.businessNumber ?? footer.businessNumber,
      };
    }
    return identity;
  } catch (error) {
    if (signal?.aborted) {
      throw signal.reason ?? error;
    }
    log.warn("audit.official_site_identity.failed", {
      domain,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
