// 연결 주소 고정(DNS 핀) fetch — 새 의존성 없이 Node 내장 http/https/tls/net/zlib 만 쓴다.
//
// 쉬운 말: 이름(도메인)을 한 번만 해석해 그 결과가 전부 공개 주소일 때만, **검사한 바로 그 IP 로** 연결한다.
// 일반 fetch 는 검사 뒤 연결할 때 이름을 다시 해석하므로, 그 사이 DNS 응답을 바꾸는 재바인딩 공격에 틈이 생긴다.
//
// 동작 순서(요청 1건 = 리다이렉트 1단계):
//  ① dns.lookup(all:true) 1회 → 주소가 하나라도 사설이면 거부(fail-closed)
//  ② 통과한 주소 하나(IPv4 우선)를 고르고, 연결 함수의 `lookup` 이 그 IP 만 돌려주게 해 실제 연결을 고정
//     TLS 는 원래 호스트명으로 SNI·인증서 검증(servername) — IP 로 연결해도 인증서는 도메인 기준으로 본다
//  ③ TCP 연결 직후(요청 바이트를 보내기 전) socket.remoteAddress 를 다시 사설 검사(이중 방어)
//  ④ 리다이렉트는 따라가지 않는다(항상 manual). 호출자(official-facts 의 safeGet)가 3회 상한으로 수동 추적하며
//     단계마다 이 함수를 다시 부르므로 ①~③과 허용 목록 검사(confinedFetch)가 매 단계 다시 돈다
//  ⑤ 응답 본문 상한(기본 512KB, 압축 해제 **후** 기준 + 압축 상태 원본도 같은 상한)·전체 시간 제한(헤더+본문)
//
// 한계는 docs/_적용/geo-입구/DNS재바인딩_완화안_20261020.md 에 적었다(주소 하나만 시도, keep-alive 끔 등).

import { lookup as dnsLookup } from "node:dns/promises";
import type { IncomingMessage } from "node:http";
import { Agent as HttpAgent, request as httpRequest } from "node:http";
import { Agent as HttpsAgent, request as httpsRequest } from "node:https";
import {
  isIP,
  type NetConnectOpts,
  connect as netConnect,
  type Socket,
} from "node:net";
import { type ConnectionOptions, connect as tlsConnect } from "node:tls";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
import { isPrivateAddress } from "@repo/audit/public-url-security";

type FetchLike = typeof fetch;

export interface ResolvedAddress {
  address: string;
  family: number;
}

export interface PinnedFetchOptions {
  /** TLS 신뢰 루트 교체(시험용 자체 인증서). 운영에서는 넘기지 않는다(기본 루트 인증서 사용). */
  ca?: string | Buffer;
  /** 사설 주소 판정. 기본 = public-url-security 의 isPrivateAddress. */
  isPrivate?: (address: string) => boolean;
  /** 본문 상한(바이트). 압축 해제 후 기준. 기본 512KB. */
  maxBytes?: number;
  /** 시험 전용: 실제로 접속할 포트를 바꾼다(로컬 모의 서버). 운영에서는 넘기지 않는다. */
  portOverride?: number;
  /** 이름 해석. 기본 = dns.lookup(all:true, verbatim:true). 시험에서 모의로 바꾼다. */
  resolveAll?: (hostname: string) => Promise<ResolvedAddress[]>;
  /**
   * 호출자가 signal 을 주지 않았을 때만 쓰는 시간 제한(연결+헤더+본문). 기본 5초.
   * signal 을 주면(official-facts 의 점검 전체 deadline) 그 signal 하나만 따른다 — 단계마다 새 시간을 만들지 않는다.
   */
  timeoutMs?: number;
}

const DEFAULT_MAX_BYTES = 512 * 1024;
const DEFAULT_TIMEOUT_MS = 5000;
const NULL_BODY_STATUS = new Set([101, 204, 205, 304]);
const TRAILING_DOT_RE = /\.$/;

function defaultResolveAll(hostname: string): Promise<ResolvedAddress[]> {
  return dnsLookup(hostname, { all: true, verbatim: true });
}

function blocked(message: string): TypeError {
  return new TypeError(`blocked: ${message}`);
}

function timeoutError(): Error {
  const err = new Error("pinned fetch timed out");
  err.name = "TimeoutError";
  return err;
}

function abortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) {
    return signal.reason;
  }
  const err = new Error("aborted");
  err.name = "AbortError";
  return err;
}

/**
 * 비교용 주소 표기: 소문자, IPv4 매핑 IPv6(::ffff:a.b.c.d)는 안의 IPv4 로 바꾼다.
 * (같은 상대인데 표기만 달라 정상 연결을 거부하지 않게)
 */
export function canonicalAddress(address: string): string {
  const lower = address.toLowerCase();
  if (lower.startsWith("::ffff:")) {
    const rest = lower.slice("::ffff:".length);
    if (isIP(rest) === 4) {
      return rest;
    }
  }
  return lower;
}

/** abort 되면 바로 거부되는 Promise — DNS·사전 확인처럼 signal 을 직접 받지 않는 대기에 전체 deadline 을 건다. */
export function untilAborted<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined
): Promise<T> {
  if (!signal) {
    return promise;
  }
  if (signal.aborted) {
    return Promise.reject(abortError(signal));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError(signal));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      }
    );
  });
}

/** URL.hostname → 연결용 호스트(대괄호·끝 점 제거). */
function bareHost(url: URL): string {
  const raw = url.hostname.toLowerCase();
  return raw.startsWith("[") && raw.endsWith("]")
    ? raw.slice(1, -1)
    : raw.replace(TRAILING_DOT_RE, "");
}

/** ① 한 번 해석 → 전부 공개일 때만 ② 고정할 주소 하나(IPv4 우선)를 고른다. */
async function resolvePinned(
  host: string,
  resolveAll: (hostname: string) => Promise<ResolvedAddress[]>,
  isPrivate: (address: string) => boolean,
  signal: AbortSignal | undefined
): Promise<ResolvedAddress> {
  const literal = isIP(host);
  if (literal) {
    if (isPrivate(host)) {
      throw blocked("address not public");
    }
    return { address: host, family: literal };
  }
  let records: ResolvedAddress[];
  try {
    records = await untilAborted(resolveAll(host), signal);
  } catch (error) {
    if (signal?.aborted) {
      throw abortError(signal);
    }
    throw new TypeError("dns lookup failed", { cause: error });
  }
  if (records.length === 0 || records.some((r) => isPrivate(r.address))) {
    throw blocked("address not public");
  }
  const chosen = records.find((r) => r.family === 4) ?? records[0];
  if (!chosen) {
    throw blocked("address not public");
  }
  return chosen;
}

interface LookupCallbackOptions {
  all?: boolean;
}
type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | ResolvedAddress[],
  family?: number
) => void;

/** ② 연결 함수가 부르는 lookup — 검사한 그 IP 만 돌려준다(다시 DNS 를 묻지 않는다). */
function pinnedLookup(expectedHost: string, pinned: ResolvedAddress) {
  return (
    hostname: string,
    options: LookupCallbackOptions,
    callback: LookupCallback
  ): void => {
    if (hostname.toLowerCase().replace(TRAILING_DOT_RE, "") !== expectedHost) {
      callback(blocked("unexpected lookup host"), "", 0);
      return;
    }
    if (options.all) {
      callback(null, [{ address: pinned.address, family: pinned.family }]);
      return;
    }
    callback(null, pinned.address, pinned.family);
  };
}

interface ConnectPlan {
  ca?: string | Buffer;
  host: string;
  isPrivate: (address: string) => boolean;
  pinned: ResolvedAddress;
  port: number;
  secure: boolean;
}

/** ②③ 소켓을 직접 만든다. 'connect' 감시를 가장 먼저 걸어, 요청 바이트가 나가기 전에 실제 연결 주소를 확인한다. */
function openSocket(plan: ConnectPlan): Socket {
  const lookup = pinnedLookup(plan.host, plan.pinned);
  const literal = isIP(plan.host) !== 0;
  // 주소 하나만, 핀 주소의 family 로만 연결한다(자동 family 선택·Happy Eyeballs 끔 — Node 기본값에 기대지 않는다).
  const base = {
    host: plan.host,
    port: plan.port,
    family: plan.pinned.family,
    autoSelectFamily: false,
    lookup,
  };
  let socket: Socket;
  if (plan.secure) {
    const tlsOptions: ConnectionOptions & { autoSelectFamily: boolean } = {
      ...base,
      // IP 직접 주소에는 SNI 를 보내지 않는다(규격상 금지). 인증서 검증은 그대로 켜져 있다.
      servername: literal ? undefined : plan.host,
      ALPNProtocols: ["http/1.1"],
      ca: plan.ca,
      rejectUnauthorized: true,
    };
    socket = tlsConnect(tlsOptions);
  } else {
    const netOptions: NetConnectOpts = base;
    socket = netConnect(netOptions);
  }
  const expected = canonicalAddress(plan.pinned.address);
  socket.once("connect", () => {
    const remote = socket.remoteAddress;
    if (
      !remote ||
      plan.isPrivate(remote) ||
      canonicalAddress(remote) !== expected
    ) {
      socket.destroy(blocked("connected address not public"));
    }
  });
  return socket;
}

/**
 * 요청마다 새 Agent(keepAlive 끔·소켓 1개)를 만들고 그 Agent 의 소켓 생성만 핀 소켓으로 바꾼다.
 * 전역 Agent(globalAgent)·연결 풀을 절대 거치지 않는다. 요청이 끝나면 destroy 한다.
 */
function isolatedAgent(plan: ConnectPlan): HttpAgent {
  const agent = plan.secure
    ? new HttpsAgent({ keepAlive: false, maxSockets: 1 })
    : new HttpAgent({ keepAlive: false, maxSockets: 1 });
  agent.createConnection = () => openSocket(plan);
  return agent;
}

function toHeaders(res: IncomingMessage, decoded: boolean): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(res.headers)) {
    if (value === undefined) {
      continue;
    }
    if (decoded && (name === "content-encoding" || name === "content-length")) {
      continue;
    }
    for (const v of Array.isArray(value) ? value : [value]) {
      headers.append(name, v);
    }
  }
  return headers;
}

type Decoder = NodeJS.ReadWriteStream & {
  destroy: (error?: Error) => void;
};

function decoderFor(encoding: string): Decoder | null | "unsupported" {
  const enc = encoding.trim().toLowerCase();
  if (enc === "" || enc === "identity") {
    return null;
  }
  if (enc === "gzip" || enc === "x-gzip") {
    return createGunzip();
  }
  if (enc === "deflate") {
    return createInflate();
  }
  if (enc === "br") {
    return createBrotliDecompress();
  }
  return "unsupported";
}

interface BodyControl {
  maxBytes: number;
  onDone: () => void;
  registerFail: (fail: (error: Error) => void) => void;
}

/** ⑤ 본문을 상한까지만 읽는 웹 스트림. 압축이면 해제 후 바이트를 세고, 원본(압축) 바이트도 같은 상한으로 끊는다. */
function limitedBody(
  res: IncomingMessage,
  decoder: Decoder | null,
  control: BodyControl
): ReadableStream<Uint8Array> {
  let total = 0;
  let raw = 0;
  let rawCapped = false;
  let finished = false;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const finish = () => {
        if (finished) {
          return;
        }
        finished = true;
        controller.close();
        decoder?.destroy();
        res.destroy();
        control.onDone();
      };
      const fail = (error: Error) => {
        if (finished) {
          return;
        }
        finished = true;
        controller.error(error);
        decoder?.destroy();
        res.destroy();
        control.onDone();
      };
      control.registerFail(fail);
      const source: NodeJS.ReadableStream = decoder ?? res;
      source.on("data", (chunk: Buffer) => {
        if (finished) {
          return;
        }
        const room = control.maxBytes - total;
        const piece = chunk.byteLength > room ? chunk.subarray(0, room) : chunk;
        total += piece.byteLength;
        if (piece.byteLength > 0) {
          controller.enqueue(new Uint8Array(piece));
        }
        if (total >= control.maxBytes) {
          finish();
        }
      });
      source.on("end", finish);
      // 원본 상한으로 압축 해제를 중간에 끊었으면 "파일 끝 예상 못 함" 오류가 나는 게 정상 → 푼 만큼으로 끝낸다.
      source.on("error", (error: Error) =>
        rawCapped ? finish() : fail(error)
      );
      if (decoder) {
        const countRaw = (chunk: Buffer) => {
          raw += chunk.byteLength;
          if (raw > control.maxBytes) {
            // 압축 상태로도 상한을 넘으면 더 받지 않는다(지금까지 푼 만큼만 돌려준다).
            rawCapped = true;
            res.off("data", countRaw);
            res.unpipe(decoder);
            res.pause();
            decoder.end();
          }
        };
        res.on("error", (error: Error) => fail(error));
        res.pipe(decoder);
        // pipe 다음에 건다: 같은 조각을 pipe 가 먼저 넘긴 뒤 상한을 판정해야 "끝난 뒤 쓰기" 오류가 없다.
        res.on("data", countRaw);
      }
    },
    cancel() {
      finished = true;
      decoder?.destroy();
      res.destroy();
      control.onDone();
    },
  });
}

function targetOf(input: Parameters<FetchLike>[0]): {
  url: URL;
  method: string;
} {
  if (typeof input === "string" || input instanceof URL) {
    return { url: new URL(String(input)), method: "GET" };
  }
  return { url: new URL(input.url), method: input.method.toUpperCase() };
}

interface ValidRequest {
  headers: Record<string, string>;
  method: string;
  signal: AbortSignal | undefined;
  url: URL;
}

/** 받지 않는 요청 모양을 먼저 거른다(fail-closed). */
function validateRequest(
  input: Parameters<FetchLike>[0],
  init: Parameters<FetchLike>[1]
): ValidRequest {
  const { url, method: inputMethod } = targetOf(input);
  const method = (init?.method ?? inputMethod).toUpperCase();
  if (!(url.protocol === "https:" || url.protocol === "http:")) {
    throw blocked("protocol");
  }
  if (url.username || url.password) {
    throw blocked("credentials in url");
  }
  if (method !== "GET" && method !== "HEAD") {
    throw new TypeError("pinned fetch supports GET/HEAD only");
  }
  if (init?.body != null) {
    throw new TypeError("pinned fetch does not send a body");
  }
  if (init?.redirect !== "manual") {
    // 자동 추적은 매 단계 검사를 건너뛰게 되므로 받지 않는다(fail-closed).
    throw new TypeError("pinned fetch requires redirect: manual");
  }
  const signal = init?.signal ?? undefined;
  if (signal?.aborted) {
    throw abortError(signal);
  }
  const headers: Record<string, string> = {};
  new Headers(init?.headers).forEach((value, name) => {
    headers[name] = value;
  });
  headers["accept-encoding"] = "gzip, deflate, br";
  headers.connection = "close";
  // Host 는 호출자 값을 무시하고 지금 URL 로 강제한다(연결 대상·SNI 와 다른 Host 를 보내지 않게).
  headers.host = url.host;
  return { headers, method, signal, url };
}

function defaultPort(secure: boolean): number {
  return secure ? 443 : 80;
}

/** 응답 헤더를 받은 뒤: 본문 스트림(상한)을 붙인 Response 를 만든다. 받을 수 없는 응답이면 Error. */
function buildResponse(
  res: IncomingMessage,
  method: string,
  control: BodyControl
): Response | Error {
  const status = res.statusCode ?? 0;
  if (status < 200 || status > 599) {
    return new TypeError("invalid status");
  }
  const noBody = method === "HEAD" || NULL_BODY_STATUS.has(status);
  if (noBody) {
    res.destroy();
    control.onDone();
    return new Response(null, {
      status,
      statusText: res.statusMessage ?? "",
      headers: toHeaders(res, false),
    });
  }
  const decoder = decoderFor(String(res.headers["content-encoding"] ?? ""));
  if (decoder === "unsupported") {
    return new TypeError("unsupported content-encoding");
  }
  return new Response(limitedBody(res, decoder, control), {
    status,
    statusText: res.statusMessage ?? "",
    headers: toHeaders(res, decoder !== null),
  });
}

interface SendPlan {
  maxBytes: number;
  plan: ConnectPlan;
  request: ValidRequest;
  timeoutMs: number;
}

/** 요청 1건을 고정된 소켓으로 보낸다. 시간 제한은 연결~본문 끝까지 하나로 잰다. */
function sendPinned({
  maxBytes,
  plan,
  request,
  timeoutMs,
}: SendPlan): Promise<Response> {
  const { headers, method, signal, url } = request;
  return new Promise<Response>((resolve, reject) => {
    let settled = false;
    let bodyFail: ((error: Error) => void) | null = null;
    const agent = isolatedAgent(plan);
    const cleanup = () => {
      if (timer) {
        clearTimeout(timer);
      }
      signal?.removeEventListener("abort", onAbort);
      agent.destroy();
    };
    const stop = (error: Error) => {
      req.destroy();
      cleanup();
      if (settled) {
        bodyFail?.(error);
        return;
      }
      settled = true;
      reject(error);
    };
    const onAbort = () => stop(signal ? abortError(signal) : timeoutError());
    // 호출자 signal(전체 deadline)이 있으면 그것만 따른다. 없을 때만 자체 시간 제한.
    const timer = signal
      ? undefined
      : setTimeout(() => stop(timeoutError()), timeoutMs);
    signal?.addEventListener("abort", onAbort, { once: true });

    const requestFn = plan.secure ? httpsRequest : httpRequest;
    const req = requestFn({
      agent,
      headers,
      host: plan.host,
      method,
      path: `${url.pathname}${url.search}`,
      port: url.port ? Number(url.port) : defaultPort(plan.secure),
    });
    req.on("error", (error: Error) => stop(error));
    req.on("response", (res) => {
      if (settled) {
        res.destroy();
        return;
      }
      const out = buildResponse(res, method, {
        maxBytes,
        onDone: cleanup,
        registerFail: (fail) => {
          bodyFail = fail;
        },
      });
      if (out instanceof Error) {
        stop(out);
        return;
      }
      settled = true;
      resolve(out);
    });
    req.end();
  });
}

/**
 * 연결 주소를 고정하는 fetch 를 만든다. GET/HEAD·본문 없는 요청만, 리다이렉트는 `redirect: "manual"` 만 받는다.
 * 같은 모양(`typeof fetch`)이라 official-facts 의 fetchImpl 주입 구조에 그대로 꽂힌다.
 */
export function createPinnedFetch(options: PinnedFetchOptions = {}): FetchLike {
  const resolveAll = options.resolveAll ?? defaultResolveAll;
  const isPrivate = options.isPrivate ?? isPrivateAddress;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const pinnedFetch = async (
    input: Parameters<FetchLike>[0],
    init?: Parameters<FetchLike>[1]
  ): Promise<Response> => {
    const request = validateRequest(input, init);
    const host = bareHost(request.url);
    const secure = request.url.protocol === "https:";
    const pinned = await resolvePinned(
      host,
      resolveAll,
      isPrivate,
      request.signal
    );
    const urlPort = request.url.port
      ? Number(request.url.port)
      : defaultPort(secure);
    return await sendPinned({
      maxBytes,
      plan: {
        ca: options.ca,
        host,
        isPrivate,
        pinned,
        port: options.portOverride ?? urlPort,
        secure,
      },
      request,
      timeoutMs,
    });
  };
  return pinnedFetch as FetchLike;
}

/** 운영 기본값(512KB·5초·실제 DNS). */
export const pinnedFetch: FetchLike = createPinnedFetch();
