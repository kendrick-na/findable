import type { EngineResponse } from "@repo/ai/lib/engines";
import { describe, expect, it } from "vitest";
import {
  type AuditCheckpointCell,
  makeAuditCheckpoint,
  readAuditCheckpoint,
} from "./checkpoint";
import {
  cellsFromBatch,
  checkpointCells,
  closePendingCells,
  LATE_CELL_REASK_MIN_START_BUDGET_MS,
  lateCellMarker,
  lateRevisionReason,
  reaskableCells,
  runLateCellReasks,
} from "./late-cells";

const AT = "2026-10-07T03:00:00.000Z";

const row = (
  engineId: string,
  errorMessage: string | null = null
): EngineResponse =>
  ({
    engineId,
    rawResponse: errorMessage ? "" : "answer",
    brandMentioned: !errorMessage,
    citedSources: [],
    durationMs: 1,
    isStub: false,
    errorMessage,
    mentionListSize: null,
    mentionPosition: null,
    sentiment: null,
    shareOfVoice: null,
  }) as EngineResponse;

const pendingCell = (
  promptIndex: number,
  engineId: string
): AuditCheckpointCell => ({
  promptIndex,
  engineId,
  state: "timed_out_pending",
  firstSettledAt: AT,
  updatedAt: AT,
});

describe("cell states", () => {
  it("classifies a 60s cap as pending, other errors as failed, answers as done", () => {
    const cells = cellsFromBatch(
      0,
      [
        row("chatgpt"),
        row("gemini", "Engine gemini timed out after 60000ms"),
        row("perplexity", "429 Too Many Requests"),
      ],
      AT
    );
    expect(cells.map((cell) => [cell.engineId, cell.state])).toEqual([
      ["chatgpt", "done"],
      ["gemini", "timed_out_pending"],
      ["perplexity", "failed"],
    ]);
    expect(cells[2]?.failureReason).toBe("engine_error");
    expect(reaskableCells(cells).map((cell) => cell.engineId)).toEqual([
      "gemini",
    ]);
  });

  it("rebuilds cells for a checkpoint saved before cells existed", () => {
    const cells = checkpointCells({
      originCreatedAt: AT,
      responses: [[row("claude", "Engine claude timed out after 60000ms")]],
    });
    expect(cells).toEqual([
      {
        promptIndex: 0,
        engineId: "claude",
        state: "timed_out_pending",
        firstSettledAt: AT,
        updatedAt: AT,
      },
    ]);
  });

  it("closes pending cells; a cell whose re-ask started is interrupted, never re-asked", () => {
    const started = {
      ...pendingCell(1, "claude"),
      reaskStartedAt: AT,
    };
    const { cells, closed } = closePendingCells(
      [pendingCell(0, "gemini"), started],
      "window_expired",
      AT
    );
    expect(closed.map((cell) => cell.failureReason)).toEqual([
      "window_expired",
      "reask_interrupted",
    ]);
    expect(cells.every((cell) => cell.state === "failed")).toBe(true);
    expect(cells.map(lateCellMarker)).toEqual(["final_failed", "final_failed"]);
    expect(reaskableCells([started])).toEqual([]);
  });

  it("names engines in the revision reason", () => {
    expect(lateRevisionReason(["gemini"])).toBe("Gemini 늦은 답 반영");
    expect(lateRevisionReason(["chatgpt", "claude", "chatgpt"])).toBe(
      "ChatGPT·Claude 늦은 답 반영"
    );
  });
});

describe("late re-ask round", () => {
  it("persists 'started' before the paid call and re-asks each pending cell once", async () => {
    const events: string[] = [];
    const now = 1_000_000;
    const run = await runLateCellReasks({
      cells: [
        { ...pendingCell(0, "chatgpt"), state: "done" },
        pendingCell(0, "gemini"),
      ],
      responses: [
        [
          row("chatgpt"),
          row("gemini", "Engine gemini timed out after 60000ms"),
        ],
      ],
      stopStartingAtMs: now + LATE_CELL_REASK_MIN_START_BUDGET_MS,
      now: () => now,
      ask: (promptIndex, engineId) => {
        events.push(`ask:${promptIndex}:${engineId}`);
        return Promise.resolve(row(engineId));
      },
      save: (state) => {
        const gemini = state.cells.find((cell) => cell.engineId === "gemini");
        events.push(`save:${gemini?.state}:${Boolean(gemini?.reaskStartedAt)}`);
        return Promise.resolve();
      },
    });
    expect(events).toEqual([
      "save:timed_out_pending:true",
      "ask:0:gemini",
      "save:done:true",
    ]);
    expect(run.reasked).toHaveLength(1);
    expect(run.responses[0]?.[1]?.errorMessage).toBeNull();
    expect(lateCellMarker(run.cells[1])).toBe("resolved");
  });

  it("does not start a re-ask without enough budget (cell stays pending, closed later)", async () => {
    const now = 1_000_000;
    let asked = 0;
    const run = await runLateCellReasks({
      cells: [pendingCell(0, "gemini")],
      responses: [[row("gemini", "Engine gemini timed out after 60000ms")]],
      stopStartingAtMs: now + LATE_CELL_REASK_MIN_START_BUDGET_MS - 1,
      now: () => now,
      ask: () => {
        asked += 1;
        return Promise.resolve(row("gemini"));
      },
      save: () => Promise.resolve(),
    });
    expect(asked).toBe(0);
    expect(run.cells[0]?.state).toBe("timed_out_pending");
    expect(closePendingCells(run.cells, "not_reasked", AT).closed).toEqual([
      expect.objectContaining({ failureReason: "not_reasked" }),
    ]);
  });

  it("sends at most two concurrent re-asks to the same engine", async () => {
    let inFlight = 0;
    let peak = 0;
    const now = 1_000_000;
    const timeout = "Engine claude timed out after 60000ms";
    await runLateCellReasks({
      cells: [0, 1, 2].map((index) => pendingCell(index, "claude")),
      responses: [0, 1, 2].map(() => [row("claude", timeout)]),
      stopStartingAtMs: now + LATE_CELL_REASK_MIN_START_BUDGET_MS,
      now: () => now,
      ask: async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;
        return row("claude");
      },
      save: () => Promise.resolve(),
    });
    expect(peak).toBe(2);
  });
});

describe("checkpoint validation of cells", () => {
  const scope = {
    brandId: "brand-1",
    domain: "example.com",
    language: "en" as const,
    organizationId: "org-1",
  };
  const base = () => ({
    ...makeAuditCheckpoint(
      scope,
      {
        brandName: "Example",
        brandVariants: [],
        identityGrounded: true,
        officialSiteIdentity: {
          finalUrl: "https://example.com",
          title: "Example",
          description: null,
          h1: null,
          siteName: null,
        },
      },
      [{ text: "first", lang: "en" }],
      AT
    ),
    responses: [
      ["chatgpt", "claude", "perplexity", "gemini"].map((engineId) =>
        row(engineId)
      ),
    ],
  });

  it("accepts cells and a single late re-ask round", () => {
    const checkpoint = {
      ...base(),
      cells: [pendingCell(0, "gemini")],
      lateReask: { count: 1, requestedAt: AT },
    };
    expect(readAuditCheckpoint(checkpoint, scope)?.cells).toHaveLength(1);
  });

  it("rejects a second late round, a cell outside saved questions, or a duplicate cell", () => {
    expect(() =>
      readAuditCheckpoint(
        { ...base(), lateReask: { count: 2, requestedAt: AT } },
        scope
      )
    ).toThrow("invalid audit checkpoint");
    expect(() =>
      readAuditCheckpoint(
        { ...base(), cells: [pendingCell(1, "gemini")] },
        scope
      )
    ).toThrow("invalid audit checkpoint");
    expect(() =>
      readAuditCheckpoint(
        {
          ...base(),
          cells: [pendingCell(0, "gemini"), pendingCell(0, "gemini")],
        },
        scope
      )
    ).toThrow("invalid audit checkpoint");
    expect(() =>
      readAuditCheckpoint(
        { ...base(), cells: [{ ...pendingCell(0, "gemini"), state: "late" }] },
        scope
      )
    ).toThrow("invalid audit checkpoint");
  });
});
