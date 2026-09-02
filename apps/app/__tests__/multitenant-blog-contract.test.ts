/**
 * 🔴 **왜 이 테스트가 있나** (2026-09-02 — 고객사 블로그 전수 점검)
 *
 * 고객사가 대시보드에서 자기 블로그를 발행하기 시작하면, 같은 글이 **두 호스트**에 뜬다:
 *   ① `www.findable.co.kr/{locale}/p/{퍼블리셔}/{글}`   ② `{고객도메인}/p/{글}`
 * 이때 조용히 깨지는 것들이 있었고(실측), 아래가 그 재발 가드다.
 *
 *   ① 새 글이 **404** — 글 페이지가 `dynamicParams = false` 였다.
 *      Next 공식: *"generateStaticParams 에 없는 동적 세그먼트는 404 를 반환한다."*
 *      → 재배포 전까지 고객 글이 없는 페이지였다. (가드는 `content-platform-contract` 에)
 *   ② **양쪽이 각자 자기 canonical** → 동일 콘텐츠가 무관한 두 원본으로 보였다.
 *   ③ 뉴스 사이트맵이 전 글을 `<news:name>Findable</news:name>` 로 신고 → 고객사 글의
 *      발행처를 우리로 오신고.
 *   ④ 고객 도메인 페이지가 `createMetadata` 를 쓰면 **남의 브랜드 제목에 `| Findable`** 이
 *      붙고 canonical·og 가 우리 도메인으로 나간다.
 *   ⑤ 발행 후 캐시 무효화가 **다른 배포**를 향해 호출되어 무효였다(앱→웹).
 *
 * ⚠️ 네트워크를 타지 않는다 — 소스의 계약만 검사한다.
 *   📕 규율: 가드는 구현을 못박지 말고 **의도(불변식)** 를 검사한다.
 *     (feedback_guard_defends_the_bug)
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "../../..");
const read = (file: string) => readFileSync(join(ROOT, file), "utf8");

const publicUrl = read("apps/web/lib/public-url.ts");
const content = read("apps/web/lib/content.ts");
const sitemap = read("apps/web/app/sitemap.ts");
const newsSitemap = read("apps/web/app/news-sitemap.xml/route.ts");
const rss = read("apps/web/app/rss.xml/route.ts");
const publisherRss = read(
  "apps/web/app/[locale]/p/[publisherSlug]/rss.xml/route.ts"
);
const customArticle = read(
  "apps/web/app/[locale]/site/[customDomain]/[postSlug]/page.tsx"
);
const customHome = read("apps/web/app/[locale]/site/[customDomain]/page.tsx");
const manageAction = read("apps/app/app/actions/content/manage.ts");
const publishCron = read("apps/web/app/api/cron/content-publishing/route.ts");
const indexNow = read("apps/web/lib/indexnow.ts");
const revalidateRoute = read("apps/web/app/api/revalidate/route.ts");

const CANONICAL_POLICY_RE =
  /const CANONICAL_HOST_POLICY: "custom-domain" \| "findable"/;
const NEWS_NAME_FROM_PUBLISHER =
  /news:name>\$\{escapeXml\(post\.publisher\.name\)/;
/**
 * `createMetadata` 를 **실제로 쓰는지**만 본다 — import 또는 호출.
 * ⚠️ 단어만 찾으면 *"여기는 createMetadata 를 쓰지 않는다"* 라고 적어 둔 **주석에 걸린다**
 *   (실제로 걸렸다). 가드는 문구가 아니라 계약을 검사한다.
 */
const CREATE_METADATA_USED = /import\s*\{[^}]*createMetadata|createMetadata\(/;
/** 공개 키 파일과 짝을 맞춰야 하는 IndexNow 키 상수. */
const INDEXNOW_KEY_RE =
  /INDEXNOW_KEY =\s*\n?\s*process\.env\.INDEXNOW_KEY \?\? "([^"]+)"/;

describe("고객사 블로그 — 정본 URL 이 한 곳에서 결정된다", () => {
  it("🔴 정본 판정 모듈이 정책 상수와 두 판정 함수를 노출한다", () => {
    expect(
      publicUrl,
      "정본 호스트 정책이 상수로 선언돼 있어야 한다 — 흩어지면 사이트맵·피드·페이지가 서로 다른 정본을 신고한다"
    ).toMatch(CANONICAL_POLICY_RE);
    expect(publicUrl).toContain("export function articleCanonicalUrl");
    expect(publicUrl).toContain("export function isCanonicalOnSite");
  });

  it("🔴 정본 판정에 필요한 커스텀 도메인 필드를 DB 에서 읽는다", () => {
    // 이 두 필드가 select 에서 빠지면 `isCanonicalOnSite` 가 항상 true 를 반환해
    // **조용히** 우리 도메인 URL 로만 조립된다(타입 오류도 안 난다).
    expect(content).toContain("customDomain: true");
    expect(content).toContain("customDomainStatus: true");
  });

  it("🔴 사이트맵·뉴스·RSS 는 자기 호스트가 정본인 글만 싣는다", () => {
    for (const [name, code] of [
      ["sitemap", sitemap],
      ["news-sitemap", newsSitemap],
      ["rss", rss],
    ] as const) {
      expect(
        code,
        `${name} 이 isCanonicalOnSite 필터를 잃었다 — 남의 호스트 URL 을 우리 사이트맵에 담으면 교차제출이라 무시된다`
      ).toContain("isCanonicalOnSite");
    }
  });
});

describe("고객사 블로그 — 발행처를 우리로 오신고하지 않는다", () => {
  it("🔴 뉴스 사이트맵의 발행처는 퍼블리셔 이름이다", () => {
    expect(
      newsSitemap,
      "news:name 이 하드코딩으로 돌아갔다 — 고객사 글을 Findable 발행물로 신고하게 된다"
    ).toMatch(NEWS_NAME_FROM_PUBLISHER);
    expect(newsSitemap).not.toMatch(/news:name>Findable</);
  });

  it("🔴 고객 도메인 페이지는 우리 도메인용 createMetadata 를 쓰지 않는다", () => {
    for (const [name, code] of [
      ["글 페이지", customArticle],
      ["블로그 홈", customHome],
    ] as const) {
      expect(
        code,
        `고객 도메인 ${name} 이 createMetadata 를 쓰면 제목에 "| Findable" 이 붙고 canonical·og 가 우리 도메인으로 나간다`
      ).not.toMatch(CREATE_METADATA_USED);
      expect(code, `고객 도메인 ${name} 에 메타데이터가 없다`).toContain(
        "generateMetadata"
      );
      expect(code).toContain("canonical");
    }
  });

  it("고객사가 제출할 자기 RSS 가 존재한다", () => {
    // 네이버 서치어드바이저의 색인 경로 중 하나가 RSS 제출이다(1차 리서치 §1-8).
    expect(publisherRss).toContain("buildRssXml");
    expect(publisherRss).toContain("articleCanonicalUrl");
    // 고객 도메인으로 들어온 요청에 우리 허브 피드를 주지 않는다.
    expect(rss).toContain("getPublicPublisherByDomain");
  });
});

describe("고객사 블로그 — 발행이 공개 페이지에 실제로 반영된다", () => {
  it("🔴 대시보드 발행은 웹 배포의 캐시를 HTTP 로 무효화한다", () => {
    // `revalidatePath` 는 **자기 배포**만 비운다. 앱과 웹은 다른 Vercel 프로젝트다.
    expect(
      manageAction,
      "앱에서 웹 캐시를 비우는 호출이 사라졌다 — 고객이 글을 고쳐도 최대 1시간 옛 내용이 나간다"
    ).toContain("/api/revalidate");
    expect(manageAction).toContain("CRON_SECRET");
  });

  it("🔴 예약 발행 cron 은 같은 배포이므로 직접 무효화한다", () => {
    expect(
      publishCron,
      "cron 발행 후 무효화가 없으면 발행 직후 목록에 글이 안 보인다(ISR 1시간)"
    ).toContain("revalidatePath");
  });

  it("🔴 두 발행 경로 모두 IndexNow 로 색인을 통지한다", () => {
    // 사이트맵은 "명령이 아니라 신호"다(존 뮬러). 신생 도메인은 크롤러가 자주 오지 않아
    // 통지가 없으면 새 글이 며칠 방치된다. 구글은 IndexNow 미지원 → 네이버 축의 수단이다.
    expect(indexNow).toContain("api.indexnow.org/indexnow");
    // 공식 body 스키마(indexnow.org/documentation): host·key·keyLocation·urlList
    for (const field of ["host", "key", "keyLocation", "urlList"]) {
      expect(indexNow, `IndexNow body 에 ${field} 가 없다`).toContain(field);
    }
    expect(revalidateRoute, "대시보드 즉시 발행 경로에 통지가 없다").toContain(
      "submitToIndexNow"
    );
    expect(publishCron, "예약 발행 경로에 통지가 없다").toContain(
      "submitToIndexNow"
    );
  });

  it("🔴 IndexNow 키 상수와 공개 키 파일이 일치한다", () => {
    // 🔴 둘이 갈리면 검색엔진이 소유 확인에 실패해 **전량 거부**된다(403/422).
    //   키는 프로토콜상 공개 값이라 비밀이 아니지만, **파일과 코드가 짝**이어야 한다.
    const key = INDEXNOW_KEY_RE.exec(indexNow)?.[1];
    expect(key, "indexnow.ts 에서 키 상수를 찾지 못했다").toBeDefined();
    expect(
      existsSync(join(ROOT, `apps/web/public/${key}.txt`)),
      `apps/web/public/${key}.txt 가 없다 — 키 파일과 코드가 어긋나면 제출이 전량 거부된다`
    ).toBe(true);
  });
});
