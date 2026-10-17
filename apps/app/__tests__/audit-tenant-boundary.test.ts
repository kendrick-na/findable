import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  canExposeAuditResult,
  canUseAnonymousAuditCache,
} from "../../web/app/api/audit/_lib/public-access";

const POST_ROUTE = readFileSync(
  join(import.meta.dirname, "../../web/app/api/audit/route.ts"),
  "utf8"
);
// 익명 캐시 조회는 2026-10-17 에 route.ts → lib/audit-gates.ts 로 옮겼다(MCP 커넥터와 공유).
//   쿼리 본문 검사는 새 위치에서, "라우트가 그 함수를 실제로 쓴다"는 검사는 route.ts 에서 한다.
const AUDIT_GATES = readFileSync(
  join(import.meta.dirname, "../../web/lib/audit-gates.ts"),
  "utf8"
);
const POLL_ROUTE = readFileSync(
  join(import.meta.dirname, "../../web/app/api/audit/[jobId]/route.ts"),
  "utf8"
);
const SSR_PAGE = readFileSync(
  join(import.meta.dirname, "../../web/app/[locale]/audit/[jobId]/page.tsx"),
  "utf8"
);
const OG_ROUTE = readFileSync(
  join(import.meta.dirname, "../../web/app/api/og/audit/[jobId]/route.tsx"),
  "utf8"
);
const PRIVATE_SUBROUTES = [
  "../../web/app/api/audit/[jobId]/crew/route.ts",
  "../../web/app/api/audit/[jobId]/briefing/route.ts",
  "../../web/app/api/audit/[jobId]/chat/route.ts",
  "../../web/app/api/audit/[jobId]/lead/route.ts",
].map((path) => readFileSync(join(import.meta.dirname, path), "utf8"));

describe("audit tenant boundary", () => {
  test("anonymous cache only accepts public free jobs", () => {
    expect(
      canUseAnonymousAuditCache({
        email: "free@example.com",
        organizationId: null,
      })
    ).toBe(true);
    expect(
      canUseAnonymousAuditCache({ email: "org:deleted", organizationId: null })
    ).toBe(false);
    expect(
      canUseAnonymousAuditCache({
        email: "free@example.com",
        organizationId: "org_private",
      })
    ).toBe(false);
  });

  test("organization results require the owning viewer", () => {
    expect(
      canExposeAuditResult(
        { email: "free@example.com", organizationId: null },
        false
      )
    ).toBe(true);
    expect(
      canExposeAuditResult(
        { email: "org:deleted", organizationId: null },
        false
      )
    ).toBe(false);
    expect(
      canExposeAuditResult({ email: "org:deleted", organizationId: null }, true)
    ).toBe(true);
    expect(
      canExposeAuditResult(
        { email: "org:private", organizationId: "org_private" },
        false
      )
    ).toBe(false);
  });

  test("anonymous cache query is tenant-bound", () => {
    expect(AUDIT_GATES).toMatch(/organizationId:\s*null/);
    expect(AUDIT_GATES).toMatch(
      /NOT:\s*\{\s*email:\s*\{\s*startsWith:\s*"org:"/
    );
  });

  test("POST route uses the tenant-bound cache and does not keep its own copy", () => {
    expect(POST_ROUTE).toMatch(/findCachedByDomain/);
    expect(POST_ROUTE).toMatch(/from "\.\.\/\.\.\/\.\.\/lib\/audit-gates"/);
    // 사본이 다시 생기면(한쪽만 고쳐지는 사고) 바로 잡는다.
    expect(POST_ROUTE).not.toMatch(/function findCachedByDomain/);
    expect(POST_ROUTE).not.toMatch(/organizationId:\s*null/);
  });

  test("public poll route applies the private-result gate", () => {
    const gate = POLL_ROUTE.indexOf("canExposeAuditResult(job, isOwner)");
    const reconcile = POLL_ROUTE.indexOf("await reconcileStaleAuditJob(job)");
    const historyQuery = POLL_ROUTE.indexOf("await loadHistory(job)");
    expect(gate).toBeGreaterThan(-1);
    expect(reconcile).toBeGreaterThan(gate);
    expect(historyQuery).toBeGreaterThan(gate);
    expect(POLL_ROUTE).toMatch(/status:\s*403/);
  });

  test("SSR summary and private subroutes use the same visibility gate", () => {
    expect(SSR_PAGE).toMatch(/canExposeAuditResult/);
    for (const route of PRIVATE_SUBROUTES) {
      expect(route).toMatch(/canExposeAuditResult/);
      expect(route).toMatch(/status:\s*403/);
    }
  });

  test("OG rendering delegates visibility to the gated audit API", () => {
    expect(OG_ROUTE).toMatch(/fetch\(apiUrl,\s*\{\s*cache:\s*"no-store"/);
    expect(OG_ROUTE).not.toMatch(/database\.auditJob\./);
  });
});
