"use client";

import { useState } from "react";
import type {
  CompanyCandidate,
  RevenueLinkResult,
} from "@/lib/client-report/revenue-link";
import { applyRevenueBlock } from "@/lib/client-report/revenue-link-apply";

const box =
  "rounded-md border border-[color:var(--findable-hairline,#23252a)] p-3 text-sm";
const subtle = "text-[color:var(--findable-ink-subtle,#8a8f98)]";

const CHOOSE_REASON = {
  many_numbers: "이 회차에서 사업자번호가 둘 이상 읽혔습니다.",
  no_number: "이 회차에서 사업자번호를 읽지 못했습니다(푸터에 없음).",
  number_not_in_cards: "읽은 사업자번호의 회사가 회사 카드에 없습니다.",
} as const;

const BASIS_LABEL = {
  audit_report: "감사보고서 · 공시 기준",
  business_report: "사업보고서 · 공시 기준",
  input: "직접 입력",
} as const;

const won = (n: number) =>
  `${(n / 100_000_000).toLocaleString("ko-KR", { maximumFractionDigits: 1 })}억 원`;

function Candidate({
  company,
  onPick,
  pending,
}: {
  company: CompanyCandidate;
  onPick: () => void;
  pending: boolean;
}) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2">
      <span>
        <span className="font-medium">{company.legalName}</span>{" "}
        <span className={`text-xs ${subtle}`}>
          {company.businessNumber ?? "사업자번호 없음"} ·{" "}
          {company.domain ?? "—"} ·{" "}
          {company.matchedBy === "business_number"
            ? "번호 일치"
            : "도메인 일치"}
        </span>
      </span>
      <button
        className="min-h-8 rounded-md border border-[color:var(--findable-hairline,#23252a)] px-3 text-xs disabled:opacity-50"
        disabled={pending}
        onClick={onPick}
        type="button"
      >
        이 회사로 불러오기
      </button>
    </li>
  );
}

type Ready = Extract<RevenueLinkResult, { state: "ready" }>;

function ReadyView({
  applied,
  confirmed,
  onApply,
  onConfirm,
  result,
}: {
  applied: boolean;
  confirmed: boolean;
  onApply: () => void;
  onConfirm: (on: boolean) => void;
  result: Ready;
}) {
  const needsConfirm =
    result.existing && (result.diff ?? []).some((row) => !row.same);
  return (
    <div className={`${box} space-y-2`}>
      <p>
        <span className="font-medium">{result.company.legalName}</span>{" "}
        <span className={`text-xs ${subtle}`}>
          연결 근거:{" "}
          {result.company.matchedBy === "business_number"
            ? `사업자번호 ${result.company.businessNumber ?? ""} 일치`
            : "도메인 일치(사람이 고름)"}
        </span>
      </p>
      <p>
        연매출 약 {won(result.revenue.amount)} · {result.revenue.fiscalYear}
        {result.revenue.fsDiv === "CFS" && " 연결"}
        {result.revenue.fsDiv === "OFS" && " 별도"} ·{" "}
        {BASIS_LABEL[result.revenue.basis]}
        {result.revenue.receiptNo
          ? ` · 접수번호 ${result.revenue.receiptNo}`
          : ""}
      </p>
      <p>
        AI 경유 매출(연) 약 {won(result.block.ai_routed_annual)}
        {result.block.missed_annual !== undefined &&
          ` · 놓치는 매출(연) 약 ${won(result.block.missed_annual)} (놓치는 비율 ${result.block.miss_num}/${result.block.miss_den})`}
      </p>
      {result.accuracyNote === "no_review" && (
        <p className={`text-xs ${subtle}`}>
          판별 JSON을 넣고 다시 누르면 놓치는 비율까지 계산합니다. 지금은
          연매출·AI 경유 매출까지만 보여 줍니다.
        </p>
      )}
      {result.accuracyNote === "review_rejected" && (
        <p className="text-amber-300 text-xs">
          판별 파일이 점검을 통과하지 못해 놓치는 비율은 계산하지
          않았습니다(사람이 검수·승인한 판별 기준으로만 계산합니다).
        </p>
      )}
      {result.diff && (
        <table className="w-full text-left text-xs">
          <thead className={subtle}>
            <tr>
              <th className="py-1">항목</th>
              <th className="py-1">지금 JSON에 있는 값</th>
              <th className="py-1">불러온 값</th>
            </tr>
          </thead>
          <tbody>
            {result.diff.map((row) => (
              <tr className={row.same ? "" : "text-amber-300"} key={row.field}>
                <td className="py-1 pr-2">{row.field}</td>
                <td className="break-all py-1 pr-2">{row.existing}</td>
                <td className="break-all py-1">{row.generated}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {needsConfirm && (
        <label className="flex items-center gap-2 text-xs">
          <input
            checked={confirmed}
            onChange={(e) => onConfirm(e.target.checked)}
            type="checkbox"
          />
          기존에 사람이 적은 값을 위 불러온 값으로 덮어씁니다
        </label>
      )}
      <button
        className="min-h-9 rounded-md bg-emerald-400 px-4 font-semibold text-slate-950 text-sm disabled:opacity-50"
        disabled={needsConfirm ? !confirmed : false}
        onClick={onApply}
        type="button"
      >
        JSON에 넣기
      </button>
      {applied && (
        <p className="text-emerald-300 text-xs">
          ③ 칸의 copy.revenue_opportunity 에 넣었습니다. ④ 점검으로 다시
          확인하세요(발행은 아직 아닙니다).
        </p>
      )}
    </div>
  );
}

/**
 * 「회사 카드 매출 불러오기」 — 미리보기만 보여 주고, 사람이 「JSON에 넣기」를 눌러야 판별 JSON 칸에 반영된다.
 * 기존에 사람이 적은 값이 있으면 비교표를 보여 주고 덮어쓰기 확인을 받는다.
 */
export function RevenueLinkPanel({
  auditJobId,
  disabled,
  onApply,
  reviewText,
}: {
  auditJobId: string;
  disabled: boolean;
  onApply: (nextReviewText: string) => void;
  reviewText: string;
}) {
  const [result, setResult] = useState<RevenueLinkResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [applied, setApplied] = useState(false);

  async function load(companyId?: string) {
    setPending(true);
    setError(null);
    setApplied(false);
    setConfirmed(false);
    let review: unknown;
    try {
      review = reviewText.trim() ? JSON.parse(reviewText) : undefined;
    } catch {
      review = undefined;
    }
    try {
      const res = await fetch("/api/admin/client-reports/revenue", {
        body: JSON.stringify({ auditJobId, companyId, review }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      if (!res.ok) {
        setError(`불러오지 못했습니다(HTTP ${res.status}).`);
        return;
      }
      setResult((await res.json()) as RevenueLinkResult);
    } catch {
      setError("요청이 실패했습니다.");
    } finally {
      setPending(false);
    }
  }

  function apply() {
    if (result?.state !== "ready") {
      return;
    }
    const next = applyRevenueBlock(reviewText, result.block);
    if (next === null) {
      setError(
        "판별 JSON 형식이 올바르지 않아 넣을 수 없습니다. 먼저 ③ 칸을 채워 주세요."
      );
      return;
    }
    onApply(next);
    setApplied(true);
    setError(null);
  }

  return (
    <div className="space-y-2">
      <button
        className="min-h-9 rounded-md border border-[color:var(--findable-hairline,#23252a)] px-4 text-sm disabled:opacity-50"
        disabled={disabled || pending}
        onClick={() => load()}
        type="button"
      >
        {pending ? "찾는 중…" : "회사 카드 매출 불러오기"}
      </button>
      <span className={`ml-2 text-xs ${subtle}`}>
        사업자번호로 회사 카드를 찾아 revenue_opportunity 초안을 만듭니다(저장
        안 함).
      </span>
      {error && (
        <p className="text-amber-300 text-sm" role="alert">
          {error}
        </p>
      )}
      {result?.state === "invalid_job" && (
        <p className={`${box} text-amber-300`}>측정 회차를 읽을 수 없습니다.</p>
      )}
      {result?.state === "no_company" && (
        <p className={`${box} text-amber-300`}>
          회사 카드에서 이 회사를 찾지 못했습니다(도메인 {result.domain || "—"}
          {result.numbers.length > 0
            ? `, 사업자번호 ${result.numbers.join(", ")}`
            : ", 사업자번호 없음"}
          ). 영업 회사 카드에서 회사를 먼저 올리고 매출을 찾거나 입력해 주세요.
        </p>
      )}
      {result?.state === "choose" && (
        <div className={box}>
          <p className="mb-2 text-amber-300">
            {CHOOSE_REASON[result.reason]} 자동으로 정하지 않으니 직접 골라
            주세요.
          </p>
          <ul className="space-y-2">
            {result.candidates.map((c) => (
              <Candidate
                company={c}
                key={c.id}
                onPick={() => load(c.id)}
                pending={pending}
              />
            ))}
          </ul>
        </div>
      )}
      {result?.state === "identity_unconfirmed" && (
        <p className={`${box} text-amber-300`}>
          {result.company.legalName} 동일성 확정 전 — 매출 입력 불가. 영업 회사
          카드에서 [홈페이지 대조]로 사업자번호가 맞는지 먼저 확인해 주세요(직접
          입력은 출처 필수).
        </p>
      )}
      {result?.state === "no_revenue" && (
        <p className={`${box} text-amber-300`}>
          {result.company.legalName} 카드에 매출이 없습니다. 영업 회사 카드에서
          [공시에서 찾기] 또는 [직접 입력]을 먼저 해 주세요(숫자를 만들지
          않습니다).
        </p>
      )}
      {result?.state === "ready" && (
        <ReadyView
          applied={applied}
          confirmed={confirmed}
          onApply={apply}
          onConfirm={setConfirmed}
          result={result}
        />
      )}
    </div>
  );
}
