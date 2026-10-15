import { compareFactSheetWithSite } from "@/app/actions/brand/compare-fact-sheet";
import { saveBrandFactSheet } from "@/app/actions/brand/save-fact-sheet";
import { loadFactSheet } from "@/lib/brand/fact-sheet-store";
import { requireOrg } from "@/lib/db/scoped";
import { getAppDictionary } from "@/lib/i18n";
import { isTodayViewEnabled } from "../../lib/today-view";
import { FactSheetCard } from "./fact-sheet-card";

/** 「내 브랜드 정보」서버 껍데기 — 사전·저장값을 읽어 순수 뷰에 내린다(서버액션 주입, N-44 패턴). */
const toStrings = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string" && v.length > 0)
    : [];

export const FactSheetCardServer = async ({
  aliases,
  brandId,
  domain,
  legalName,
  name,
}: {
  aliases: unknown;
  brandId: string;
  domain: string;
  legalName: string | null;
  name: string;
}) => {
  // 파일럿 조직(팀 + env TODAY_VIEW_ORG_IDS)에만 보인다 — 검증 전이라 고객 전체에는 열지 않는다.
  const orgId = await requireOrg();
  if (
    !isTodayViewEnabled({
      orgId,
      pilotOrgIdsRaw: process.env.TODAY_VIEW_ORG_IDS,
    })
  ) {
    return null;
  }
  const [dict, loaded] = await Promise.all([
    getAppDictionary(),
    loadFactSheet(brandId).catch(() => ({ available: false as const })),
  ]);
  const t = dict.factSheet;
  if (!loaded.available) {
    return (
      <section className="rounded-xl border border-[color:var(--findable-hairline,#23252a)] p-4">
        <h3 className="font-medium text-[color:var(--findable-ink,#f7f8f8)]">
          {t.title}
        </h3>
        <p className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm">
          {t.notReady}
        </p>
      </section>
    );
  }
  return (
    <FactSheetCard
      brand={{ aliases: toStrings(aliases), legalName, name, url: domain }}
      brandId={brandId}
      initial={loaded.sheet}
      onCompare={compareFactSheetWithSite}
      onSave={saveBrandFactSheet}
      t={t}
    />
  );
};
