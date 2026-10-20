import { isAllowedByRobots } from "./brand-catalog";
import { assertPublicUrl } from "./public-url-security";

/**
 * 사이트 이미지 속 글자 읽기(2026-10-19, 플래그 SITE_IMAGE_TEXT_ENABLED · 기본 꺼짐).
 *
 * 왜: 글이 이미지 안에 있는 사이트(I-05: 렌더링 후에도 보이는 글자 77자, 쇼핑몰 상세 이미지)는 글자 읽기로 재료를 못 얻는다.
 *   사이트 읽기가 얇을 때만 상위 N장을 내려받아 비전 모델로 글자를 뽑아 재료에 합친다.
 * 규칙
 *  - 호출 상한: 사이트당 이미지 수·이미지당/총 바이트·출력 토큰·**추정 원가 상한** 안에서만. 상한 없는 호출 없음.
 *  - robots: 제3자 사이트는 robots 금지 경로 이미지를 가져오지 않는다(`respectRobots`, 기본 true).
 *  - 개인정보·저작권: **원본 이미지는 저장하지 않는다** — 바이트는 모델 호출 직후 버리고 추출 글자만 남긴다.
 *  - 이미지 안의 글은 데이터다 — 지시문처럼 보이는 줄은 버린다.
 *  - 새 패키지 없음: 모델 호출은 `@repo/ai/lib/image-text`(기존 Letsur→Gateway 경로).
 */

const ON_VALUES = new Set(["1", "true"]);

export function isSiteImageTextEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  return ON_VALUES.has(
    (env.SITE_IMAGE_TEXT_ENABLED ?? "").trim().toLowerCase()
  );
}

export interface ImageTextLimits {
  fetchTimeoutMs: number;
  /** 이미지 1장당 모델 호출 추정 원가(원) — **임시 추정값**, 실호출로 교정한다. */
  krwPerImage: number;
  maxCharsPerImage: number;
  maxImageBytes: number;
  maxImages: number;
  /** 사이트 1곳당 추정 원가 상한(원). 이 값 / krwPerImage 가 이미지 수를 더 줄일 수 있다. */
  maxKrw: number;
  maxOutputTokens: number;
  maxTotalBytes: number;
  maxTotalChars: number;
  /** 가로·세로 속성이 이보다 작으면 아이콘으로 보고 건너뛴다. */
  minDimension: number;
}

const num = (raw: string | undefined, fallback: number): number => {
  const n = Number(raw);
  return raw !== undefined && raw.trim() !== "" && Number.isFinite(n) && n >= 0
    ? n
    : fallback;
};

export function imageTextLimits(
  env: Record<string, string | undefined> = process.env
): ImageTextLimits {
  return {
    fetchTimeoutMs: num(env.SITE_IMAGE_TEXT_FETCH_TIMEOUT_MS, 8000),
    krwPerImage: num(env.SITE_IMAGE_TEXT_KRW_PER_IMAGE, 25),
    maxCharsPerImage: num(env.SITE_IMAGE_TEXT_MAX_CHARS_PER_IMAGE, 600),
    maxImageBytes: num(env.SITE_IMAGE_TEXT_MAX_IMAGE_BYTES, 2_000_000),
    maxImages: num(env.SITE_IMAGE_TEXT_MAX_IMAGES, 6),
    maxKrw: num(env.SITE_IMAGE_TEXT_MAX_KRW, 200),
    maxOutputTokens: num(env.SITE_IMAGE_TEXT_MAX_OUTPUT_TOKENS, 500),
    maxTotalBytes: num(env.SITE_IMAGE_TEXT_MAX_TOTAL_BYTES, 8_000_000),
    maxTotalChars: num(env.SITE_IMAGE_TEXT_MAX_TOTAL_CHARS, 1500),
    minDimension: num(env.SITE_IMAGE_TEXT_MIN_DIMENSION, 200),
  };
}

/** 이 사이트에서 실제로 쓸 수 있는 이미지 수(수 상한과 원가 상한 중 작은 쪽). */
export function allowedImageCount(limits: ImageTextLimits): number {
  const byCost =
    limits.krwPerImage > 0
      ? Math.floor(limits.maxKrw / limits.krwPerImage)
      : limits.maxImages;
  return Math.max(0, Math.min(limits.maxImages, byCost));
}

export interface ImageCandidate {
  area: number;
  url: URL;
}

const IMG_TAG_RE = /<img\b[^>]*>/gi;
const OG_IMAGE_RE =
  /<meta\b[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["'][^>]*>/gi;
const ATTR_RE = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
const SRCSET_SPLIT_RE = /\s*,\s+/;
const SPACES_RE = /\s+/;
const SKIP_EXT_RE = /\.(svg|gif|ico|avif|bmp)(\?|#|$)/i;
const SKIP_HINT_RE =
  /logo|icon|sprite|favicon|avatar|emoji|arrow|loading|spinner|pixel|tracking|1x1|blank/i;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function attrsOf(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(ATTR_RE)) {
    out[(m[1] ?? "").toLowerCase()] = m[2] ?? m[3] ?? "";
  }
  return out;
}

/** srcset 에서 가로 폭이 가장 큰 후보(없으면 첫 후보). */
function bestSrcset(srcset: string): { url: string; width: number } | null {
  let best: { url: string; width: number } | null = null;
  for (const part of srcset.split(SRCSET_SPLIT_RE)) {
    const [url, descriptor] = part.trim().split(SPACES_RE);
    if (!url) {
      continue;
    }
    const width = descriptor?.endsWith("w")
      ? Number.parseInt(descriptor, 10)
      : 0;
    if (!best || width > best.width) {
      best = { url, width: Number.isFinite(width) ? width : 0 };
    }
  }
  return best;
}

const dim = (value: string | undefined): number => {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) ? n : 0;
};

/**
 * 글이 들어 있을 만한 이미지를 고른다(순수). 로고·아이콘·SVG·GIF·추적 픽셀·너무 작은 이미지를 빼고,
 * 선언된 크기가 큰 순서로 정렬한다(크기를 모르면 문서 순서). 같은 주소는 한 번만.
 */
export function pickImageCandidates(
  html: string,
  baseUrl: string,
  limits: ImageTextLimits
): ImageCandidate[] {
  const seen = new Set<string>();
  const out: ImageCandidate[] = [];
  const add = (
    raw: string | undefined,
    width: number,
    height: number,
    hint: string
  ) => {
    const value = (raw ?? "").trim();
    if (!value || value.startsWith("data:") || SKIP_EXT_RE.test(value)) {
      return;
    }
    if (SKIP_HINT_RE.test(`${value} ${hint}`)) {
      return;
    }
    if (
      (width > 0 && width < limits.minDimension) ||
      (height > 0 && height < limits.minDimension)
    ) {
      return;
    }
    let url: URL;
    try {
      url = new URL(value, baseUrl);
    } catch {
      return;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return;
    }
    const key = `${url.origin}${url.pathname}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    out.push({ area: width * (height || width), url });
  };
  for (const tag of html.match(IMG_TAG_RE) ?? []) {
    const a = attrsOf(tag);
    const set = bestSrcset(a.srcset ?? a["data-srcset"] ?? "");
    const src = set?.url ?? a.src ?? a["data-src"] ?? a["data-original"];
    add(
      src,
      set?.width || dim(a.width),
      dim(a.height),
      `${a.alt ?? ""} ${a.class ?? ""} ${a.id ?? ""}`
    );
  }
  for (const m of html.matchAll(OG_IMAGE_RE)) {
    add(m[1], 0, 0, "og");
  }
  return out
    .map((c, index) => ({ ...c, index }))
    .sort((x, y) => y.area - x.area || x.index - y.index)
    .map(({ area, url }) => ({ area, url }));
}

export interface FetchedImage {
  bytes: Uint8Array;
  mediaType: string;
}

export interface ImageTextDeps {
  extractText(image: FetchedImage & { maxOutputTokens: number }): Promise<{
    inputTokens: number | null;
    outputTokens: number | null;
    text: string;
  }>;
  fetchImage(url: URL, limits: ImageTextLimits): Promise<FetchedImage | null>;
}

const MAX_IMAGE_REDIRECTS = 3;

async function readBytes(
  response: Response,
  maxBytes: number
): Promise<Uint8Array | null> {
  const reader = response.body?.getReader();
  if (!reader) {
    const buffer = new Uint8Array(await response.arrayBuffer());
    return buffer.byteLength > maxBytes ? null : buffer;
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done || !value) {
      break;
    }
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return null; // 상한 초과 — 잘린 이미지를 모델에 보내지 않는다
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

/** 기본 이미지 내려받기 — 공개 주소만(사설망 차단), 이미지 형식·크기 상한, 리다이렉트마다 재검사. */
export const defaultFetchImage: ImageTextDeps["fetchImage"] = async (
  url,
  limits
) => {
  let current = url;
  for (let hop = 0; hop <= MAX_IMAGE_REDIRECTS; hop += 1) {
    await assertPublicUrl(current);
    const response = await fetch(current, {
      cache: "no-store",
      headers: { accept: "image/jpeg,image/png,image/webp" },
      redirect: "manual",
      signal: AbortSignal.timeout(limits.fetchTimeoutMs),
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) {
        return null;
      }
      current = new URL(location, current);
      continue;
    }
    if (!response.ok) {
      return null;
    }
    const type = (response.headers.get("content-type") ?? "")
      .split(";")[0]
      ?.trim()
      .toLowerCase();
    const declared = Number(response.headers.get("content-length") ?? "0");
    if (!(type && ALLOWED_TYPES.has(type)) || declared > limits.maxImageBytes) {
      return null;
    }
    const bytes = await readBytes(response, limits.maxImageBytes);
    return bytes ? { bytes, mediaType: type } : null;
  }
  return null;
};

async function defaultExtractText(
  image: FetchedImage & { maxOutputTokens: number }
) {
  const { extractImageText } = await import("@repo/ai/lib/image-text");
  return await extractImageText(image);
}

export const defaultImageTextDeps: ImageTextDeps = {
  extractText: defaultExtractText,
  fetchImage: defaultFetchImage,
};

// biome-ignore lint/suspicious/noControlCharactersInRegex: 제어 문자 제거가 목적이다.
const CONTROL_RE = /[\u0000-\u001f\u007f]/g;
const NEWLINES_RE = /\n+/;
const INJECTION_RE =
  /ignore (all|any|previous|the above)|system prompt|disregard|지시.{0,6}(무시|따르)|명령.{0,6}(무시|따르)|프롬프트/i;
const MIN_USEFUL_CHARS = 4;
const SPACE_RUN_RE = /\s+/g;

/** 모델이 옮겨 적은 글을 재료로 쓸 수 있게 거른다(제어 문자·지시문 같은 줄 제거, 길이 상한). */
export function cleanImageText(raw: string, maxChars: number): string {
  const lines = raw
    .split(NEWLINES_RE)
    .map((l) => l.replace(CONTROL_RE, " ").replace(SPACE_RUN_RE, " ").trim())
    .filter((l) => l && !INJECTION_RE.test(l));
  const text = lines.join(" ").slice(0, maxChars).trim();
  return text.replace(SPACE_RUN_RE, "").length >= MIN_USEFUL_CHARS ? text : "";
}

export interface ImageTextOutcome {
  /** 시도(내려받아 모델에 보낸) 이미지 수. */
  attempted: number;
  /** 추정 원가(원) — attempted × krwPerImage. 실호출 전에는 추정값이다. */
  estimatedKrw: number;
  failed: number;
  inputTokens: number;
  outputTokens: number;
  /** 글자를 얻은 이미지 수. */
  readable: number;
  /** 추출 글자(이미지별). 원본 이미지는 담지 않는다. */
  texts: string[];
}

export interface CollectImageTextInput {
  deps?: ImageTextDeps;
  /** robots Disallow 경로 목록(제3자 사이트). */
  disallow: readonly string[];
  html: string;
  limits?: ImageTextLimits;
  origin: string;
  /** false 면 robots 를 보지 않는다(고객이 직접 등록한 사이트의 기존 정책용 — 현재 호출부는 항상 true). */
  respectRobots?: boolean;
}

/** 이미지 1장을 모델에 보내 글자를 얻는다. 결과 글자(남은 글자 수 안)를 돌려주고 집계는 outcome 에 더한다. */
async function readOneImage(
  image: FetchedImage,
  limits: ImageTextLimits,
  deps: ImageTextDeps,
  outcome: ImageTextOutcome,
  room: number
): Promise<string> {
  try {
    const result = await deps.extractText({
      ...image,
      maxOutputTokens: limits.maxOutputTokens,
    });
    outcome.inputTokens += result.inputTokens ?? 0;
    outcome.outputTokens += result.outputTokens ?? 0;
    const text = cleanImageText(result.text, limits.maxCharsPerImage).slice(
      0,
      room
    );
    if (text) {
      outcome.texts.push(text);
      outcome.readable += 1;
    }
    return text;
  } catch {
    outcome.failed += 1;
    return "";
  }
}

/** 후보를 순서대로 내려받아(바이트 상한) 모델로 글자를 뽑는다. 상한을 넘기 전에 멈춘다. */
export async function collectImageText(
  input: CollectImageTextInput
): Promise<ImageTextOutcome> {
  const limits = input.limits ?? imageTextLimits();
  const deps = input.deps ?? defaultImageTextDeps;
  const respectRobots = input.respectRobots ?? true;
  const budget = allowedImageCount(limits);
  const outcome: ImageTextOutcome = {
    attempted: 0,
    estimatedKrw: 0,
    failed: 0,
    inputTokens: 0,
    outputTokens: 0,
    readable: 0,
    texts: [],
  };
  if (budget === 0) {
    return outcome;
  }
  let totalBytes = 0;
  let totalChars = 0;
  for (const candidate of pickImageCandidates(
    input.html,
    input.origin,
    limits
  )) {
    if (outcome.attempted >= budget || totalChars >= limits.maxTotalChars) {
      break;
    }
    if (
      respectRobots &&
      !isAllowedByRobots(candidate.url.pathname, [...input.disallow])
    ) {
      continue; // 금지 경로 이미지는 가져오지 않는다
    }
    const image = await deps
      .fetchImage(candidate.url, limits)
      .catch(() => null);
    if (!image) {
      continue;
    }
    if (totalBytes + image.bytes.byteLength > limits.maxTotalBytes) {
      break;
    }
    totalBytes += image.bytes.byteLength;
    outcome.attempted += 1;
    outcome.estimatedKrw += limits.krwPerImage;
    const room = Math.max(0, limits.maxTotalChars - totalChars);
    const text = await readOneImage(image, limits, deps, outcome, room);
    totalChars += text.length;
    // 바이트는 여기서 끝 — 어디에도 저장하지 않는다.
  }
  return outcome;
}
