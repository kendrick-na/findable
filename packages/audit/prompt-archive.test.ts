import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ query: vi.fn(), exec: vi.fn() }));
vi.mock("@repo/database", () => ({
  database: { $queryRaw: h.query, $executeRaw: h.exec },
}));

import {
  activePromptFilter,
  archivedPromptIds,
  archivePrompt,
  restorePrompt,
} from "./prompt-archive";

const noColumn = new Error('column "archivedAt" does not exist');

beforeEach(() => {
  h.query.mockReset();
  h.exec.mockReset();
});

describe("archivedPromptIds", () => {
  it("보관된 질문 id 를 돌려준다", async () => {
    h.query.mockResolvedValue([{ id: "p1" }, { id: "p2" }]);
    expect(await archivedPromptIds(["b1"])).toEqual(["p1", "p2"]);
  });

  it("브랜드가 없으면 DB 를 부르지 않는다", async () => {
    expect(await archivedPromptIds([])).toEqual([]);
    expect(h.query).not.toHaveBeenCalled();
  });

  it("컬럼이 아직 없으면(SQL 미적용) 「보관 없음」으로 읽는다 — 측정이 안 깨진다", async () => {
    h.query.mockRejectedValue(noColumn);
    expect(await archivedPromptIds(["b1"])).toEqual([]);
  });

  it("그 밖의 DB 오류는 삼키지 않는다(보관된 질문을 조용히 측정하지 않게)", async () => {
    h.query.mockRejectedValue(new Error("connection reset"));
    await expect(archivedPromptIds(["b1"])).rejects.toThrow("connection reset");
  });
});

describe("activePromptFilter", () => {
  it("보관된 id 를 where 에서 뺀다", () => {
    expect(activePromptFilter(["p1"])).toEqual({ id: { notIn: ["p1"] } });
  });
  it("없으면 필터를 붙이지 않는다", () => {
    expect(activePromptFilter([])).toEqual({});
  });
});

describe("archivePrompt / restorePrompt", () => {
  it("보관·복원은 한 문장 UPDATE", async () => {
    h.exec.mockResolvedValue(1);
    expect(await archivePrompt("p1")).toEqual({ ok: true });
    expect(await restorePrompt("p1")).toEqual({ ok: true });
    expect(h.exec).toHaveBeenCalledTimes(2);
  });

  it("컬럼이 없으면 no_column 으로 정직하게 알린다", async () => {
    h.exec.mockRejectedValue(noColumn);
    expect(await archivePrompt("p1")).toEqual({
      ok: false,
      reason: "no_column",
    });
  });
});
