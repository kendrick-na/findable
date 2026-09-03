/**
 * Google 연결 UI는 OAuth 시작·콜백 API와 한 덩어리다.
 * 이 두 route가 빠지면 버튼은 즉시 404가 되어, 화면만 남은 미완성 기능이 된다.
 *
 * @vitest-environment node
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const route = (path: string) =>
  join(process.cwd(), "app/api/integrations/google", path, "route.ts");

describe("Google Search Console·GA4 OAuth route", () => {
  test("🔴 연결 시작은 현재 조직의 브랜드만 서명된 state로 Google에 보낸다", () => {
    const file = route("connect");
    expect(existsSync(file)).toBe(true);
    const source = readFileSync(file, "utf8");
    expect(source).toContain("auth()");
    expect(source).toContain("organizationId: orgId");
    expect(source).toContain("signOAuthState");
    expect(source).toContain("googleAuthorizationUrl");
  });

  test("🔴 콜백은 state의 조직·사용자를 재확인하고 두 Google provider를 저장한다", () => {
    const file = route("callback");
    expect(existsSync(file)).toBe(true);
    const source = readFileSync(file, "utf8");
    expect(source).toContain("verifyOAuthState");
    expect(source).toContain("state.orgId === orgId");
    expect(source).toContain("state.userId === userId");
    expect(source).toContain("exchangeGoogleCode");
    expect(source).toContain("encryptRefreshToken");
    expect(source).toContain("google_search_console");
    expect(source).toContain("google_analytics_4");
  });
});
