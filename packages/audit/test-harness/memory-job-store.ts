// U5 — 메모리 AuditJob 저장소.
//
// audit-stub-runner.test.ts 가 쓰는 「메모리 AuditJob 행 + prisma 흉내」를 재사용 가능한 모양으로 뽑았다.
// 운영 DB 쓰기 0. 러너(runAuditJob)의 lease 선점·체크포인트 저장·확정 commit 이 이 위에서 돈다.
//
// 사용(예):
//   const store = createMemoryJobStore();
//   vi.mock("@repo/database", () => store.databaseModule());   // 팩토리는 러너를 처음 import 할 때 실행
//   store.seed({ id: "job-1", ... });
//   store.expireLease("job-1");                                // T4: 중단(lease 만료) 시뮬
//
// 지원하는 where 문법은 러너가 쓰는 만큼만이다(동등·null·OR·in·gt/lt(Date)). 그 밖의 연산자는
// 일치하지 않는 것으로 취급한다 — 모르는 쿼리가 조용히 통과하지 않게 한다.

export type Row = Record<string, unknown>;

const DB_NULL = Symbol("DbNull");

interface Op {
  gt?: Date;
  in?: unknown[];
  lt?: Date;
}

export const matchesWhere = (row: Row, where: Row): boolean =>
  Object.entries(where).every(([key, cond]): boolean => {
    if (key === "OR") {
      return (cond as Row[]).some((branch) => matchesWhere(row, branch));
    }
    const value = row[key] ?? null;
    if (cond === null) {
      return value === null;
    }
    if (typeof cond === "object" && !(cond instanceof Date)) {
      const op = cond as Op;
      if (op.in) {
        return op.in.includes(value);
      }
      if (!(value instanceof Date)) {
        return false;
      }
      return (
        (!op.gt || value.getTime() > op.gt.getTime()) &&
        (!op.lt || value.getTime() < op.lt.getTime())
      );
    }
    return value === cond;
  });

const applyData = (row: Row, data: Row): void => {
  for (const [key, value] of Object.entries(data)) {
    row[key] = value === DB_NULL ? null : value;
  }
};

export interface MemoryJobStore {
  /** 러너에 넣을 `@repo/database` 모듈 모양. */
  databaseModule: () => {
    Prisma: { DbNull: symbol };
    database: Record<string, unknown>;
  };
  /** lease 를 이미 만료된 것으로 만든다(= 실행 중이던 호출이 죽은 상황). 만료 시각을 돌려준다. */
  expireLease: (id: string) => Date;
  get: (id: string) => Row;
  /** 상태 변경 이력(시각 + 갱신 내용) — 「실패로 바뀐 적 없다」 같은 단언용. */
  readonly history: ReadonlyArray<{ at: number; id: string; data: Row }>;
  reset: () => void;
  readonly rows: Map<string, Row>;
  seed: (row: Row) => void;
  /** status 가 바뀐 이력만. */
  statusTrail: (id: string) => string[];
}

export function createMemoryJobStore(): MemoryJobStore {
  const rows = new Map<string, Row>();
  const history: Array<{ at: number; id: string; data: Row }> = [];

  const record = (id: string, data: Row) => {
    history.push({ at: Date.now(), id, data: { ...data } });
  };

  const database = {
    auditJob: {
      updateMany: ({ where, data }: { data: Row; where: Row }) => {
        let count = 0;
        for (const row of rows.values()) {
          if (matchesWhere(row, where)) {
            applyData(row, data);
            record(row.id as string, data);
            count += 1;
          }
        }
        return Promise.resolve({ count });
      },
      update: ({ where, data }: { data: Row; where: { id: string } }) => {
        const row = rows.get(where.id);
        if (!row) {
          return Promise.reject(new Error(`AuditJob ${where.id} not found`));
        }
        applyData(row, data);
        record(where.id, data);
        return Promise.resolve(row);
      },
      findUnique: ({ where }: { where: { id: string } }) =>
        Promise.resolve(rows.get(where.id) ?? null),
      findFirst: ({ where }: { where: Row }) =>
        Promise.resolve(
          [...rows.values()].find((row) => matchesWhere(row, where)) ?? null
        ),
    },
    // runner.ts updatePostprocessing: jsonb_set(stage) guarded by the previous status.
    // 파라미터: stage, status, jobId, previousStatus.
    $executeRawUnsafe: (
      _sql: string,
      stage: string,
      status: string,
      jobId: string,
      previous: string
    ) => {
      const row = rows.get(jobId);
      const current = (row?.postprocessing ?? {}) as Record<string, string>;
      if (
        row?.status !== "completed" ||
        (current[stage] ?? previous) !== previous
      ) {
        return Promise.resolve(0);
      }
      row.postprocessing = { ...current, [stage]: status };
      return Promise.resolve(1);
    },
  };

  return {
    rows,
    history,
    databaseModule: () => ({ Prisma: { DbNull: DB_NULL }, database }),
    seed: (row) => {
      rows.set(row.id as string, {
        attemptStartedAt: null,
        brandId: null,
        checkpoint: null,
        leaseToken: null,
        leaseUntil: null,
        status: "queued",
        ...row,
      });
    },
    get: (id) => {
      const row = rows.get(id);
      if (!row) {
        throw new Error(`AuditJob ${id} not found`);
      }
      return row;
    },
    expireLease: (id) => {
      const row = rows.get(id);
      if (!row) {
        throw new Error(`AuditJob ${id} not found`);
      }
      const expired = new Date(Date.now() - 1000);
      row.leaseUntil = expired;
      return expired;
    },
    statusTrail: (id) =>
      history
        .filter((h) => h.id === id && typeof h.data.status === "string")
        .map((h) => h.data.status as string),
    reset: () => {
      rows.clear();
      history.length = 0;
    },
  };
}
