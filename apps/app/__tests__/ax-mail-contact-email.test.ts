/** @vitest-environment node */
import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

const ce = await import("@/lib/ax-mail/sources/contact-email");
const card = await import("@/lib/ax-mail/sources/company-card");

/*
 * 픽스처 = 네트워크 없이 HTML 문자열만. 바이오센서연구소(Franz) 푸터 문구는 2026-10-07
 * franzskincare.com 공개 푸터의 모양을 옮긴 것(공개 회사 메일).
 */
const AT = new Date("2026-10-07T01:00:00.000Z");

type Pages = Record<
  string,
  { status?: number; body: string; headers?: Record<string, string> }
>;

/** 주소 → 응답. 없는 주소는 404. 호출된 주소를 기록한다. */
function fakeFetch(pages: Pages) {
  const calls: string[] = [];
  const impl = ((input: URL | RequestInfo) => {
    const url = input.toString();
    calls.push(url);
    const page = pages[url];
    const status = page?.status ?? (page ? 200 : 404);
    return Promise.resolve(
      new Response(page?.body ?? "", {
        headers: {
          "content-type": "text/html; charset=utf-8",
          ...page?.headers,
        },
        status,
      })
    );
  }) as typeof fetch;
  return { calls, impl };
}

function firstOf<T>(list: T[]): T {
  const [head] = list;
  if (head === undefined) {
    throw new Error("empty list");
  }
  return head;
}

const deps = (impl: typeof fetch) => ({
  assertUrl: () => Promise.resolve(),
  delayMs: 0,
  fetchImpl: impl,
  now: () => AT,
});

const FRANZ_FOOTER = `<html><body><main>앰플</main>
<footer><p>상호: 바이오센서연구소(주) | 대표: 정석근 | 사업자등록번호: 119-86-72928</p>
<p>개인정보 보호책임자: 정석근 E-mail: franz@biosensorlab.com Global Sales Contact: franz@biosensorlab.com</p>
</footer></body></html>`;

describe("공개 회사 메일 찾기", () => {
  test("Franz 푸터 — 같은 주소의 여러 라벨 중 제휴(Global Sales)를 택한다", async () => {
    const { impl } = fakeFetch({
      "https://franzskincare.com/": { body: FRANZ_FOOTER },
      "https://franzskincare.com/robots.txt": {
        body: "User-agent: *\nDisallow: /*board*page=\n",
        headers: { "content-type": "text/plain" },
      },
    });
    const result = await ce.findContactEmails(
      { brandNames: ["Franz"], domain: "https://www.franzskincare.com/" },
      deps(impl)
    );
    expect(result.status).toBe("ok");
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      email: "franz@biosensorlab.com",
      fetchedAt: AT.toISOString(),
      label: "Global Sales Contact",
      role: "partnership",
      sameDomain: false,
      sourceUrl: "https://franzskincare.com/",
    });
    const basis = ce.publicContactBasis(firstOf(result.candidates));
    expect(basis).toMatchObject({ date: "2026-10-07", kind: "public_contact" });
    expect(basis.detail).toContain("https://franzskincare.com/");
  });

  test("무단수집 거부 게시 → refused, 후보 0개, 다음 페이지 안 읽음", async () => {
    const { calls, impl } = fakeFetch({
      "https://brand.com/": {
        body: `<a href="/contact">Contact</a><footer>info@brand.com
          <a href="/policy/email">이메일 무단 수집 거부</a></footer>`,
      },
    });
    const result = await ce.findContactEmails(
      { domain: "brand.com" },
      deps(impl)
    );
    expect(result.status).toBe("refused");
    expect(result.candidates).toEqual([]);
    expect(calls).not.toContain("https://brand.com/contact");
  });

  test("거부 문구 변형(전자우편주소무단수집거부·이미지 alt)도 잡는다", () => {
    expect(ce.hasCollectionRefusal("<p>전자우편주소 무단 수집 거부</p>")).toBe(
      true
    );
    expect(ce.hasCollectionRefusal('<img alt="이메일무단수집거부">')).toBe(
      true
    );
    expect(ce.hasCollectionRefusal("<p>이메일 문의 info@x.com</p>")).toBe(
      false
    );
  });

  test("robots.txt 가 막은 페이지는 요청하지 않는다", async () => {
    const { calls, impl } = fakeFetch({
      "https://brand.com/": {
        body: `<a href="/contact">문의하기</a><a href="/partnership">제휴 문의</a>`,
      },
      "https://brand.com/robots.txt": {
        body: "User-agent: *\nDisallow: /contact\n",
        headers: { "content-type": "text/plain" },
      },
      "https://brand.com/partnership": {
        body: "<p>제휴 문의: biz@brand.com</p>",
      },
    });
    const result = await ce.findContactEmails(
      { domain: "brand.com" },
      deps(impl)
    );
    expect(calls).not.toContain("https://brand.com/contact");
    expect(calls).toContain("https://brand.com/partnership");
    expect(result.candidates[0]).toMatchObject({
      email: "biz@brand.com",
      role: "partnership",
      sameDomain: true,
      sourceUrl: "https://brand.com/partnership",
    });
  });

  test("홈페이지부터 robots 금지 → blocked_by_robots, 홈페이지 요청 없음", async () => {
    const { calls, impl } = fakeFetch({
      "https://brand.com/robots.txt": {
        body: "User-agent: *\nDisallow: /\n",
        headers: { "content-type": "text/plain" },
      },
    });
    const result = await ce.findContactEmails(
      { domain: "brand.com" },
      deps(impl)
    );
    expect(result.status).toBe("blocked_by_robots");
    expect(calls).toEqual(["https://brand.com/robots.txt"]);
  });

  test("「sales [at] brand.com」 난독화와 mailto 버튼을 읽는다", async () => {
    const { impl } = fakeFetch({
      "https://brand.com/": {
        body: `<p>Wholesale: sales [at] brand.com</p>
          <a href="mailto:press&#64;brand.com?subject=hi">보도자료 문의</a>`,
      },
    });
    const result = await ce.findContactEmails(
      { domain: "brand.com" },
      deps(impl)
    );
    expect(result.candidates.map((c) => [c.email, c.role])).toEqual([
      ["sales@brand.com", "partnership"],
      ["press@brand.com", "press"],
    ]);
  });

  test("이미지 파일명(logo@2x.png)·플랫폼 주소는 버린다", async () => {
    const { impl } = fakeFetch({
      "https://brand.com/": {
        body: `<img src="/img/logo@2x.png"><script>var dsn="abc@o1.ingest.sentry.io"</script>
          <p>hello@brand.com</p><p>help@cafe24.com</p><p>user@example.com</p>
          <p>icon-logo@2x.png bg@3x.webp</p><p>abc@o1.ingest.sentry.io</p>`,
      },
    });
    const result = await ce.findContactEmails(
      { domain: "brand.com" },
      deps(impl)
    );
    expect(result.candidates.map((c) => c.email)).toEqual(["hello@brand.com"]);
  });

  test("같은 역할이면 회사 도메인 메일이 무료메일(gmail·naver)보다 앞", async () => {
    const { impl } = fakeFetch({
      "https://brand.com/": {
        body: `<p>문의: brandkr@gmail.com</p><p>문의: info@brand.com</p>
          <p>개인정보보호책임자: privacy@brand.com</p>`,
      },
    });
    const result = await ce.findContactEmails(
      { domain: "brand.com" },
      deps(impl)
    );
    expect(result.candidates.map((c) => c.email)).toEqual([
      "info@brand.com",
      "brandkr@gmail.com",
      "privacy@brand.com",
    ]);
    expect(ce.pickSalesContact(result.candidates)?.email).toBe(
      "info@brand.com"
    );
    expect(ce.pickSalesContact(result.candidates.slice(2))).toBeNull();
  });

  test("다른 도메인 링크는 따라가지 않고, 페이지 상한(6)을 지킨다", async () => {
    const links = Array.from(
      { length: 10 },
      (_, i) => `<a href="/contact-${i}">문의 ${i}</a>`
    ).join("");
    const { calls, impl } = fakeFetch({
      "https://brand.com/": {
        body: `${links}<a href="https://other.com/contact">문의</a>`,
      },
    });
    await ce.findContactEmails({ domain: "brand.com" }, deps(impl));
    const pageCalls = calls.filter((u) => !u.endsWith("/robots.txt"));
    expect(pageCalls).toHaveLength(6);
    expect(calls.some((u) => u.startsWith("https://other.com"))).toBe(false);
  });

  test("다른 TLD 의 같은 이름 도메인(purito.com ↔ purito.co.kr)은 회사 도메인으로 본다", async () => {
    const { impl } = fakeFetch({
      "https://purito.com/": {
        body: "<p>Distribution, Wholesale Inquiries: sales@purito.co.kr</p>",
      },
    });
    const result = await ce.findContactEmails(
      { domain: "purito.com" },
      deps(impl)
    );
    expect(result.candidates[0]).toMatchObject({
      email: "sales@purito.co.kr",
      role: "partnership",
      sameDomain: true,
    });
  });

  test("「영업시간」은 영업(제휴)으로 보지 않는다", async () => {
    const { impl } = fakeFetch({
      "https://brand.com/": {
        body: "<p>고객센터 영업시간 10-17시 cs@brand.com</p><p>국내영업: biz2@brand.com</p>",
      },
    });
    const result = await ce.findContactEmails(
      { domain: "brand.com" },
      deps(impl)
    );
    expect(result.candidates.map((c) => [c.email, c.role])).toEqual([
      ["biz2@brand.com", "partnership"],
      ["cs@brand.com", "cs"],
    ]);
  });

  test("Cloudflare 이메일 보호 해독", () => {
    // 키 0x12 로 "a@b.co" 각 글자를 XOR 한 값(손으로 계산: a=73 @=52 b=70 .=3c c=71 o=7d)
    const hex = "127352703c717d";
    expect(ce.decodeCloudflareEmail(hex)).toBe("a@b.co");
  });

  test("회사 카드 — 도메인 있을 때만 contacts 칸", () => {
    const contacts = {
      candidates: [],
      checkedUrls: ["https://brand.com/"],
      status: "none" as const,
    };
    const withDomain = card.mergeCompanyCard(
      { domain: "brand.com", name: "브랜드" },
      { contacts },
      AT.toISOString()
    );
    expect(withDomain.contacts).toMatchObject({
      fetchedAt: AT.toISOString(),
      source: "website",
      status: "none",
    });
    const noDomain = card.mergeCompanyCard(
      { name: "브랜드" },
      { contacts },
      AT.toISOString()
    );
    expect(noDomain.contacts).toBeNull();
  });
});
