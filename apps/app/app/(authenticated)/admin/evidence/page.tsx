// 관리자 — 고객사 조치 전후(before/after) 근거 자료 (2026-08-12 세션N-24)
//
// 왜 만드나: 대표님이 투자·영업 자리에서 *"우리 처방을 실행한 고객사가 실제로 올랐다"* 를
//   숫자로 보여줘야 한다. 지금은 그 화면이 없어서 매번 DB 를 직접 뒤져야 했다.
//
// 🔴 **이 화면의 규칙: 유리하게 보이려고 하지 않는다.**
//   - 인과로 단정하지 않는다(경고를 숫자 옆에 **항상** 붙인다)
//   - 떨어진 건도 숨기지 않는다
//   - after 가 없으면 0 이 아니라 **"아직 모름"** 으로 쓴다
//   근거: 설화수 16→27 상승분을 그대로 내놨으면 VC 에게 *"측정 방식이 바뀐 것"* 으로
//   정확히 반대로 읽혔을 사고 이력이 있다(투두리스트 "만들지 말 것" 항목).
//
// ⚠️ 계산은 `@repo/audit/before-after` 순수 함수가 한다. 이 파일은 **조회와 표시만**.
//   (같은 계산을 화면에서 다시 하면 두 숫자가 갈린다 — 프로젝트 규칙.)

import {
  type BeforeAfterRow,
  buildBeforeAfterRow,
} from "@repo/audit/before-after";
import { isAdmin } from "@repo/auth/admin";
import { database } from "@repo/database";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Header } from "../../components/header";

export const metadata: Metadata = {
  title: "성과 근거",
  description: "고객사 조치 전후 대조 — 읽기 전용",
};

/** 한 번에 보여줄 조치 건수 상한. 넘치면 잘렸다고 화면에 밝힌다. */
const MAX_ROWS = 100;

const pctText = (v: number | null): string =>
  v === null ? "—" : `${Math.round(v * 100)}%`;

/** 델타 표기 — 부호를 명시한다. 🔴 "↗" 같은 화살표는 방향 오독을 낳아 쓰지 않는다. */
const deltaText = (v: number | null): string => {
  if (v === null) {
    return "아직 모름";
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

  // 조치가 있는 브랜드의 측정 시계열만 가져온다(전체를 긁지 않는다).
  const brandIds = [...new Set(completions.map((c) => c.brandId))];
  const trackings = brandIds.length
    ? await database.tracking.findMany({
        orderBy: { trackedAt: "asc" },
        select: { brandId: true, shareOfVoice: true, trackedAt: true },
        where: { brandId: { in: brandIds } },
      })
    : [];

  // 브랜드별 측정 시계열로 접는다.
  const seriesByBrand = new Map<
    string,
    { measuredAt: Date; sov: number | null }[]
  >();
  for (const t of trackings) {
    const list = seriesByBrand.get(t.brandId) ?? [];
    list.push({ measuredAt: t.trackedAt, sov: t.shareOfVoice });
    seriesByBrand.set(t.brandId, list);
  }

  const rows = completions.map((c) => ({
    brandLabel: c.brand?.name ?? c.brand?.domain ?? "(브랜드 없음)",
    row: buildBeforeAfterRow(c, seriesByBrand.get(c.brandId) ?? []),
  }));

  const withNumbers = rows.filter((r) => r.row.deltaSov !== null);

  return (
    <>
      <Header page="성과 근거" pages={["관리자"]} />
      <div className="flex flex-col gap-8 px-4 py-6 md:px-6">
        <div className="flex flex-col gap-1">
          <h1 className="font-semibold text-2xl text-[color:var(--findable-ink,#f7f8f8)] tracking-tight">
            고객사 조치 전후 대조
          </h1>
          <p className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm">
            처방을 완료 표시한 뒤 재측정에서 점수가 어떻게 변했는지 봅니다. 읽기
            전용이며, 외부에 인용할 때는 각 행의 주의사항을 함께 옮기세요.
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
            비교가 안 되는 건은 대부분 “조치 후 재측정이 아직 없음”입니다.
            시간이 지나면 채워집니다.
          </p>
        </section>

        {rows.length === 0 ? (
          <section className="mx-auto flex max-w-2xl flex-col gap-2 rounded-lg border border-[color:var(--findable-hairline,#23252a)] bg-[color:var(--findable-surface-1,#0f1011)] p-8 text-center">
            <h2 className="font-medium text-[color:var(--findable-ink,#f7f8f8)]">
              아직 조치 완료 기록이 없어요
            </h2>
            <p className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm">
              고객사가 진단 결과에서 처방을 실행하고 “완료로 표시”를 누르면
              여기에 쌓입니다. 그 뒤 재측정이 한 번 더 돌면 전후 비교가
              만들어집니다.
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
          <th className="py-2 pr-3 font-medium">전</th>
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
