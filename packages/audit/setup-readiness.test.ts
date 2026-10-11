import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { MEASUREMENT_ENTRY_POINTS } from "./measurement-entry-points";
import {
  type BrandSetupInput,
  competitorSettingOf,
  getBrandSetupReadiness,
  isUsableBrandName,
  mayStartMeasurement,
  toSetupReadinessRecord,
} from "./setup-readiness";

const full: BrandSetupInput = {
  aliases: ["FRANZ", "프란츠스킨케어"],
  competitors: { count: 2, kind: "set" },
  domain: "franzskincare.com",
  industry: "beauty",
  marketScope: "korea",
  name: "프란츠",
  savedPrompts: [{ text: "트러블 피부에 좋은 스킨케어 브랜드 추천해줘" }],
};

describe("getBrandSetupReadiness", () => {
  it("모두 갖추면 ready", () => {
    expect(getBrandSetupReadiness(full)).toEqual({
      level: "ready",
      missingRecommended: [],
      missingRequired: [],
    });
  });

  it("프란츠 사건 재현: 경쟁사·질문·별칭이 비면 needs_setup(필수는 통과)", () => {
    const r = getBrandSetupReadiness({
      ...full,
      aliases: [],
      competitors: { kind: "unset" },
      savedPrompts: [],
    });
    expect(r.level).toBe("needs_setup");
    expect(r.missingRequired).toEqual([]);
    expect(r.missingRecommended.sort()).toEqual(
      ["alias", "competitors", "discovery_prompt"].sort()
    );
  });

  it("이름 질문만 저장돼 있으면 이름 없는 질문은 여전히 없음", () => {
    const r = getBrandSetupReadiness({
      ...full,
      savedPrompts: [{ text: "프란츠는 어떤 브랜드야?" }],
    });
    expect(r.missingRecommended).toContain("discovery_prompt");
  });

  it("경쟁사 '없음' 명시는 충족, 0곳 set 은 미충족", () => {
    expect(
      getBrandSetupReadiness({ ...full, competitors: { kind: "none" } })
        .missingRecommended
    ).not.toContain("competitors");
    expect(
      getBrandSetupReadiness({
        ...full,
        competitors: { count: 0, kind: "set" },
      }).missingRecommended
    ).toContain("competitors");
  });

  it("필수(이름·업종·시장)가 비면 blocked", () => {
    const r = getBrandSetupReadiness({
      ...full,
      industry: null,
      marketScope: undefined,
      name: "a",
    });
    expect(r.level).toBe("blocked");
    expect(r.missingRequired.sort()).toEqual(
      ["industry", "market_scope", "name"].sort()
    );
  });

  it("이름이 도메인과 같으면 사용할 수 없는 이름", () => {
    expect(isUsableBrandName("franzskincare.com", "franzskincare.com")).toBe(
      false
    );
    expect(
      isUsableBrandName("www.franzskincare.com", "franzskincare.com")
    ).toBe(false);
    expect(isUsableBrandName("프란츠", "franzskincare.com")).toBe(true);
  });

  it("질문 기준은 바꿔 끼울 수 있다(질문 체계 확정 전)", () => {
    const never = () => false;
    expect(getBrandSetupReadiness(full, never).missingRecommended).toContain(
      "discovery_prompt"
    );
    const always = () => true;
    expect(
      getBrandSetupReadiness({ ...full, savedPrompts: [] }, always)
        .missingRecommended
    ).not.toContain("discovery_prompt");
  });

  it("이름 확인 mismatch 는 권장 항목으로 잡힌다", () => {
    expect(
      getBrandSetupReadiness({ ...full, brandNameCheck: "mismatch" })
        .missingRecommended
    ).toContain("brand_name_mismatch");
  });
});

describe("competitorSettingOf — 미설정/없음/n곳", () => {
  it("빈 목록·이상한 값은 미설정", () => {
    expect(competitorSettingOf([])).toEqual({ kind: "unset" });
    expect(competitorSettingOf(null)).toEqual({ kind: "unset" });
    expect(competitorSettingOf("x")).toEqual({ kind: "unset" });
  });
  it('표식 {"none": true} 만 있으면 없음', () => {
    expect(competitorSettingOf([{ none: true }])).toEqual({ kind: "none" });
  });
  it("이름 있는 경쟁사는 세고, 표식은 경쟁사로 세지 않는다", () => {
    expect(competitorSettingOf([{ name: "A" }, "B", { none: true }])).toEqual({
      count: 2,
      kind: "set",
    });
  });
});

describe("건너뛰기 선택과 기록", () => {
  const needs = getBrandSetupReadiness({
    ...full,
    competitors: { kind: "unset" },
  });

  it("needs_setup 은 명시 선택 없이는 시작할 수 없고, blocked 는 선택해도 안 된다", () => {
    expect(mayStartMeasurement(needs, false)).toBe(false);
    expect(mayStartMeasurement(needs, true)).toBe(true);
    const blocked = getBrandSetupReadiness({ ...full, industry: null });
    expect(mayStartMeasurement(blocked, true)).toBe(false);
    expect(mayStartMeasurement(getBrandSetupReadiness(full), false)).toBe(true);
  });

  it("skippedSetup 은 미달 상태에서 명시 선택했을 때만 true 로 남는다", () => {
    expect(toSetupReadinessRecord(needs, true).skippedSetup).toBe(true);
    expect(toSetupReadinessRecord(needs, false).skippedSetup).toBe(false);
    expect(
      toSetupReadinessRecord(getBrandSetupReadiness(full), true).skippedSetup
    ).toBe(false);
  });
});

// ── 진입 경로 자동 검사 ────────────────────────────────────────────────
const ROOT = join(import.meta.dirname, "..", "..");
const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  ".turbo",
  "generated",
  "dist",
  "__tests__",
  "__fixtures__",
  ".claude",
]);
const SITE_PATTERNS = {
  runAuditJob: /(?<!function )(?<![.\w])runAuditJob\(/,
  "auditJob.create": /\bauditJob\.create\(/,
  "brand.create": /\bbrand\.create\(/,
} as const;

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) {
      continue;
    }
    const full = join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      sourceFiles(full, out);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

function findSites() {
  const found = new Map<string, Set<string>>();
  for (const base of ["apps", "packages"]) {
    for (const file of sourceFiles(join(ROOT, base))) {
      const text = readFileSync(file, "utf8");
      for (const [site, re] of Object.entries(SITE_PATTERNS)) {
        if (re.test(text)) {
          const rel = relative(ROOT, file);
          found.set(rel, (found.get(rel) ?? new Set()).add(site));
        }
      }
    }
  }
  return found;
}

describe("측정 진입 경로 목록 (새 경로가 규칙을 우회하면 실패)", () => {
  const found = findSites();
  const registered = new Map(
    MEASUREMENT_ENTRY_POINTS.map((e) => [e.file, e] as const)
  );

  // 러너 정의 파일과 목록 자체는 호출 지점이 아니다.
  const IGNORED = new Set([
    "packages/audit/runner.ts",
    "packages/audit/measurement-entry-points.ts",
  ]);
  const READINESS_CALLS = [
    "getBrandSetupReadiness",
    "loadBrandSetupReadiness",
    "loadSetupReadinessRecord",
  ];

  it("소스에서 찾은 모든 호출 파일이 목록에 있다", () => {
    const unregistered = [...found.keys()].filter(
      (file) => !(registered.has(file) || IGNORED.has(file))
    );
    expect(unregistered).toEqual([]);
  });

  it("목록의 모든 파일이 실제로 그 호출을 갖고 있다(낡은 항목 금지)", () => {
    for (const entry of MEASUREMENT_ENTRY_POINTS) {
      const sites = found.get(entry.file) ?? new Set<string>();
      for (const site of entry.sites) {
        expect(sites.has(site), `${entry.file} 에 ${site} 없음`).toBe(true);
      }
    }
  });

  it("각 경로는 준비도 규칙을 통과/게이트되거나 사유가 적힌 예외·미완 상태다", () => {
    for (const entry of MEASUREMENT_ENTRY_POINTS) {
      const text = readFileSync(join(ROOT, entry.file), "utf8");
      const p = entry.policy;
      if (p.policy === "gated") {
        expect(
          READINESS_CALLS.some((name) => text.includes(name)),
          `${entry.file} 가 준비도 함수를 부르지 않는다`
        ).toBe(true);
      } else if (p.policy === "delegates") {
        // 위임 사슬을 따라가 결국 gated 에 닿아야 한다 — exempt·todo·순환으로 새면 우회다.
        let hop: string | undefined = p.via;
        const seen = new Set<string>([entry.file]);
        let end = "";
        while (hop && !seen.has(hop)) {
          seen.add(hop);
          const next = registered.get(hop);
          expect(next, `${entry.file} → ${hop} 가 목록에 없음`).toBeDefined();
          end = next?.policy.policy ?? "";
          hop =
            next?.policy.policy === "delegates" ? next.policy.via : undefined;
        }
        expect(end, `${entry.file} 의 위임 사슬`).toBe("gated");
      } else {
        expect(p.reason.length).toBeGreaterThan(10);
      }
    }
  });

  it("게이트 예정(todo)으로 남은 경로가 없다 — 새 경로는 여기서 걸린다", () => {
    const todo = MEASUREMENT_ENTRY_POINTS.filter(
      (e) => e.policy.policy === "todo"
    ).map((e) => `${e.code}:${e.file}`);
    expect(todo).toEqual([]);
  });

  it("러너는 준비도 기록을 결과에 싣는다(모든 경로의 공통 지점)", () => {
    const runner = readFileSync(join(ROOT, "packages/audit/runner.ts"), "utf8");
    expect(runner).toContain("loadSetupReadinessRecord");
    expect(runner).toMatch(
      /setupReadiness:\s*checkpoint\.context\.setupReadiness/
    );
  });

  it("cron 은 권장이 아니라 필수 미달일 때만 건너뛴다", () => {
    const cron = readFileSync(
      join(ROOT, "apps/app/app/api/cron/auto-refresh-tracking/route.ts"),
      "utf8"
    );
    expect(cron).toMatch(/level === "blocked"/);
    expect(cron).not.toMatch(/level === "needs_setup"/);
    expect(cron).toContain("auditLanguageForMarketScope");
  });
});
