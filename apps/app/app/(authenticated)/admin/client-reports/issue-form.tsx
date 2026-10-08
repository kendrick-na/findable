"use client";

import { useState } from "react";

type Result =
  | { kind: "idle" }
  | { kind: "error"; message: string; reasons?: unknown }
  | { kind: "preview"; n: number; okN: number; engines: string[] }
  | { kind: "issued"; url: string; n: number; okN: number };

const field =
  "w-full rounded-md border border-[color:var(--findable-hairline,#23252a)] bg-black/20 px-3 py-2 text-sm outline-none focus:border-emerald-400";

const UUID_RE = /^[0-9a-f-]{36}$/i;

export function IssueForm({
  initialAuditJobId = "",
}: {
  initialAuditJobId?: string;
}) {
  const [auditJobId, setAuditJobId] = useState(initialAuditJobId);
  const [slug, setSlug] = useState("");
  const [version, setVersion] = useState(1);
  const [expiresInDays, setExpiresInDays] = useState(30);
  const [reviewText, setReviewText] = useState("");
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<Result>({ kind: "idle" });

  async function submit(mode: "preview" | "issue") {
    let review: unknown;
    try {
      review = JSON.parse(reviewText);
    } catch {
      setResult({
        kind: "error",
        message: "판별 JSON 형식이 올바르지 않습니다.",
      });
      return;
    }
    setPending(true);
    try {
      const res = await fetch("/api/admin/client-reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          auditJobId,
          slug,
          version,
          expiresInDays,
          mode,
          review,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        denominator?: { engines: string[]; n: number };
        error?: string;
        reasons?: unknown;
        summary?: { n: number; ok_n: number };
        url?: string;
      };
      if (!res.ok) {
        setResult({
          kind: "error",
          message: body.error ?? `HTTP ${res.status}`,
          reasons: body.reasons,
        });
      } else if (mode === "issue" && body.url && body.summary) {
        setResult({
          kind: "issued",
          url: body.url,
          n: body.summary.n,
          okN: body.summary.ok_n,
        });
      } else if (body.summary && body.denominator) {
        setResult({
          kind: "preview",
          n: body.summary.n,
          okN: body.summary.ok_n,
          engines: body.denominator.engines,
        });
      }
    } catch {
      setResult({ kind: "error", message: "요청이 실패했습니다." });
    } finally {
      setPending(false);
    }
  }

  const validId = UUID_RE.test(auditJobId);
  return (
    <section className="space-y-4 rounded-xl border border-[color:var(--findable-hairline,#23252a)] bg-[color:var(--findable-surface-1,#0f1011)] p-5">
      <div className="grid gap-3 sm:grid-cols-4">
        <label className="space-y-1 text-sm sm:col-span-2">
          <span>① 측정 회차 ID (AuditJob.id)</span>
          <input
            className={field}
            onChange={(e) => setAuditJobId(e.target.value.trim())}
            value={auditJobId}
          />
        </label>
        <label className="space-y-1 text-sm">
          <span>슬러그 (영문 소문자)</span>
          <input
            className={field}
            onChange={(e) => setSlug(e.target.value.trim())}
            value={slug}
          />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="space-y-1 text-sm">
            <span>판</span>
            <input
              className={field}
              min={1}
              onChange={(e) => setVersion(Number(e.target.value))}
              type="number"
              value={version}
            />
          </label>
          <label className="space-y-1 text-sm">
            <span>만료(일)</span>
            <input
              className={field}
              max={90}
              min={1}
              onChange={(e) => setExpiresInDays(Number(e.target.value))}
              type="number"
              value={expiresInDays}
            />
          </label>
        </div>
      </div>
      <p className="text-sm">
        ② 원본 받기:{" "}
        {validId ? (
          <a
            className="underline underline-offset-2"
            href={`/api/admin/report-source/${auditJobId}`}
          >
            report-source JSON 내려받기
          </a>
        ) : (
          <span className="text-[color:var(--findable-ink-subtle,#8a8f98)]">
            회차 ID 를 넣으면 링크가 생깁니다
          </span>
        )}{" "}
        <span className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-xs">
          (원문 포함 · 내부 전용)
        </span>
      </p>
      <label className="block space-y-1 text-sm">
        <span>
          ③ 판별 파일 (findable.report-review@1 JSON) — status 가 approved 이고
          검토자·검토일이 있어야 발행됩니다
        </span>
        <textarea
          className={`${field} min-h-48 font-mono text-xs`}
          onChange={(e) => setReviewText(e.target.value)}
          value={reviewText}
        />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button
          className="min-h-9 rounded-md border border-[color:var(--findable-hairline,#23252a)] px-4 text-sm disabled:opacity-50"
          disabled={pending || !validId || !slug}
          onClick={() => submit("preview")}
          type="button"
        >
          ④ 점검 (저장 안 함)
        </button>
        <button
          className="min-h-9 rounded-md bg-emerald-400 px-4 font-semibold text-slate-950 text-sm disabled:opacity-50"
          disabled={pending || !validId || !slug}
          onClick={() => submit("issue")}
          type="button"
        >
          ⑤ 승인본 발행
        </button>
      </div>
      {result.kind === "error" && (
        <div
          className="rounded-md border border-amber-800/60 bg-amber-950/30 p-3 text-amber-200 text-sm"
          role="alert"
        >
          {result.message}
          {result.reasons !== undefined && (
            <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap text-xs">
              {JSON.stringify(result.reasons, null, 2)}
            </pre>
          )}
        </div>
      )}
      {result.kind === "preview" && (
        <p className="text-emerald-300 text-sm">
          점검 통과 — 분모 {result.n}건({result.engines.join("·")}) 중 정확{" "}
          {result.okN}건. 아직 저장하지 않았습니다.
        </p>
      )}
      {result.kind === "issued" && (
        <p className="text-emerald-300 text-sm">
          발행 완료 — 정확 {result.okN}/{result.n}.{" "}
          <a
            className="underline underline-offset-2"
            href={result.url}
            rel="noopener noreferrer"
            target="_blank"
          >
            {result.url}
          </a>{" "}
          — 아직 「내부 시안」입니다. 목록에서 링크·PDF 를 직접 열어 본 뒤 ②
          고객 발송 최종 승인을 누르세요
        </p>
      )}
    </section>
  );
}

/**
 * ② 대표 고객 발송 최종 승인 — ① 판별 검토(reviewer)와 다른 단계.
 * 링크·PDF 를 직접 열어 본 뒤, 승인자 이름을 적고 체크해야 누를 수 있다.
 */
export function SendApproveButton({
  reportId,
  url,
}: {
  reportId: string;
  url: string;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("나현덕");
  const [viewed, setViewed] = useState(false);
  const [state, setState] = useState<"idle" | "pending" | "done" | "failed">(
    "idle"
  );
  if (state === "done") {
    return <span className="text-emerald-300">발송 승인됨</span>;
  }
  if (!open) {
    return (
      <button
        className="text-emerald-300 underline underline-offset-2"
        onClick={() => setOpen(true)}
        type="button"
      >
        ② 고객 발송 최종 승인
      </button>
    );
  }
  return (
    <span className="mt-2 block space-y-1.5 rounded-md border border-[color:var(--findable-hairline,#23252a)] p-2 text-left">
      <label className="flex items-center gap-2">
        <input
          checked={viewed}
          onChange={(e) => setViewed(e.target.checked)}
          type="checkbox"
        />
        <span>
          <a
            className="underline"
            href={url}
            rel="noopener noreferrer"
            target="_blank"
          >
            링크
          </a>
          와{" "}
          <a
            className="underline"
            href={`${url}/pdf`}
            rel="noopener noreferrer"
            target="_blank"
          >
            PDF
          </a>
          를 직접 열어 확인했습니다
        </span>
      </label>
      <label className="flex items-center gap-2">
        <span>승인자</span>
        <input
          className="w-24 rounded border border-[color:var(--findable-hairline,#23252a)] bg-black/20 px-1"
          onChange={(e) => setName(e.target.value)}
          value={name}
        />
      </label>
      <button
        className="rounded bg-emerald-400 px-2 py-1 font-semibold text-slate-950 disabled:opacity-50"
        disabled={!(viewed && name.trim()) || state === "pending"}
        onClick={async () => {
          setState("pending");
          const res = await fetch(`/api/admin/client-reports/${reportId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "approve-send",
              approverName: name.trim(),
              viewedLink: true,
            }),
          });
          setState(res.ok ? "done" : "failed");
        }}
        type="button"
      >
        {state === "failed" ? "승인 실패 — 다시" : "발송 승인"}
      </button>
    </span>
  );
}

export function RevokeButton({ reportId }: { reportId: string }) {
  const [state, setState] = useState<"idle" | "done" | "failed">("idle");
  if (state === "done") {
    return (
      <span className="text-[color:var(--findable-ink-subtle,#8a8f98)]">
        폐기됨
      </span>
    );
  }
  return (
    <button
      className="text-amber-300 underline underline-offset-2"
      onClick={async () => {
        // 되돌릴 수 없는 링크 폐기 — 브라우저 기본 확인창으로 한 번 더 묻는다.
        // biome-ignore lint/suspicious/noAlert: 파괴적 동작 전 확인(관리자 전용 화면)
        const sure = window.confirm(
          "이 링크를 폐기할까요? 받은 사람도 더 이상 열 수 없습니다."
        );
        if (!sure) {
          return;
        }
        const res = await fetch(`/api/admin/client-reports/${reportId}`, {
          method: "DELETE",
        });
        setState(res.ok ? "done" : "failed");
      }}
      type="button"
    >
      {state === "failed" ? "폐기 실패" : "폐기"}
    </button>
  );
}
