// 관리자 — 조치 완료 기록. 비교 가능한 실행 원장이 없으면 변화 수치는 차단한다.
//
// 과거에는 답변별 Tracking을 회차 성과처럼 비교해 거짓 ±%p를 만들 수 있었다.
// 완료 당시 보였던 값은 남기되, 측정 출처와 코호트를 확인할 때까지 전후 차이는 숨긴다.

import type { BeforeAfterRow } from "@repo/audit/before-after";
import { buildUnattributedEvidenceRow } from "@repo/audit/evidence-series";
import { isAdmin } from "@repo/auth/admin";
import { database } from "@repo/database";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Header } from "../../components/header";

export const metadata: Metadata = {
  title: "조치 완료 기록",
  description: "완료 기록과 당시 화면 값 — 전후 효과 미판정",
};

/** 한 번에 보여줄 조치 건수 상한. 넘치면 잘렸다고 화면에 밝힌다. */
const MAX_ROWS = 100;

const pctText = (v: number | null): string =>
  v === null ? "—" : `${Math.round(v * 100)}%`;

/** 델타 표기 — 부호를 명시한다. 🔴 "↗" 같은 화살표는 방향 오독을 낳아 쓰지 않는다. */
const deltaText = (v: number | null): string => {
  if (v === null) {
    return "비교 불가";
  }
  const pp = Math.round(v * 100);
  return `${pp > 0 ? "+" : ""}${pp}%p`;
};

const AdminEvidencePage = async () => {
  if (!(await isAdmin())) {
    notFound();
  }

  const completions = await database.actionCompletion.findMany({
    orderBy: { completedAt: "desc" },
    select: {
      brand: { select: { domain: true, id: true, name: true } },
      brandId: true,
      completedAt: true,
      kind: true,
      recognitionAtCompletion: true,
      sovAtCompletion: true,
      target: true,
    },
    take: MAX_ROWS,
  });

  const totalCompletions = await database.actionCompletion.count();

  const rows = completions.map((c) => ({
    brandLabel: c.brand?.name ?? c.brand?.domain ?? "(브랜드 없음)",
    row: buildUnattributedEvidenceRow(c),
  }));

  const withNumbers = rows.filter((r) => r.row.deltaSov !== null);

  return (
    <>
      <Header page="조치 완료 기록" pages={["관리자"]} />
      <div className="flex flex-col gap-8 px-4 py-6 md:px-6">
        <div className="flex flex-col gap-1">
          <h1 className="font-semibold text-2xl text-[color:var(--findable-ink,#f7f8f8)] tracking-tight">
            고객사 조치 완료 기록
          </h1>
          <p className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm">
            완료 표시할 때 화면에 보였던 언급률만 표시합니다. 측정 시각·출처는
            확인되지 않았습니다. 과거 측정에는 실행·질문·엔진·판정 버전의 연결
            정보가 없어 이후 측정과 안전하게 짝지을 수 없습니다. 전후 변화나
            처방 효과를 투자·영업 근거로 인용하지 마세요.
          </p>
        </div>

        {/* 🔴 "몇 건 중 몇 건이 숫자를 갖는지"를 먼저 말한다.
            숫자가 있는 것만 보여주면 표본이 실제보다 좋아 보인다. */}
        <section className="flex flex-col gap-2 rounded-lg border border-[color:var(--findable-hairline,#23252a)] bg-[color:var(--findable-surface-1,#0f1011)] p-4">
          <p className="text-[color:var(--findable-ink,#f7f8f8)] text-sm">
            조치 완료 <strong>{totalCompletions}건</strong> 중 전후 비교가
            가능한 것은 <strong>{withNumbers.length}건</strong>입니다.
          </p>
          {totalCompletions > MAX_ROWS ? (
            <p className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-xs">
              최근 {MAX_ROWS}건만 표시하고 있어요.
            </p>
          ) : null}
          <p className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-xs">
            재측정이 있더라도 현재 데이터만으로는 동일한 질문·엔진·판정 기준인지
            확인할 수 없습니다. 비교 수치는 실행 원장과 검증 절차를 갖춘 뒤
            표시합니다.
          </p>
        </section>

        {rows.length === 0 ? (
          <section className="mx-auto flex max-w-2xl flex-col gap-2 rounded-lg border border-[color:var(--findable-hairline,#23252a)] bg-[color:var(--findable-surface-1,#0f1011)] p-8 text-center">
            <h2 className="font-medium text-[color:var(--findable-ink,#f7f8f8)]">
              아직 조치 완료 기록이 없어요
            </h2>
            <p className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm">
              고객사가 진단 결과에서 처방을 실행하고 “완료로 표시”를 누르면
              여기에 쌓입니다. 전후 비교는 동일한 측정 조건과 실행 이력을 검증한
              뒤에만 제공됩니다.
            </p>
          </section>
        ) : (
          <EvidenceTable rows={rows} />
        )}
      </div>
    </>
  );
};

const EvidenceTable = ({
  rows,
}: {
  rows: { brandLabel: string; row: BeforeAfterRow }[];
}) => (
  <div className="overflow-x-auto">
    <table className="w-full min-w-[720px] border-collapse text-sm">
      <thead>
        <tr className="border-[color:var(--findable-hairline,#23252a)] border-b text-left text-[color:var(--findable-ink-subtle,#8a8f98)] text-xs">
          <th className="py-2 pr-3 font-medium">브랜드</th>
          <th className="py-2 pr-3 font-medium">조치</th>
          <th className="py-2 pr-3 font-medium">완료일</th>
          <th className="py-2 pr-3 font-medium">완료 시 화면 값</th>
          <th className="py-2 pr-3 font-medium">후</th>
          <th className="py-2 pr-3 font-medium">변화</th>
          <th className="py-2 font-medium">주의사항</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ brandLabel, row }) => (
          <tr
            className="border-[color:var(--findable-hairline,#23252a)] border-b align-top"
            key={`${brandLabel}-${row.kind}-${row.target}-${row.completedAt.toISOString()}`}
          >
            <td className="py-3 pr-3 text-[color:var(--findable-ink,#f7f8f8)]">
              {brandLabel}
            </td>
            <td className="py-3 pr-3 text-[color:var(--findable-ink-muted,#d0d6e0)]">
              {row.kind}
              {row.target ? (
                <span className="block text-[color:var(--findable-ink-subtle,#8a8f98)] text-xs">
                  {row.target}
                </span>
              ) : null}
            </td>
            <td className="py-3 pr-3 text-[color:var(--findable-ink-muted,#d0d6e0)] tabular-nums">
              {row.completedAt.toLocaleDateString("ko-KR")}
            </td>
            <td className="py-3 pr-3 text-[color:var(--findable-ink-muted,#d0d6e0)] tabular-nums">
              {pctText(row.beforeSov)}
            </td>
            <td className="py-3 pr-3 text-[color:var(--findable-ink-muted,#d0d6e0)] tabular-nums">
              {pctText(row.afterSov)}
            </td>
            <td className="py-3 pr-3 text-[color:var(--findable-ink,#f7f8f8)] tabular-nums">
              {deltaText(row.deltaSov)}
            </td>
            {/* 🔴 주의사항을 접거나 툴팁에 숨기지 않는다 — 숫자와 같은 줄에 둔다. */}
            <td className="py-3 text-[color:var(--findable-ink-subtle,#8a8f98)] text-xs">
              {row.caveats.length ? (
                <ul className="flex flex-col gap-1">
                  {row.caveats.map((c) => (
                    <li key={c}>· {c}</li>
                  ))}
                </ul>
              ) : (
                "—"
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

export default AdminEvidencePage;
