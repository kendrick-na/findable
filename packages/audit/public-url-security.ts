import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const BLOCKED_HOST_SUFFIXES = [".local", ".internal", ".localhost"];
const ALLOWED_PORTS = new Set(["", "80", "443"]);
const IPV6_LINK_LOCAL_RE = /^fe[89ab]/;
const HTTP_PROTOCOL_RE = /^https?:\/\//i;
const TRAILING_DOT_RE = /\.$/;

function parseIpv4(address: string): number[] | null {
  const parts = address.split(".").map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return null;
  }
  return parts;
}

function isPrivateIpv4Parts(ipv4: number[]): boolean {
  const [a = 0, b = 0] = ipv4;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

const HEXTET_RE = /^[0-9a-f]{1,4}$/;

function parseHextets(part: string): number[] | null {
  if (part === "") {
    return [];
  }
  const out: number[] = [];
  for (const piece of part.split(":")) {
    if (!HEXTET_RE.test(piece)) {
      return null;
    }
    out.push(Number.parseInt(piece, 16));
  }
  return out;
}

/** IPv6 문자열을 16비트 8칸으로 푼다(축약 `::`·끝의 점 표기 IPv4 포함). 못 풀면 null. */
function parseIpv6(address: string): number[] | null {
  let text = address;
  const tail: number[] = [];
  const lastColon = text.lastIndexOf(":");
  if (text.slice(lastColon + 1).includes(".")) {
    const v4 = parseIpv4(text.slice(lastColon + 1));
    if (!v4) {
      return null;
    }
    const [p = 0, q = 0, r = 0, s = 0] = v4;
    tail.push(p * 256 + q, r * 256 + s);
    // "::1.2.3.4" 처럼 점 표기 바로 앞이 "::" 이면 콜론 하나를 남긴다.
    text = text.slice(0, lastColon + 1);
    text = text.endsWith("::") ? text : text.slice(0, -1);
  }
  const halves = text.split("::");
  if (halves.length > 2) {
    return null;
  }
  const head = parseHextets(halves[0] ?? "");
  const rest = halves.length === 2 ? parseHextets(halves[1] ?? "") : [];
  if (!(head && rest)) {
    return null;
  }
  const given = head.length + rest.length + tail.length;
  if (halves.length === 2 ? given > 7 : given !== 8) {
    return null;
  }
  const zeros = new Array<number>(8 - given).fill(0);
  return [...head, ...zeros, ...rest, ...tail];
}

function ipv4FromHextets(high: number, low: number): number[] {
  return [Math.floor(high / 256), high % 256, Math.floor(low / 256), low % 256];
}

/**
 * IPv6 안에 IPv4 가 들어가는 변환 주소(NAT64·6to4·Teredo·IPv4 호환/매핑/변환)와
 * 사설·특수 대역을 16비트 칸 단위로 판정한다. 기존 문자열 판정에 **덧붙이기만** 한다(허용 범위는 넓히지 않는다).
 */
function isPrivateIpv6Hextets(h: number[]): boolean {
  const [h0 = 0, h1 = 0, h2 = 0, h3 = 0, h4 = 0, h5 = 0, h6 = 0, h7 = 0] = h;
  const embeddedLow = ipv4FromHextets(h6, h7);
  const upperZero = h0 === 0 && h1 === 0 && h2 === 0 && h3 === 0;
  // ::/96 (미지정·루프백·IPv4 호환 ::a.b.c.d — 폐지된 형식이라 공개 대상이어도 통째로 막는다)
  if (upperZero && h4 === 0 && h5 === 0) {
    return true;
  }
  // ::ffff:0:0/96 (IPv4 매핑) — 안의 IPv4 로 판정
  if (upperZero && h4 === 0 && h5 === 0xff_ff) {
    return isPrivateIpv4Parts(embeddedLow);
  }
  // ::ffff:0:0:0/96 (IPv4 변환, RFC 2765) — 안의 IPv4 로 판정
  if (upperZero && h4 === 0xff_ff && h5 === 0) {
    return isPrivateIpv4Parts(embeddedLow);
  }
  // 64:ff9b::/96 (NAT64 공용) — 안의 IPv4 로 판정
  if (
    h0 === 0x64 &&
    h1 === 0xff_9b &&
    h2 === 0 &&
    h3 === 0 &&
    h4 === 0 &&
    h5 === 0
  ) {
    return isPrivateIpv4Parts(embeddedLow);
  }
  // 64:ff9b:1::/48 (NAT64 지역 전용, RFC 8215) — 공개 인터넷 주소가 아니므로 통째로 막는다
  if (h0 === 0x64 && h1 === 0xff_9b && h2 === 1) {
    return true;
  }
  // 2002::/16 (6to4) — 둘째·셋째 칸이 IPv4
  if (h0 === 0x20_02) {
    return isPrivateIpv4Parts(ipv4FromHextets(h1, h2));
  }
  // 2001::/32 (Teredo) — 서버 IPv4(셋째·넷째 칸)와 뒤집힌(각 비트 반전) 클라이언트 IPv4(끝 두 칸) 중 하나라도 사설이면 막는다
  if (h0 === 0x20_01 && h1 === 0) {
    return (
      isPrivateIpv4Parts(ipv4FromHextets(h2, h3)) ||
      isPrivateIpv4Parts(ipv4FromHextets(0xff_ff - h6, 0xff_ff - h7))
    );
  }
  return isSpecialIpv6Range(h0, h1, h2, h3);
}

/** IPv4 가 들어가지 않는 사설·특수 IPv6 대역. */
function isSpecialIpv6Range(
  h0: number,
  h1: number,
  h2: number,
  h3: number
): boolean {
  return (
    // 100::/64 (버림 전용)
    (h0 === 0x01_00 && h1 === 0 && h2 === 0 && h3 === 0) ||
    // 2001:db8::/32 (문서용)
    (h0 === 0x20_01 && h1 === 0x0d_b8) ||
    // fc00::/7 (고유 지역), fe80::/10 (링크 로컬), fec0::/10 (사이트 로컬, 폐지), ff00::/8 (멀티캐스트)
    (h0 >= 0xfc_00 && h0 <= 0xfd_ff) ||
    (h0 >= 0xfe_80 && h0 <= 0xfe_bf) ||
    (h0 >= 0xfe_c0 && h0 <= 0xfe_ff) ||
    h0 >= 0xff_00
  );
}

export function isPrivateAddress(address: string): boolean {
  // 영역 표시(zone ID)가 붙은 주소는 장치 한정 주소라 무조건 사설로 본다.
  if (address.includes("%")) {
    return true;
  }
  const normalized = address.toLowerCase();
  const ipv4 = parseIpv4(normalized);
  if (ipv4) {
    return isPrivateIpv4Parts(ipv4);
  }

  if (isIP(normalized) === 6) {
    // 기존 판정(그대로 유지) — 하나라도 사설이면 사설.
    if (normalized.startsWith("::ffff:")) {
      if (isPrivateAddress(normalized.slice("::ffff:".length))) {
        return true;
      }
    } else if (
      normalized === "::" ||
      normalized === "::1" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      IPV6_LINK_LOCAL_RE.test(normalized) ||
      normalized.startsWith("2001:db8:")
    ) {
      return true;
    }
    // 보강 판정 — 칸 단위로 풀어 변환 주소 안의 IPv4 까지 본다. 못 풀면 사설로 본다(fail-closed).
    const hextets = parseIpv6(normalized);
    return hextets === null || isPrivateIpv6Hextets(hextets);
  }

  return true;
}

export function normalizePublicUrl(input: string): URL {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("URL_REQUIRED");
  }
  const withProtocol = HTTP_PROTOCOL_RE.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  let url: URL;
  try {
    url = new URL(withProtocol);
  } catch {
    throw new Error("URL_INVALID");
  }

  if (!(url.protocol === "https:" || url.protocol === "http:")) {
    throw new Error("URL_PROTOCOL");
  }
  if (url.username || url.password || !ALLOWED_PORTS.has(url.port)) {
    throw new Error("URL_UNSAFE");
  }
  url.hash = "";
  return url;
}

export async function assertPublicUrl(url: URL): Promise<void> {
  if (!(url.protocol === "https:" || url.protocol === "http:")) {
    throw new Error("URL_PROTOCOL");
  }
  if (url.username || url.password || !ALLOWED_PORTS.has(url.port)) {
    throw new Error("URL_UNSAFE");
  }

  // IPv6 리터럴은 URL.hostname 에 대괄호가 붙어 온다([2606:…]). 벗긴 뒤 IP 로 판정한다(벗기지 않으면 DNS 이름으로 오인).
  const rawHost = url.hostname.toLowerCase();
  const bracketed = rawHost.startsWith("[") && rawHost.endsWith("]");
  const hostname = bracketed
    ? rawHost.slice(1, -1)
    : rawHost.replace(TRAILING_DOT_RE, "");
  // 영역 표시(zone ID, `%en0`)가 붙은 주소는 특정 장치에 묶인 내부 주소라 거부한다.
  if (hostname.includes("%") || (bracketed && isIP(hostname) !== 6)) {
    throw new Error("URL_PRIVATE");
  }
  if (
    hostname === "localhost" ||
    BLOCKED_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))
  ) {
    throw new Error("URL_PRIVATE");
  }

  if (isIP(hostname)) {
    if (isPrivateAddress(hostname)) {
      throw new Error("URL_PRIVATE");
    }
    return;
  }

  let records: Array<{ address: string; family: number }>;
  try {
    records = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new Error("URL_DNS");
  }
  if (
    records.length === 0 ||
    records.some((record) => isPrivateAddress(record.address))
  ) {
    throw new Error("URL_PRIVATE");
  }
}
