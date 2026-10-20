/**
 * 사이트 읽기 정책 보조(2026-10-19) — 인증서 형제 호스트 · 읽기 방법 기록.
 * 순수 함수만 둔다(네트워크 없음) — 정책 판정을 시험으로 고정하려는 분리다.
 */

const ON_VALUES = new Set(["1", "true"]);
const isOn = (value: string | undefined): boolean =>
  ON_VALUES.has((value ?? "").trim().toLowerCase());

/** 사이트를 읽은 방법. `plain` 은 아래 어느 것도 아닌 일반 읽기. */
export type SiteReadMethod =
  | "cert_sibling_host"
  | "http_fallback"
  | "image_text"
  | "plain"
  | "render";

// ── 인증서 형제 호스트 ────────────────────────────────────────────────────────────────────────
export function isCertSiblingFlagOn(
  env: Record<string, string | undefined> = process.env
): boolean {
  return isOn(env.SITE_CERT_SIBLING_HOST_ENABLED);
}

const DNS_PREFIX_RE = /^DNS:/i;
const ALTNAMES_RE = /cert'?s? altnames:\s*(.+)$/i;
const MAX_SIBLING_CANDIDATES = 3;

/** Node 의 인증서 불일치 오류 문구에서 인증서가 가진 이름(DNS:…)을 읽는다. 와일드카드(`*.base`)는 base·www.base 후보로 푼다. */
export function parseCertAltNames(message: string): string[] {
  const tail = ALTNAMES_RE.exec(message)?.[1] ?? "";
  const out = new Set<string>();
  for (const part of tail.split(",")) {
    const name = part.trim().replace(DNS_PREFIX_RE, "").toLowerCase();
    if (!name || name.includes(" ")) {
      continue;
    }
    if (name.startsWith("*.")) {
      const base = name.slice(2);
      out.add(base);
      out.add(`www.${base}`);
    } else {
      out.add(name);
    }
  }
  return [...out];
}

const TWO_LABEL_SLD = new Set([
  "co",
  "or",
  "go",
  "ne",
  "re",
  "ac",
  "pe",
  "com",
]);

/** 등록 도메인 근사(co.kr 같은 2단 접미사만 처리) — 같은 사이트 가족인지 보는 용도. */
export function registrableDomain(host: string): string {
  const labels = host.toLowerCase().split(".").filter(Boolean);
  if (labels.length <= 2) {
    return labels.join(".");
  }
  const last = labels.at(-1) ?? "";
  const second = labels.at(-2) ?? "";
  const keep = last.length === 2 && TWO_LABEL_SLD.has(second) ? 3 : 2;
  return labels.slice(-keep).join(".");
}

/**
 * 인증서의 다른 유효 이름 중 **같은 가족(같은 등록 도메인)** 의 호스트만 후보로 돌려준다(최대 3개, 요청 호스트 자신 제외).
 * 다른 회사 이름이 한 인증서에 섞여 있는 경우(공용 호스팅)를 같은 사이트로 착각하지 않으려는 거름이다.
 */
export function siblingHostCandidates(
  requestedHost: string,
  altNames: readonly string[]
): string[] {
  const family = registrableDomain(requestedHost);
  const self = requestedHost.toLowerCase();
  return altNames
    .filter((name) => name !== self && registrableDomain(name) === family)
    .slice(0, MAX_SIBLING_CANDIDATES);
}

// ── 읽기 방법 ────────────────────────────────────────────────────────────────────────────────
/** 사용한 읽기 방법 목록(중복 없음). 특별한 방법이 없으면 `["plain"]`. */
export function readMethods(used: {
  certSiblingHost?: boolean;
  httpFallback?: boolean;
  imageText?: boolean;
  render?: boolean;
}): SiteReadMethod[] {
  const out: SiteReadMethod[] = [];
  if (used.certSiblingHost) {
    out.push("cert_sibling_host");
  }
  if (used.httpFallback) {
    out.push("http_fallback");
  }
  if (used.render) {
    out.push("render");
  }
  if (used.imageText) {
    out.push("image_text");
  }
  return out.length > 0 ? out : ["plain"];
}
