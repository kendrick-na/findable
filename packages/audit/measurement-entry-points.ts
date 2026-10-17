/**
 * 「브랜드가 만들어지고 측정이 시작되는 모든 진입 경로」 목록(2026-10-12).
 *
 * `setup-readiness.test.ts` 가 소스를 훑어 `runAuditJob(` · `auditJob.create(` · `brand.create(` 호출 파일을
 * 이 목록과 대조한다. 여기에 없는 새 경로가 생기면 테스트가 실패한다 — 새 길이 준비도 규칙을
 * 몰래 우회하지 못하게 하는 장치다. 새 경로를 만들면 아래에 적고 정책을 고른다.
 *
 * 정책
 *   gated    — 이 파일이 `getBrandSetupReadiness` 를 직접 부른다(테스트가 문자열로 확인).
 *   delegates— 이 파일은 `via` 에 적은 파일의 게이트를 거친다(그 파일이 gated 여야 한다).
 *   exempt   — 준비도 규칙이 맞지 않는 경로. `reason` 필수.
 *   todo     — 아직 게이트를 달지 않았다. `reason` 필수. (현재 0건 — 새 경로가 생기면 여기서 시작)
 *
 *   러너(`runAuditJob`)는 brandId 가 있으면 준비도를 읽어 결과에 기록하는 단일 지점이다. C·F·G 는 러너에
 *   위임한다(기록 전용 — 영업 경로는 측정을 막지 않고, 발행·메일에서만 거부한다. 대표 승인 2026-10-12).
 */
export type EntryPolicy =
  | { policy: "delegates"; via: string }
  | { policy: "exempt"; reason: string }
  | { policy: "gated" }
  | { policy: "todo"; reason: string };

export interface MeasurementEntryPoint {
  /** A~H 경로 코드(감사 문서 기준). */
  code: string;
  /** 저장소 루트 기준 파일 경로. */
  file: string;
  label: string;
  policy: EntryPolicy;
  /** 이 파일에서 찾는 호출들. */
  sites: readonly ("auditJob.create" | "brand.create" | "runAuditJob")[];
}

export const MEASUREMENT_ENTRY_POINTS: readonly MeasurementEntryPoint[] = [
  {
    code: "*",
    file: "packages/audit/runner.ts",
    label:
      "러너(runAuditJob) — 모든 측정이 지나는 단일 지점. 준비도를 읽어 결과에 기록한다",
    sites: [],
    policy: { policy: "gated" },
  },
  {
    code: "A",
    file: "apps/app/app/actions/brand/start-tracking.ts",
    label: "브랜드 화면 '측정 시작' (+ ensureOrgBrand 브랜드 생성)",
    sites: ["runAuditJob", "auditJob.create", "brand.create"],
    policy: { policy: "gated" },
  },
  {
    code: "B",
    file: "apps/app/app/actions/brand/assign.ts",
    label: "'브랜드 추가' — 브랜드 생성 후 startOrgTracking 호출",
    sites: ["brand.create"],
    policy: {
      policy: "delegates",
      via: "apps/app/app/actions/brand/start-tracking.ts",
    },
  },
  {
    code: "C",
    file: "packages/audit/audit-continuation.ts",
    label: "이어가기(측정 화면 폴링·cron) — 이미 시작된 회차의 나머지 질문",
    sites: ["runAuditJob"],
    policy: { policy: "delegates", via: "packages/audit/runner.ts" },
  },
  {
    code: "D",
    file: "apps/app/app/api/cron/auto-refresh-tracking/route.ts",
    label: "정기 측정 cron",
    sites: ["runAuditJob", "auditJob.create"],
    policy: { policy: "gated" },
  },
  {
    code: "E",
    file: "apps/web/app/api/audit/route.ts",
    label: "무료 진단 /audit",
    sites: ["runAuditJob", "auditJob.create"],
    policy: {
      policy: "exempt",
      reason:
        "브랜드·저장 질문·경쟁사가 없는 이메일 진단이고, 현재 랜딩에서 닫혀 있다(대표 확인 2026-10-12)",
    },
  },
  {
    code: "F",
    file: "apps/app/app/actions/admin/measure.ts",
    label: "관리자·영업 '측정' 서버 액션",
    sites: ["runAuditJob"],
    policy: { policy: "delegates", via: "packages/audit/runner.ts" },
  },
  {
    code: "F",
    file: "apps/app/lib/ax-mail/discovery/sales-org.ts",
    label: "영업 조직 브랜드 생성(ensureSalesBrand)",
    sites: ["brand.create"],
    policy: {
      policy: "delegates",
      via: "apps/app/app/actions/admin/measure.ts",
    },
  },
  {
    code: "G",
    file: "apps/web/app/api/admin/measure-one/route.ts",
    label: "관리자 단건 측정 API",
    sites: ["runAuditJob"],
    policy: { policy: "delegates", via: "packages/audit/runner.ts" },
  },
  {
    code: "G",
    file: "packages/audit/measure-one.ts",
    label: "관리자 단건 측정(startMeasureOne / measureOneBrand)",
    sites: ["runAuditJob", "auditJob.create"],
    policy: { policy: "delegates", via: "packages/audit/runner.ts" },
  },
  {
    code: "H",
    file: "apps/app/lib/db/ensure-org.ts",
    label: "온보딩 — 조직·첫 브랜드 생성(추천 단계가 있는 길)",
    sites: ["brand.create"],
    policy: {
      policy: "exempt",
      reason: "브랜드를 만들 뿐 측정은 시작하지 않는다. 측정은 A 를 거친다",
    },
  },
  {
    code: "I",
    file: "apps/app/lib/audit-queue/worker.ts",
    label:
      "입장 관리 일꾼 — 상한 때문에 대기하던 측정을 시작한다(A 가 만든 job, 시작 직전에 준비도를 다시 읽는다)",
    sites: ["runAuditJob"],
    policy: { policy: "gated" },
  },
];
