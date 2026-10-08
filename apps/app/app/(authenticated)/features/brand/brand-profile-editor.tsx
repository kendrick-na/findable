"use client";

import { Badge } from "@repo/design-system/components/ui/badge";
import { Input } from "@repo/design-system/components/ui/input";
import { toast } from "@repo/design-system/components/ui/sonner";
import { ChevronDownIcon, XIcon } from "lucide-react";
import { useState } from "react";

/**
 * 별칭·경쟁사 편집 — **온보딩을 건너뛴 사람의 유일한 경로**(N-44 남은일 1-c).
 *
 * 🔴 **왜 필요한가**(실측): `/welcome` 2·4단계는 **건너뛸 수 있고**, 무료 진단 후 가입자는
 *   온보딩 자체를 **통째로 건너뛴다**(`hasAnyMeasurement` 게이트). 그런데 `/brand` 에는
 *   별칭·경쟁사 입력칸이 **0곳**이었다 → 한 번 건너뛰면 **영영 못 넣는다**.
 *   그러면 저장·읽는 코드를 다 만들어놓고도 **ⓐ 기능이 반쪽**이 된다.
 *
 * ⚠️ **새 저장 경로를 만들지 않는다** — 온보딩과 **같은 서버액션**(`updateBrandProfile`)을
 *   주입받는다. 두 벌이 되면 정규화·상한이 갈린다(📕이 저장소의 도메인 정규식 3중 복제 사고).
 *
 * ⚠️ 서버액션을 여기서 import 하지 않는다(주입) — 하면 Storybook 이 통째로 죽는다(N-44).
 *
 * 🔒 접힘 기본값: 이 화면의 주 작업은 **측정**이다. 부가 설정이 카드를 밀어내지 않게
 *   `<details>` 로 접어둔다(📕N-41: 툴팁은 터치에 없다 → `<details>` 로 간 이력과 같은 판단).
 */

export interface BrandProfileEditorProps {
  brandId: string;
  /** 고객이 넣은 사업자등록번호(저장값). */
  businessNumber: string | null;
  /** 현재 저장값. 서버가 읽어 내려준다. */
  competitors: string[];
  entityVariants: string[];
  industry: string | null;
  /** 고객이 넣은 회사 정식 상호(저장값). */
  legalName: string | null;
  marketScope: string | null;
  name: string;
  onSave: (input: {
    brandId: string;
    name: string;
    industry: string;
    marketScope: string;
    competitors: string[];
    entityVariants: string[];
    legalName: string;
    businessNumber: string;
  }) => Promise<{ ok: true } | { error: string }>;
  /** 최근 측정에서 홈페이지 푸터로 찾은 사업자등록번호 — 저장값이 없을 때 제안만 한다. */
  suggestedBusinessNumber: string | null;
  /** 문구 사전 — 서버가 읽어 내려준다(📕`CLAUDE.md §2` 하드코딩 금지). */
  t: Record<string, string>;
}

const ChipRow = ({
  emptyText,
  items,
  onRemove,
  removeLabel,
}: {
  emptyText: string;
  items: string[];
  onRemove: (value: string) => void;
  removeLabel: (item: string) => string;
}) =>
  items.length > 0 ? (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <Badge
          className="gap-1 border-[color:var(--findable-hairline,#23252a)] py-1 pr-1 pl-2 text-[color:var(--findable-ink,#f7f8f8)]"
          key={item}
          variant="outline"
        >
          {item}
          <button
            aria-label={removeLabel(item)}
            className="rounded-sm p-0.5"
            onClick={() => onRemove(item)}
            type="button"
          >
            <XIcon aria-hidden="true" className="size-3" />
          </button>
        </Badge>
      ))}
    </div>
  ) : (
    <p className="text-[color:var(--findable-ink-tertiary,#7e8289)] text-sm">
      {emptyText}
    </p>
  );

export const BrandProfileEditor = ({
  brandId,
  name: initialName,
  industry: initialIndustry,
  marketScope: initialMarketScope,
  competitors: initialCompetitors,
  entityVariants: initialVariants,
  legalName: initialLegalName,
  businessNumber: initialBusinessNumber,
  suggestedBusinessNumber,
  onSave,
  t,
}: BrandProfileEditorProps) => {
  const [variants, setVariants] = useState(initialVariants);
  const [competitors, setCompetitors] = useState(initialCompetitors);
  const [name, setName] = useState(initialName);
  const [industry, setIndustry] = useState(initialIndustry ?? "");
  const [marketScope, setMarketScope] = useState(initialMarketScope ?? "");
  const [legalName, setLegalName] = useState(initialLegalName ?? "");
  const [businessNumber, setBusinessNumber] = useState(
    initialBusinessNumber ?? ""
  );
  const [saved, setSaved] = useState({
    legalName: initialLegalName ?? "",
    businessNumber: initialBusinessNumber ?? "",
    name: initialName,
    industry: initialIndustry ?? "",
    marketScope: initialMarketScope ?? "",
    variants: initialVariants,
    competitors: initialCompetitors,
  });
  const [variantDraft, setVariantDraft] = useState("");
  const [competitorDraft, setCompetitorDraft] = useState("");
  const [saving, setSaving] = useState(false);

  // 저장 전과 달라졌는가 — 안 바뀌었으면 저장 버튼을 눌러도 의미가 없다.
  const dirty =
    name.trim() !== saved.name ||
    industry !== saved.industry ||
    marketScope !== saved.marketScope ||
    legalName.trim() !== saved.legalName ||
    businessNumber.trim() !== saved.businessNumber ||
    JSON.stringify(variants) !== JSON.stringify(saved.variants) ||
    JSON.stringify(competitors) !== JSON.stringify(saved.competitors);

  const add = (
    draft: string,
    setDraft: (v: string) => void,
    setList: (fn: (prev: string[]) => string[]) => void
  ) => {
    const value = draft.trim();
    if (!value) {
      return;
    }
    setList((prev) => (prev.includes(value) ? prev : [...prev, value]));
    setDraft("");
  };

  const save = async () => {
    setSaving(true);
    const result = await onSave({
      brandId,
      name: name.trim(),
      industry,
      marketScope,
      competitors,
      entityVariants: variants,
      legalName: legalName.trim(),
      businessNumber: businessNumber.trim(),
    });
    setSaving(false);
    if ("error" in result) {
      toast.error(result.error);
      return;
    }
    setSaved({
      legalName: legalName.trim(),
      businessNumber: businessNumber.trim(),
      name: name.trim(),
      industry,
      marketScope,
      variants,
      competitors,
    });
    toast.success(t.editorSaved);
  };

  return (
    <details className="group flex flex-col gap-3 border-[color:var(--findable-hairline,#23252a)] border-t pt-3">
      <summary className="flex cursor-pointer items-center justify-between gap-2 text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm">
        <span>
          {t.editorSummary}
          {(variants.length > 0 || competitors.length > 0) && (
            <span className="ml-2 text-[color:var(--findable-ink-tertiary,#7e8289)] text-xs">
              {(t.editorCounts ?? "")
                .replace("{aliases}", String(variants.length))
                .replace("{competitors}", String(competitors.length))}
            </span>
          )}
        </span>
        <ChevronDownIcon
          aria-hidden="true"
          className="size-4 transition-transform group-open:rotate-180 motion-reduce:transition-none"
        />
      </summary>

      {/* 🔴 한국어 줄바꿈 절대규칙(설계 v3 §5-1). */}
      <div className="flex max-w-2xl flex-col gap-5 pt-3 [word-break:keep-all]">
        <label
          className="flex flex-col gap-2 text-sm"
          htmlFor="profile-brand-name"
        >
          <span className="font-medium text-[color:var(--findable-ink,#f7f8f8)]">
            {t.summaryBrand}
          </span>
          <Input
            id="profile-brand-name"
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
            required
            value={name}
          />
        </label>
        <label className="flex flex-col gap-2 text-sm">
          <span className="font-medium text-[color:var(--findable-ink,#f7f8f8)]">
            {t.industryLabel}
          </span>
          <select
            className="rounded-md border border-[color:var(--findable-hairline,#23252a)] bg-transparent p-2 text-[color:var(--findable-ink,#f7f8f8)]"
            onChange={(e) => setIndustry(e.target.value)}
            value={industry}
          >
            <option disabled value="">
              {t.industryPlaceholder}
            </option>
            <option value="manufacturing">{t.industryManufacturing}</option>
            <option value="b2b_saas">{t.industryB2bSaas}</option>
            <option value="beauty">{t.industryBeauty}</option>
            <option value="fashion">{t.industryFashion}</option>
            <option value="food">{t.industryFood}</option>
            <option value="retail">{t.industryRetail}</option>
            <option value="finance">{t.industryFinance}</option>
            <option value="healthcare">{t.industryHealthcare}</option>
            <option value="education">{t.industryEducation}</option>
            <option value="content_ip">{t.industryContentIp}</option>
            <option value="other">{t.industryOther}</option>
          </select>
        </label>
        <label className="flex flex-col gap-2 text-sm">
          <span className="font-medium text-[color:var(--findable-ink,#f7f8f8)]">
            {t.scopeLabel}
          </span>
          <select
            className="rounded-md border border-[color:var(--findable-hairline,#23252a)] bg-transparent p-2 text-[color:var(--findable-ink,#f7f8f8)]"
            onChange={(e) => setMarketScope(e.target.value)}
            value={marketScope}
          >
            <option disabled value="">
              {t.scopeLabel}
            </option>
            <option value="both">{t.scopeBoth}</option>
            <option value="korea">{t.scopeKorea}</option>
            <option value="global">{t.scopeGlobal}</option>
          </select>
        </label>
        <div className="flex flex-col gap-2">
          <span className="font-medium text-[color:var(--findable-ink,#f7f8f8)] text-sm">
            {t.editorAliasTitle}
          </span>
          <p className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm">
            {t.editorAliasHint}
          </p>
          <div className="flex gap-2">
            <Input
              aria-label={t.editorAliasAria}
              onChange={(e) => setVariantDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  add(variantDraft, setVariantDraft, setVariants);
                }
              }}
              placeholder={t.aliasPlaceholder}
              value={variantDraft}
            />
            <button
              className="shrink-0 rounded-md border border-[color:var(--findable-hairline,#23252a)] px-3 font-medium text-[color:var(--findable-ink,#f7f8f8)] text-sm"
              onClick={() => add(variantDraft, setVariantDraft, setVariants)}
              type="button"
            >
              {t.add}
            </button>
          </div>
          <ChipRow
            emptyText={t.editorEmpty as string}
            items={variants}
            onRemove={(v) => setVariants((p) => p.filter((x) => x !== v))}
            removeLabel={(i) => (t.removeItem ?? "").replace("{item}", i)}
          />
        </div>

        {/* 🔴 2026-10-06 운영 실측: 홈페이지가 슬로건뿐인 브랜드(토스)는 판정 근거가 없어
            정답 답변까지 점수에서 빠졌다. 고객이 상호·사업자번호를 알려 주면 근거가 된다.
            공개하지 않는 값이라 안내 문구로 그 사실을 먼저 말한다. */}
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <span className="font-medium text-[color:var(--findable-ink,#f7f8f8)] text-sm">
              {t.editorIdentityTitle}
            </span>
            <p className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm">
              {t.editorIdentityHint}
            </p>
          </div>
          <label
            className="flex flex-col gap-2 text-sm"
            htmlFor={`profile-legal-name-${brandId}`}
          >
            <span className="text-[color:var(--findable-ink,#f7f8f8)]">
              {t.editorLegalNameLabel}
            </span>
            <Input
              id={`profile-legal-name-${brandId}`}
              maxLength={60}
              onChange={(e) => setLegalName(e.target.value)}
              placeholder={t.editorLegalNamePlaceholder}
              value={legalName}
            />
          </label>
          <label
            className="flex flex-col gap-2 text-sm"
            htmlFor={`profile-business-number-${brandId}`}
          >
            <span className="text-[color:var(--findable-ink,#f7f8f8)]">
              {t.editorBusinessNumberLabel}
            </span>
            <Input
              id={`profile-business-number-${brandId}`}
              inputMode="numeric"
              maxLength={12}
              onChange={(e) => setBusinessNumber(e.target.value)}
              placeholder={t.editorBusinessNumberPlaceholder}
              value={businessNumber}
            />
          </label>
          {suggestedBusinessNumber &&
            businessNumber.trim() === "" &&
            saved.businessNumber === "" && (
              <div className="flex flex-wrap items-center gap-2 text-[color:var(--findable-ink-subtle,#8a8f98)] text-xs">
                <span>
                  {(t.editorBusinessNumberSuggested ?? "").replace(
                    "{number}",
                    suggestedBusinessNumber
                  )}
                </span>
                <button
                  className="rounded-md border border-[color:var(--findable-hairline,#23252a)] px-2 py-1 text-[color:var(--findable-ink,#f7f8f8)]"
                  onClick={() => setBusinessNumber(suggestedBusinessNumber)}
                  type="button"
                >
                  {t.editorUseSuggested}
                </button>
              </div>
            )}
        </div>

        <div className="flex flex-col gap-2">
          <span className="font-medium text-[color:var(--findable-ink,#f7f8f8)] text-sm">
            {t.editorCompetitorTitle}
          </span>
          <p className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm">
            {t.editorCompetitorHint}
          </p>
          <div className="flex gap-2">
            <Input
              aria-label={t.editorCompetitorAria}
              onChange={(e) => setCompetitorDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  add(competitorDraft, setCompetitorDraft, setCompetitors);
                }
              }}
              placeholder={t.competitorPlaceholder}
              value={competitorDraft}
            />
            <button
              className="shrink-0 rounded-md border border-[color:var(--findable-hairline,#23252a)] px-3 font-medium text-[color:var(--findable-ink,#f7f8f8)] text-sm"
              onClick={() =>
                add(competitorDraft, setCompetitorDraft, setCompetitors)
              }
              type="button"
            >
              {t.add}
            </button>
          </div>
          <ChipRow
            emptyText={t.editorEmpty as string}
            items={competitors}
            onRemove={(v) => setCompetitors((p) => p.filter((x) => x !== v))}
            removeLabel={(i) => (t.removeItem ?? "").replace("{item}", i)}
          />
        </div>

        <div className="flex items-center gap-3">
          <button
            className="rounded-md bg-[color:var(--findable-primary,#ff7a4d)] px-4 py-2 font-medium text-black text-sm disabled:opacity-50"
            disabled={
              saving ||
              !dirty ||
              name.trim().length < 2 ||
              !industry ||
              !marketScope
            }
            onClick={save}
            type="button"
          >
            {saving ? t.saving : t.editorSave}
          </button>
          {dirty && (
            <span className="text-[color:var(--findable-ink-tertiary,#7e8289)] text-xs">
              {t.editorDirtyHint}
            </span>
          )}
        </div>
      </div>
    </details>
  );
};
