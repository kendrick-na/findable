// ui-vendor-v1 — 업체(Bright Data) 화면 수집 섀도 후보 2종 (섀도 전용 · 2026-10-10)
//
//   (A) chatgpt-ui-vendor-v1 : chatgpt.com 화면 수집 (dataset gd_m7aof0k82r803d5bjm · web_search on)
//   (B) gemini-ui-vendor-v1  : gemini.google.com 화면 수집 (dataset gd_mbz66arm2mf9cu856y)
//
// 🔴 전부 기본 off. 아무 플래그도 안 켜면 이 파일의 코드는 **한 줄도 실행되지 않는다**(운영 동작 불변).
//   UI_VENDOR_SHADOW=true  → chatgpt·gemini 질문마다 후보를 **메인과 동시에** 돌려 비교만 저장한다.
//   UI_VENDOR_SHADOW_BRANDS → 허용 도메인(쉼표·공백 구분). **비어 있으면 아무도 안 돈다.**
//   UI_VENDOR_TIMEOUT_MS (기본 120000) · UI_VENDOR_SHADOW_GRACE_MS (기본 0)
//   키: BRIGHTDATA_API_KEY (Google AIO 파일럿과 같은 변수 · 새 비밀 없음)
//
// 🔴 결과는 chatgpt·gemini 행의 `shadowUiVendor` 에만 붙는다. 점수·집계·판정·PDF·UI 에 쓰지 않는다.
//
// ⚖️ [법률 확인 필요] 업체가 수집한 소비자 화면 결과물을 고객 점수·영업 자료에 쓰려면 법률 검토가 먼저다.
//    이 어댑터는 **보정(캘리브레이션)·섀도 전용**이다.
//
// 동작(실측 2026-10-10): POST /datasets/v3/scrape → 200 JSON(객체 또는 배열, 보통 45~60초) 또는
//   202 {snapshot_id}. 202 면 /progress/<id> 를 ~8초마다 확인(running|ready|failed) → ready 면
//   /snapshot/<id>?format=json. 실패는 {error, error_code} 레코드. **재시도 없음**(폴링만).
// ⭐ 본문 URL 폴백 금지(N-48): 출처는 업체 레코드의 citations[] 만 쓴다(mapProviderSources 재사용).

import { log } from "@repo/observability/log";
import { sanitizeEngineText } from "./sanitize";
import type {
  EngineQuery,
  EngineResponse,
  UiVendorCandidate,
  UiVendorShadow,
} from "./types";
import {
  detectBrandMention,
  estimateSentiment,
  estimateShareOfVoice,
  mapProviderSources,
  mentionPositionFields,
} from "./utils";

type Env = Record<string, string | undefined>;

const LIST_SPLIT_RE = /[\s,]+/;
const DOMAIN_PREFIX_RE = /^(?:https?:\/\/)?(?:www\.)?/i;
const PATH_SUFFIX_RE = /\/.*$/;
const WWW_PREFIX_RE = /^www\./;
const CODE_CLEAN_RE = /[^a-z0-9_]/g;

function normalizeDomain(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(DOMAIN_PREFIX_RE, "")
    .replace(PATH_SUFFIX_RE, "");
}

export function isUiVendorShadowEnabled(env: Env = process.env): boolean {
  const raw = env.UI_VENDOR_SHADOW?.trim().toLowerCase();
  return raw === "true" || raw === "1";
}

/** 허용 목록 — 쉼표·공백 구분. 비어 있으면 빈 배열(= 아무도 안 돈다). */
export function uiVendorShadowAllowlist(env: Env = process.env): string[] {
  return (env.UI_VENDOR_SHADOW_BRANDS ?? "")
    .split(LIST_SPLIT_RE)
    .map((v) => v.trim())
    .filter(Boolean);
}

/** 이 도메인이 섀도 허용 대상인가. 도메인이 없거나 목록이 비면 false. */
export function isUiVendorShadowAllowed(
  domain: string | undefined,
  env: Env = process.env
): boolean {
  if (!domain) {
    return false;
  }
  const list = uiVendorShadowAllowlist(env);
  if (list.length === 0) {
    return false;
  }
  const target = normalizeDomain(domain);
  return target.length > 0 && list.some((e) => normalizeDomain(e) === target);
}

function envMs(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return fallback;
  }
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

const DEFAULT_UI_VENDOR_TIMEOUT_MS = 120_000;
const DEFAULT_POLL_MS = 8000;
const SHADOW_TEXT_LIMIT = 8000;
const BRIGHTDATA_API = "https://api.brightdata.com/datasets/v3";

const DATASETS = {
  "chatgpt-ui-vendor-v1": {
    id: "gd_m7aof0k82r803d5bjm",
    url: "https://chatgpt.com/",
    engineId: "chatgpt",
    extra: { web_search: true, additional_prompt: "" },
  },
  "gemini-ui-vendor-v1": {
    id: "gd_mbz66arm2mf9cu856y",
    url: "https://gemini.google.com/",
    engineId: "gemini",
    extra: {},
  },
} as const satisfies Record<
  UiVendorCandidate,
  {
    engineId: "chatgpt" | "gemini";
    extra: Record<string, unknown>;
    id: string;
    url: string;
  }
>;

// ──────────────────────────────────────────────────────────────────
// 파서 (순수 함수 · 절대 throw 하지 않는다)
// ──────────────────────────────────────────────────────────────────
type Rec = Record<string, unknown>;

function asRec(value: unknown): Rec | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Rec)
    : undefined;
}

export type ParsedVendorRecord =
  | {
      kind: "ok";
      model: string | null;
      sources: Array<{ sourceType: string; title?: string; url?: string }>;
      text: string;
      webSearchTriggered: boolean | null;
    }
  | { kind: "error"; code: string }
  | { kind: "empty" }
  | { kind: "malformed" };

interface VendorSource {
  sourceType: string;
  title?: string;
  url?: string;
}

function readCitations(value: unknown): VendorSource[] {
  const sources: VendorSource[] = [];
  if (!Array.isArray(value)) {
    return sources;
  }
  for (const c of value) {
    const cit = asRec(c);
    if (cit && typeof cit.url === "string") {
      sources.push({
        sourceType: "url",
        url: cit.url,
        title: typeof cit.title === "string" ? cit.title : undefined,
      });
    }
  }
  return sources;
}

/** 업체 응답(객체 또는 배열) → 첫 레코드 1건의 판정. */
export function parseVendorRecord(body: unknown): ParsedVendorRecord {
  const first = Array.isArray(body) ? body[0] : body;
  const rec = asRec(first);
  if (!rec) {
    return { kind: "malformed" };
  }
  if (rec.error !== undefined && rec.error !== null && rec.error !== "") {
    const raw =
      typeof rec.error_code === "string" ? rec.error_code : "vendor_error";
    const code = raw.toLowerCase().replace(CODE_CLEAN_RE, "") || "vendor_error";
    return { kind: "error", code };
  }
  const answer = rec.answer_text;
  if (answer === undefined || answer === null) {
    return { kind: "empty" };
  }
  if (typeof answer !== "string") {
    return { kind: "malformed" };
  }
  const text = answer.trim();
  if (text.length === 0) {
    return { kind: "empty" };
  }
  const sources = readCitations(rec.citations);
  return {
    kind: "ok",
    text,
    sources,
    model: typeof rec.model === "string" && rec.model ? rec.model : null,
    webSearchTriggered:
      typeof rec.web_search_triggered === "boolean"
        ? rec.web_search_triggered
        : null,
  };
}

// ──────────────────────────────────────────────────────────────────
// 호출 (fetch 직접 · 절대 throw 하지 않는다)
// ──────────────────────────────────────────────────────────────────
export interface VendorOutcome {
  durationMs: number;
  error: string | null;
  model: string | null;
  response: EngineResponse;
  webSearchTriggered: boolean | null;
}

function failure(
  engineId: "chatgpt" | "gemini",
  message: string,
  start: number
): EngineResponse {
  return {
    engineId,
    rawResponse: "",
    brandMentioned: false,
    mentionPosition: null,
    mentionListSize: null,
    sentiment: null,
    citedSources: [],
    shareOfVoice: null,
    errorMessage: message,
    durationMs: Date.now() - start,
    isStub: false,
  };
}

function success(
  engineId: "chatgpt" | "gemini",
  parsed: Extract<ParsedVendorRecord, { kind: "ok" }>,
  query: EngineQuery,
  start: number
): EngineResponse {
  const text = sanitizeEngineText(parsed.text);
  const mention = detectBrandMention(
    text,
    query.brandName,
    query.brandVariants
  );
  return {
    engineId,
    rawResponse: text,
    brandMentioned: mention.mentioned,
    ...mentionPositionFields(text, query.brandName, query.brandVariants),
    sentiment: estimateSentiment(text, query.brandName),
    // 🔴 업체가 준 citations 만(N-48).
    citedSources: mapProviderSources(parsed.sources),
    shareOfVoice: estimateShareOfVoice(
      text,
      query.brandName,
      query.brandVariants
    ),
    errorMessage: null,
    durationMs: Date.now() - start,
    isStub: false,
  };
}

interface TimedSignal {
  cleanup: () => void;
  signal: AbortSignal;
  timedOut: () => boolean;
}

function timedSignal(parent: AbortSignal | undefined, ms: number): TimedSignal {
  const controller = new AbortController();
  let timedOutFlag = false;
  const onParent = () => controller.abort(parent?.reason);
  if (parent?.aborted) {
    controller.abort(parent.reason);
  } else {
    parent?.addEventListener("abort", onParent, { once: true });
  }
  const timer = setTimeout(() => {
    timedOutFlag = true;
    controller.abort(new DOMException("ui-vendor timeout", "TimeoutError"));
  }, ms);
  timer.unref?.();
  return {
    signal: controller.signal,
    timedOut: () => timedOutFlag,
    cleanup: () => {
      clearTimeout(timer);
      parent?.removeEventListener("abort", onParent);
    },
  };
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** 업체 입력 국가: 한국어 질문 → KR, 그 외 US. */
export function uiVendorCountry(query: Pick<EngineQuery, "language">): string {
  return query.language === "ko" ? "KR" : "US";
}

function scrapeUrl(datasetId: string): string {
  return `${BRIGHTDATA_API}/scrape?dataset_id=${encodeURIComponent(datasetId)}&notify=false&include_errors=true`;
}

class VendorFailure extends Error {}

/** 202 → progress 폴링 → snapshot. 실패는 VendorFailure("[ui-vendor:*]"). 취소·상한은 signal.reason 그대로 던진다. */
async function pollSnapshot(
  snapshotId: string,
  headers: Record<string, string>,
  signal: AbortSignal,
  pollMs: number
): Promise<unknown> {
  const id = encodeURIComponent(snapshotId);
  for (;;) {
    await sleep(pollMs, signal);
    const res = await fetch(`${BRIGHTDATA_API}/progress/${id}`, {
      headers,
      signal,
    });
    if (!res.ok) {
      throw new VendorFailure(`[ui-vendor:http_${res.status}]`);
    }
    const status = asRec(await res.json())?.status;
    if (status === "failed") {
      throw new VendorFailure("[ui-vendor:vendor_failed]");
    }
    if (status === "ready") {
      const snap = await fetch(`${BRIGHTDATA_API}/snapshot/${id}?format=json`, {
        headers,
        signal,
      });
      if (!snap.ok) {
        throw new VendorFailure(`[ui-vendor:http_${snap.status}]`);
      }
      return await snap.json();
    }
  }
}

/**
 * 후보 1회 수집. 오류는 `[ui-vendor:*]` 접두어 errorMessage 로 돌려준다(본문·키는 싣지 않는다).
 * 재시도 없음 — 폴링만.
 */
export async function runUiVendorCandidate(
  candidate: UiVendorCandidate,
  query: EngineQuery,
  options: { pollMs?: number; timeoutMs?: number } = {}
): Promise<VendorOutcome> {
  const start = Date.now();
  const spec = DATASETS[candidate];
  const done = (
    response: EngineResponse,
    parsed?: ParsedVendorRecord
  ): VendorOutcome => ({
    response,
    durationMs: Date.now() - start,
    error: response.errorMessage,
    model: parsed?.kind === "ok" ? parsed.model : null,
    webSearchTriggered:
      parsed?.kind === "ok" ? parsed.webSearchTriggered : null,
  });
  const apiKey = process.env.BRIGHTDATA_API_KEY?.trim();
  if (!apiKey) {
    return done(failure(spec.engineId, "[ui-vendor:not_configured]", start));
  }
  const timed = timedSignal(
    query.signal,
    options.timeoutMs ??
      envMs("UI_VENDOR_TIMEOUT_MS", DEFAULT_UI_VENDOR_TIMEOUT_MS)
  );
  const headers = {
    authorization: `Bearer ${apiKey}`,
    "content-type": "application/json",
  };
  try {
    const res = await fetch(scrapeUrl(spec.id), {
      method: "POST",
      headers,
      body: JSON.stringify({
        input: [
          {
            url: spec.url,
            prompt: query.prompt,
            country: uiVendorCountry(query),
            ...spec.extra,
          },
        ],
      }),
      signal: timed.signal,
    });
    let body: unknown;
    if (res.status === 202) {
      const snapshotId = asRec(await res.json())?.snapshot_id;
      if (typeof snapshotId !== "string" || snapshotId.length === 0) {
        return done(failure(spec.engineId, "[ui-vendor:malformed]", start));
      }
      body = await pollSnapshot(
        snapshotId,
        headers,
        timed.signal,
        options.pollMs ?? DEFAULT_POLL_MS
      );
    } else if (res.ok) {
      body = await res.json();
    } else {
      return done(
        failure(spec.engineId, `[ui-vendor:http_${res.status}]`, start)
      );
    }
    const parsed = parseVendorRecord(body);
    switch (parsed.kind) {
      case "ok":
        return done(success(spec.engineId, parsed, query, start), parsed);
      case "error":
        return done(
          failure(spec.engineId, `[ui-vendor:${parsed.code}]`, start)
        );
      case "empty":
        return done(failure(spec.engineId, "[ui-vendor:empty_answer]", start));
      default:
        return done(failure(spec.engineId, "[ui-vendor:malformed]", start));
    }
  } catch (error) {
    if (error instanceof VendorFailure) {
      return done(failure(spec.engineId, error.message, start));
    }
    if (timed.timedOut()) {
      return done(failure(spec.engineId, "[ui-vendor:timeout]", start));
    }
    if (query.signal?.aborted) {
      return done(failure(spec.engineId, "[ui-vendor:aborted]", start));
    }
    log.warn("engine.ui_vendor.failure", {
      candidate,
      kind: error instanceof Error ? error.name : "unknown",
    });
    return done(failure(spec.engineId, "[ui-vendor:network]", start));
  } finally {
    timed.cleanup();
  }
}

// ──────────────────────────────────────────────────────────────────
// 섀도 핸들 (precedent: api-search-v1.ts startApiSearchShadow)
// ──────────────────────────────────────────────────────────────────
function domainSet(r: { citedSources: { domain: string }[] }): Set<string> {
  return new Set(
    r.citedSources
      .map((s) => s.domain.toLowerCase().replace(WWW_PREFIX_RE, ""))
      .filter((d) => d.length > 0)
  );
}

function overlap(a: EngineResponse, b: EngineResponse): number | null {
  const left = domainSet(a);
  const right = domainSet(b);
  const union = new Set([...left, ...right]);
  if (union.size === 0) {
    return null;
  }
  let shared = 0;
  for (const d of left) {
    if (right.has(d)) {
      shared += 1;
    }
  }
  return Math.round((shared / union.size) * 1000) / 1000;
}

function toUiVendorShadow(
  candidate: UiVendorCandidate,
  outcome: VendorOutcome,
  main: EngineResponse | undefined
): UiVendorShadow {
  const result = outcome.response;
  const ok = !(result.errorMessage || result.isStub);
  const mainOk = Boolean(main && !(main.errorMessage || main.isStub));
  return {
    candidate,
    outcome: ok ? "ok" : "failed",
    text: ok ? result.rawResponse.slice(0, SHADOW_TEXT_LIMIT) : "",
    citations: ok ? result.citedSources : [],
    brandMentioned: ok ? result.brandMentioned : null,
    durationMs: result.durationMs,
    error: ok ? null : (result.errorMessage ?? "[ui-vendor:other]"),
    recordBilled: ok,
    vendorModel: ok ? outcome.model : null,
    webSearchTriggered: ok ? outcome.webSearchTriggered : null,
    comparison:
      ok && main && mainOk
        ? {
            mentionAgreement: result.brandMentioned === main.brandMentioned,
            citationOverlap: overlap(result, main),
          }
        : null,
  };
}

export interface UiVendorShadowHandle {
  /** 메인 배치가 끝난 뒤 호출. grace 안에 끝나면 결과, 아니면 중단하고 skipped_budget. */
  finish(main: EngineResponse | undefined): Promise<UiVendorShadow>;
}

export type UiVendorRunner = (
  candidate: UiVendorCandidate,
  query: EngineQuery,
  options: { pollMs?: number; timeoutMs?: number }
) => Promise<VendorOutcome>;

/**
 * 후보 섀도를 **메인 배치와 동시에** 시작한다. 절대 throw 하지 않는다.
 * 🔴 메인을 늦추지 않는다 — 메인이 끝나면 grace(기본 0ms)만 더 기다리고 끊는다.
 */
export function startUiVendorShadow(
  base: Omit<EngineQuery, "engineId">,
  candidate: UiVendorCandidate,
  run: UiVendorRunner = runUiVendorCandidate
): UiVendorShadowHandle {
  const started = Date.now();
  const engineId = DATASETS[candidate].engineId;
  const controller = new AbortController();
  const parent = base.signal;
  const onParentAbort = () => controller.abort(parent?.reason);
  if (parent?.aborted) {
    controller.abort(parent.reason);
  } else {
    parent?.addEventListener("abort", onParentAbort, { once: true });
  }
  const running: Promise<VendorOutcome | null> = (async () => {
    try {
      return await run(
        candidate,
        { ...base, engineId, signal: controller.signal },
        {
          timeoutMs: envMs(
            "UI_VENDOR_TIMEOUT_MS",
            DEFAULT_UI_VENDOR_TIMEOUT_MS
          ),
        }
      );
    } catch {
      return null;
    }
  })();

  return {
    async finish(main) {
      const graceMs = envMs("UI_VENDOR_SHADOW_GRACE_MS", 0);
      let timer: ReturnType<typeof setTimeout> | undefined;
      const late = new Promise<"late">((resolve) => {
        timer = setTimeout(() => resolve("late"), graceMs);
        timer.unref?.();
      });
      const settled = await Promise.race([running, late]);
      clearTimeout(timer);
      parent?.removeEventListener("abort", onParentAbort);
      let shadow: UiVendorShadow;
      if (settled === "late" || settled === null) {
        const crashed = settled === null && !controller.signal.aborted;
        controller.abort(
          new DOMException("ui-vendor shadow budget", "AbortError")
        );
        // 끊긴 호출의 과금 여부는 알 수 없다 → recordBilled=false, 원가 항목 없음([확인필요]).
        shadow = {
          candidate,
          outcome: crashed ? "failed" : "skipped_budget",
          text: "",
          citations: [],
          brandMentioned: null,
          durationMs: Date.now() - started,
          error: crashed
            ? "[ui-vendor:other] shadow crashed"
            : "[ui-vendor:skipped_budget] 메인 배치가 먼저 끝나 섀도를 중단함",
          recordBilled: false,
          vendorModel: null,
          webSearchTriggered: null,
          comparison: null,
        };
      } else {
        shadow = toUiVendorShadow(candidate, settled, main);
      }
      log.info("engine.ui_vendor.shadow", {
        candidate,
        outcome: shadow.outcome,
        error: shadow.error?.split(" ")[0] ?? null,
        durationMs: shadow.durationMs,
        mainMentioned: main ? main.brandMentioned : null,
        shadowMentioned: shadow.brandMentioned,
        mentionAgreement: shadow.comparison?.mentionAgreement ?? null,
        citationOverlap: shadow.comparison?.citationOverlap ?? null,
        shadowCitations: shadow.citations.length,
        vendorModel: shadow.vendorModel,
        webSearchTriggered: shadow.webSearchTriggered,
      });
      return shadow;
    },
  };
}
