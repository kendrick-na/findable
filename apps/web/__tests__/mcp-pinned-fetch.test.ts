/**
 * 연결 주소 고정(DNS 핀) fetch 시험 — 외부 네트워크 없음.
 * 로컬 https 모의 서버(127.0.0.1, 시험마다 새로 만든 자체 인증서)에만 붙는다. DNS 는 모의 함수로 바꾼다.
 * 시험 세계의 규칙: 127.0.0.1 = "공개 주소"(모의 서버), 그 밖(10.0.0.1 등) = 사설.
 * @vitest-environment node
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { createServer as createHttpsServer } from "node:https";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TLSSocket } from "node:tls";
import { gzipSync } from "node:zlib";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.mock("@repo/audit/public-url-security", async (importOriginal) => {
  const real =
    await importOriginal<typeof import("@repo/audit/public-url-security")>();
  return {
    ...real,
    // 실제 DNS 없이: 아래 모의 세계의 호스트는 사전 확인을 통과시킨다(핀 fetch 가 최종 판정).
    assertPublicUrl: vi.fn(() => Promise.resolve()),
  };
});

import { confinedFetch } from "@/lib/mcp/geo-tools";
import { checkOfficialFacts } from "@/lib/mcp/official-facts";
import {
  createPinnedFetch,
  type PinnedFetchOptions,
  type ResolvedAddress,
} from "@/lib/mcp/pinned-fetch";

const PUBLIC_IP = "127.0.0.1";
const PRIVATE_IP = "10.0.0.1";
const testIsPrivate = (address: string) =>
  !(address === PUBLIC_IP || address === `::ffff:${PUBLIC_IP}`);

function makeCert(): { dir: string; key: string; cert: string } | null {
  const dir = mkdtempSync(join(tmpdir(), "pinned-fetch-"));
  try {
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        join(dir, "key.pem"),
        "-out",
        join(dir, "cert.pem"),
        "-days",
        "1",
        "-subj",
        "/CN=pinned.test",
        "-addext",
        "subjectAltName=DNS:pinned.test,DNS:other.pinned.test",
      ],
      { stdio: "ignore" }
    );
    return {
      dir,
      key: readFileSync(join(dir, "key.pem"), "utf8"),
      cert: readFileSync(join(dir, "cert.pem"), "utf8"),
    };
  } catch {
    rmSync(dir, { recursive: true, force: true });
    return null;
  }
}

const tls = makeCert();

type Handler = (req: IncomingMessage, res: ServerResponse) => void;
const state = {
  connections: 0,
  requests: 0,
  servernames: [] as (string | false | null)[],
  handler: ((_req, res) => res.end("ok")) as Handler,
};

let server: Server;
let port = 0;

function listen(s: Server): Promise<number> {
  return new Promise((resolve) => {
    s.listen(0, PUBLIC_IP, () => resolve((s.address() as AddressInfo).port));
  });
}

beforeAll(async () => {
  if (!tls) {
    return;
  }
  server = createHttpsServer({ key: tls.key, cert: tls.cert }, (req, res) => {
    state.requests += 1;
    state.servernames.push((req.socket as TLSSocket).servername);
    state.handler(req, res);
  });
  server.on("connection", () => {
    state.connections += 1;
  });
  port = await listen(server);
});

afterAll(async () => {
  if (tls) {
    await new Promise((r) => server.close(r));
    rmSync(tls.dir, { recursive: true, force: true });
  }
});

beforeEach(() => {
  state.connections = 0;
  state.requests = 0;
  state.servernames = [];
  state.handler = (_req, res) => res.end("ok");
});

function dnsOf(table: Record<string, ResolvedAddress[]>) {
  return vi.fn((host: string) => {
    const found = table[host];
    return found
      ? Promise.resolve(found)
      : Promise.reject(new Error("ENOTFOUND"));
  });
}

function make(extra: PinnedFetchOptions = {}) {
  return createPinnedFetch({
    ca: tls?.cert,
    isPrivate: testIsPrivate,
    portOverride: port,
    timeoutMs: 3000,
    ...extra,
  });
}

const GET = { redirect: "manual" } as const;

describe.skipIf(!tls)("DNS 핀 fetch (로컬 https 모의 서버)", () => {
  it("정상 공개 사이트는 통과하고, TLS 는 원래 호스트명으로 SNI·인증서를 검증한다", async () => {
    const resolveAll = dnsOf({
      "pinned.test": [{ address: PUBLIC_IP, family: 4 }],
    });
    const res = await make({ resolveAll })("https://pinned.test/", GET);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
    expect(state.servernames).toEqual(["pinned.test"]);
    expect(resolveAll).toHaveBeenCalledTimes(1);
  });

  it("재바인딩: 검사 때 공개 → 이후 사설로 바뀌어도 이름은 한 번만 해석되고 연결은 검사한 IP 로만 간다", async () => {
    let calls = 0;
    const resolveAll = vi.fn(() => {
      calls += 1;
      return Promise.resolve([
        { address: calls === 1 ? PUBLIC_IP : PRIVATE_IP, family: 4 },
      ]);
    });
    const pinned = make({ resolveAll });
    const res = await pinned("https://pinned.test/", GET);
    expect(await res.text()).toBe("ok");
    // 연결 단계에서 DNS 를 다시 묻지 않는다(묻는다면 2번째 응답 = 사설로 갔을 것).
    expect(resolveAll).toHaveBeenCalledTimes(1);
    expect(state.requests).toBe(1);
    // 다음 요청에서 사설로 바뀐 응답은 연결 전에 거부된다.
    await expect(pinned("https://pinned.test/", GET)).rejects.toThrow(
      "address not public"
    );
    expect(state.connections).toBe(1);
  });

  it("해석 결과에 사설 주소가 하나라도 섞이면 연결 0건으로 거부한다", async () => {
    const resolveAll = dnsOf({
      "pinned.test": [
        { address: PUBLIC_IP, family: 4 },
        { address: PRIVATE_IP, family: 4 },
      ],
    });
    await expect(
      make({ resolveAll })("https://pinned.test/", GET)
    ).rejects.toThrow("address not public");
    expect(state.connections).toBe(0);
  });

  it("사설 IP 직접 주소는 DNS 없이 거부한다", async () => {
    const resolveAll = vi.fn();
    await expect(
      make({ resolveAll })(`https://${PRIVATE_IP}/`, GET)
    ).rejects.toThrow("address not public");
    expect(resolveAll).not.toHaveBeenCalled();
  });

  it("연결 직후 실제 상대 주소(remoteAddress)가 사설이면 요청을 보내기 전에 끊는다", async () => {
    const resolveAll = dnsOf({
      "pinned.test": [{ address: PUBLIC_IP, family: 4 }],
    });
    let checks = 0;
    // 1번째 판정(DNS 단계)은 통과, 2번째 판정(연결 직후)은 사설 → 이중 방어가 잡는지 본다.
    const isPrivate = (address: string) => {
      checks += 1;
      return checks === 1 ? testIsPrivate(address) : true;
    };
    await expect(
      make({ resolveAll, isPrivate })("https://pinned.test/", GET)
    ).rejects.toThrow("connected address not public");
    expect(state.requests).toBe(0);
  });

  it("자체 인증서를 신뢰하지 않으면(운영 기본) 연결을 거부한다 — 인증서 검증이 켜져 있다", async () => {
    const resolveAll = dnsOf({
      "pinned.test": [{ address: PUBLIC_IP, family: 4 }],
    });
    await expect(
      make({ resolveAll, ca: undefined })("https://pinned.test/", GET)
    ).rejects.toThrow();
    expect(state.requests).toBe(0);
  });

  it("인증서에 없는 호스트명으로는 같은 IP 라도 거부한다(servername 검증)", async () => {
    const resolveAll = dnsOf({
      "evil.test": [{ address: PUBLIC_IP, family: 4 }],
    });
    await expect(
      make({ resolveAll })("https://evil.test/", GET)
    ).rejects.toThrow();
    expect(state.requests).toBe(0);
  });

  it("본문은 512KB 에서 끊는다(평문)", async () => {
    state.handler = (_req, res) => res.end(Buffer.alloc(2 * 1024 * 1024, 97));
    const resolveAll = dnsOf({
      "pinned.test": [{ address: PUBLIC_IP, family: 4 }],
    });
    const res = await make({ resolveAll })("https://pinned.test/", GET);
    expect((await res.arrayBuffer()).byteLength).toBe(512 * 1024);
  });

  it("압축 폭탄(gzip 64MB→작은 원본)도 압축 해제 후 512KB 에서 끊는다", async () => {
    const bomb = gzipSync(Buffer.alloc(64 * 1024 * 1024, 0));
    state.handler = (_req, res) => {
      res.writeHead(200, { "content-encoding": "gzip" });
      res.end(bomb);
    };
    const resolveAll = dnsOf({
      "pinned.test": [{ address: PUBLIC_IP, family: 4 }],
    });
    const res = await make({ resolveAll })("https://pinned.test/", GET);
    expect(res.headers.get("content-encoding")).toBeNull();
    expect((await res.arrayBuffer()).byteLength).toBe(512 * 1024);
  });

  it("압축 원본 자체가 512KB 를 넘으면(빈 gzip 조각 수만 개) 더 받지 않고 끝낸다", async () => {
    const empty = gzipSync(Buffer.alloc(0));
    const pieces = Math.ceil((600 * 1024) / empty.byteLength);
    const padded = Buffer.concat([
      gzipSync("head"),
      ...Array.from({ length: pieces }, () => empty),
    ]);
    state.handler = (_req, res) => {
      res.writeHead(200, { "content-encoding": "gzip" });
      res.end(padded);
    };
    const resolveAll = dnsOf({
      "pinned.test": [{ address: PUBLIC_IP, family: 4 }],
    });
    const res = await make({ resolveAll, timeoutMs: 2000 })(
      "https://pinned.test/",
      GET
    );
    expect(await res.text()).toBe("head");
  });

  it("정상 gzip 응답은 풀어서 돌려준다", async () => {
    state.handler = (_req, res) => {
      res.writeHead(200, { "content-encoding": "gzip" });
      res.end(gzipSync("hello gzip"));
    };
    const resolveAll = dnsOf({
      "pinned.test": [{ address: PUBLIC_IP, family: 4 }],
    });
    const res = await make({ resolveAll })("https://pinned.test/", GET);
    expect(await res.text()).toBe("hello gzip");
  });

  it("모르는 Content-Encoding 은 확인 불가(거부)로 둔다", async () => {
    state.handler = (_req, res) => {
      res.writeHead(200, { "content-encoding": "compress" });
      res.end("x");
    };
    const resolveAll = dnsOf({
      "pinned.test": [{ address: PUBLIC_IP, family: 4 }],
    });
    await expect(
      make({ resolveAll })("https://pinned.test/", GET)
    ).rejects.toThrow("unsupported content-encoding");
  });

  it("응답이 없으면 전체 시간 제한으로 TimeoutError", async () => {
    state.handler = () => undefined; // 끝까지 응답하지 않는다
    const resolveAll = dnsOf({
      "pinned.test": [{ address: PUBLIC_IP, family: 4 }],
    });
    await expect(
      make({ resolveAll, timeoutMs: 200 })("https://pinned.test/", GET)
    ).rejects.toMatchObject({ name: "TimeoutError" });
  });

  it("리다이렉트는 따라가지 않고 3xx 를 그대로 돌려준다 / 자동 추적·POST 는 받지 않는다", async () => {
    state.handler = (_req, res) => {
      res.writeHead(302, { location: "https://elsewhere.test/" });
      res.end();
    };
    const resolveAll = dnsOf({
      "pinned.test": [{ address: PUBLIC_IP, family: 4 }],
    });
    const pinned = make({ resolveAll });
    const res = await pinned("https://pinned.test/", GET);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://elsewhere.test/");
    await expect(pinned("https://pinned.test/")).rejects.toThrow(
      "redirect: manual"
    );
    await expect(
      pinned("https://pinned.test/", { ...GET, method: "POST" })
    ).rejects.toThrow("GET/HEAD");
  });
});

describe.skipIf(!tls)(
  "공식 사실 점검 + 허용 목록 + DNS 핀 (리다이렉트 단계마다 재검사)",
  () => {
    const resolveAll = dnsOf({
      "pinned.test": [{ address: PUBLIC_IP, family: 4 }],
      "inner.test": [{ address: PRIVATE_IP, family: 4 }],
      "evil.test": [{ address: PUBLIC_IP, family: 4 }],
    });

    it("허용 목록 밖으로의 리다이렉트·사설로 해석되는 호스트로의 리다이렉트는 따라가지 않는다", async () => {
      state.handler = (req, res) => {
        if (req.url === "/") {
          res.writeHead(302, { location: "https://evil.test/" });
        } else if (req.url === "/robots.txt") {
          res.writeHead(302, { location: "https://inner.test/robots.txt" });
        } else if (req.url === "/sitemap.xml") {
          res.writeHead(200, { "content-type": "application/xml" });
          res.end("<urlset></urlset>");
          return;
        } else {
          res.writeHead(404);
        }
        res.end();
      };
      resolveAll.mockClear();
      const fetchImpl = confinedFetch(
        new Set(["pinned.test", "inner.test"]),
        make({ resolveAll })
      );
      const out = await checkOfficialFacts("https://pinned.test", fetchImpl);
      const byKey = Object.fromEntries(out.items.map((i) => [i.key, i.status]));
      expect(byKey.json_ld).toBe("error"); // evil.test 로 가는 리다이렉트 차단(허용 목록 밖)
      expect(byKey.robots_ai_crawlers).toBe("unknown"); // inner.test → 사설 해석 → 차단
      expect(byKey.sitemap).toBe("found"); // 정상 경로는 통과
      // evil.test 는 허용 목록에서 막혀 DNS 조회조차 하지 않는다.
      expect(resolveAll.mock.calls.map((c) => c[0])).not.toContain("evil.test");
      expect(resolveAll.mock.calls.map((c) => c[0])).toContain("inner.test");
      // 모의 서버가 받은 요청은 pinned.test 의 4개뿐(리다이렉트 대상으로 새 연결이 가지 않음).
      expect(state.requests).toBe(4);
    });
  }
);

describe("평문 http 도 같은 핀을 쓴다", () => {
  let plain: Server;
  let plainPort = 0;
  beforeAll(async () => {
    plain = createHttpServer((_req, res) => res.end("plain ok"));
    plainPort = await listen(plain);
  });
  afterAll(async () => {
    await new Promise((r) => plain.close(r));
  });

  it("공개로 해석되면 통과, 사설로 해석되면 연결 전 거부", async () => {
    const ok = createPinnedFetch({
      isPrivate: testIsPrivate,
      portOverride: plainPort,
      resolveAll: dnsOf({ "plain.test": [{ address: PUBLIC_IP, family: 4 }] }),
    });
    expect(await (await ok("http://plain.test/", GET)).text()).toBe("plain ok");
    const bad = createPinnedFetch({
      isPrivate: testIsPrivate,
      portOverride: plainPort,
      resolveAll: dnsOf({ "plain.test": [{ address: PRIVATE_IP, family: 4 }] }),
    });
    await expect(bad("http://plain.test/", GET)).rejects.toThrow(
      "address not public"
    );
  });
});
