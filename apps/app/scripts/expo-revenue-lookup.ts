/**
 * 엑스포 참가업체 매출 조회 — 체크포인트·이어하기·출처/조회일 기록.
 *
 * 원칙(장부 §3, CLAUDE.md §2-1):
 *  - 값은 DART 공시(사업보고서 → 감사보고서)에서만 온다. 못 찾으면 「확인 필요」, 추정하지 않는다.
 *  - 모든 결과에 출처(DART)·사업연도·접수번호·조회일을 남긴다.
 *  - 한 건마다 체크포인트 파일에 저장 → 중단되어도 다음 실행이 건너뛰고 이어한다.
 *  - 외부 호출 사이에 최소 간격을 둔다(속도 제한 준수). 예산(시간)을 다 쓰면 멈춘다.
 *  - 연락처·이메일은 이 스크립트에서 다루지 않는다(매출만).
 */
import { readFile, rename, writeFile } from "node:fs/promises";
import type { DartResult } from "@/lib/ax-mail/sources/opendart";

export interface ExpoCompany {
  booth: string;
  name: string;
}

export type RevenueStatus = "found" | "not_found" | "ambiguous" | "error";

export interface RevenueRecord {
  amount?: number;
  basis?: "business_report" | "audit_report";
  booth: string;
  fiscalYear?: string;
  fsDiv?: string | null;
  name: string;
  queriedAt: string;
  receiptNo?: string | null;
  source: "DART";
  status: RevenueStatus;
}

export interface Checkpoint {
  done: Record<string, RevenueRecord>;
  version: 1;
}

/** 외부 조회 한 번. 실제 구현은 fetchDart({ name }) — 테스트에서는 가짜. */
export type RevenueLookup = (name: string) => Promise<DartResult | null>;

export interface RunOptions {
  checkpointPath?: string;
  /** 예산이 남았는지 — 아니면 멈추고 stoppedBy="budget" */
  hasBudget?: () => boolean;
  /** 외부 호출 사이 최소 간격(ms). 테스트에서는 가짜 sleep 을 넘긴다. */
  minIntervalMs?: number;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
}

export interface RunResult {
  calls: number;
  checkpoint: Checkpoint;
  skipped: number;
  stoppedBy: "complete" | "budget";
}

function recordFor(
  company: ExpoCompany,
  res: DartResult | null,
  now: Date
): RevenueRecord {
  const base = {
    booth: company.booth,
    name: company.name,
    queriedAt: now.toISOString(),
    source: "DART" as const,
  };
  if (!res) {
    return { ...base, status: "error" };
  }
  if (res.ambiguous) {
    return { ...base, status: "ambiguous" };
  }
  const rev = res.revenue;
  if (!rev) {
    return { ...base, status: "not_found" };
  }
  return {
    ...base,
    amount: rev.amount,
    basis: rev.basis ?? "business_report",
    fiscalYear: rev.fiscalYear,
    fsDiv: rev.fsDiv,
    receiptNo: rev.receiptNo,
    status: "found",
  };
}

export async function loadCheckpoint(path: string): Promise<Checkpoint> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as Checkpoint;
    if (parsed.version === 1 && parsed.done) {
      return parsed;
    }
  } catch {
    // 파일이 없으면 새로 시작
  }
  return { done: {}, version: 1 };
}

/** 임시 파일에 쓰고 이름을 바꾼다 — 쓰는 도중 끊겨도 이전 체크포인트가 남는다. */
export async function saveCheckpoint(
  path: string,
  cp: Checkpoint
): Promise<void> {
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(cp, null, 2), "utf8");
  await rename(tmp, path);
}

export async function runRevenueLookup(
  companies: readonly ExpoCompany[],
  lookup: RevenueLookup,
  checkpoint: Checkpoint,
  opts: RunOptions = {}
): Promise<RunResult> {
  const now = opts.now ?? (() => new Date());
  const sleep =
    opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const minInterval = opts.minIntervalMs ?? 1000;
  let calls = 0;
  let skipped = 0;
  let lastCallAt = 0;
  for (const company of companies) {
    if (checkpoint.done[company.name]) {
      skipped++;
      continue;
    }
    if (opts.hasBudget && !opts.hasBudget()) {
      return { calls, checkpoint, skipped, stoppedBy: "budget" };
    }
    const wait = lastCallAt + minInterval - now().getTime();
    if (calls > 0 && wait > 0) {
      await sleep(wait);
    }
    let res: DartResult | null = null;
    try {
      res = await lookup(company.name);
    } catch {
      res = null;
    }
    lastCallAt = now().getTime();
    calls++;
    checkpoint.done[company.name] = recordFor(
      company,
      res,
      new Date(lastCallAt)
    );
    if (opts.checkpointPath) {
      await saveCheckpoint(opts.checkpointPath, checkpoint);
    }
  }
  return { calls, checkpoint, skipped, stoppedBy: "complete" };
}

/** 표: 찾은 값만 금액, 나머지는 「확인 필요」. 추정 금액은 만들지 않는다. */
export function revenueTable(
  companies: readonly ExpoCompany[],
  cp: Checkpoint
): string {
  const lines = [
    "| 부스 | 업체 | 연매출 | 사업연도 | 출처 | 접수번호 | 조회일 | 상태 |",
    "|---|---|---|---|---|---|---|---|",
  ];
  for (const c of companies) {
    const r = cp.done[c.name];
    if (!r || r.status !== "found") {
      lines.push(
        `| ${c.booth} | ${c.name} | 확인 필요 | - | - | - | ${r?.queriedAt.slice(0, 10) ?? "-"} | ${r ? statusKo(r.status) : "미조회"} |`
      );
      continue;
    }
    const basis =
      r.basis === "audit_report" ? "DART 감사보고서" : "DART 사업보고서";
    lines.push(
      `| ${c.booth} | ${c.name} | ${r.amount?.toLocaleString("ko-KR")}원 | ${r.fiscalYear} | ${basis} | ${r.receiptNo ?? "-"} | ${r.queriedAt.slice(0, 10)} | 찾음 |`
    );
  }
  return lines.join("\n");
}

function statusKo(s: RevenueStatus): string {
  return {
    ambiguous: "동명 후보 여럿(보류)",
    error: "조회 오류",
    found: "찾음",
    not_found: "공시 없음",
  }[s];
}
