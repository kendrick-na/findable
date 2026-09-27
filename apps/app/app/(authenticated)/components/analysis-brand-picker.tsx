/** Keep the measured brand explicit on analysis screens. A missing URL parameter
 * must never make another brand's figures look like the dashboard selection. */
export const AnalysisBrandPicker = ({
  brands,
  path,
  selectedBrandId,
}: {
  brands: Array<{ id: string; name: string; domain: string }>;
  path: "/actions" | "/compare" | "/sources";
  selectedBrandId: string | null;
}) => (
  <form
    action={path}
    className="findable-card flex flex-wrap items-center gap-3 p-4"
  >
    <label className="font-medium text-sm" htmlFor="analysis-brand">
      분석 브랜드
    </label>
    <select
      className="min-w-44 rounded-md border border-[color:var(--findable-border,#32363c)] bg-[color:var(--findable-surface,#181a1e)] px-3 py-2 text-sm"
      defaultValue={selectedBrandId ?? ""}
      id="analysis-brand"
      name="brand"
      required
    >
      {!selectedBrandId && <option value="">브랜드 선택</option>}
      {brands.map((brand) => (
        <option key={brand.id} value={brand.id}>
          {brand.name} · {brand.domain}
        </option>
      ))}
    </select>
    <button
      className="rounded-md bg-[color:var(--findable-primary,#ff7a4d)] px-4 py-2 font-medium text-black text-sm"
      type="submit"
    >
      결과 보기
    </button>
  </form>
);
