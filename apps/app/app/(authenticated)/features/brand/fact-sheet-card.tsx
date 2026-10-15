"use client";

import { Checkbox } from "@repo/design-system/components/ui/checkbox";
import { Input } from "@repo/design-system/components/ui/input";
import { toast } from "@repo/design-system/components/ui/sonner";
import { Textarea } from "@repo/design-system/components/ui/textarea";
import { useMemo, useState } from "react";
import {
  type BrandIdentity,
  buildLlmsText,
  buildOrganizationJsonLd,
  EVIDENCE_TYPES,
  type EvidenceType,
  type FactKey,
  type FactSheetData,
  normalizeFactSheet,
  usableFacts,
} from "@/lib/brand/fact-sheet";

/**
 * 「내 브랜드 정보」(G1) 입력 카드 — 순수 뷰. 서버액션은 주입받는다(Storybook 보호, N-44 패턴).
 * 확인함 + 증빙을 고른 칸만 미리보기에 들어간다. 미리보기는 복사용일 뿐 사이트에 자동 반영되지 않는다.
 */
export interface FactSheetCardProps {
  brand: BrandIdentity;
  brandId: string;
  initial: FactSheetData;
  onSave: (
    brandId: string,
    input: FactSheetData
  ) => Promise<{ ok: true } | { error: string }>;
  t: Record<string, string>;
}

const FieldHead = ({
  checkboxId,
  confirmed,
  evidence,
  fieldKey,
  needsEvidence,
  onConfirm,
  onEvidence,
  t,
}: {
  checkboxId: string;
  confirmed: boolean;
  evidence: EvidenceType | undefined;
  fieldKey: FactKey;
  needsEvidence: boolean;
  onConfirm: (v: boolean) => void;
  onEvidence: (v: EvidenceType | undefined) => void;
  t: Record<string, string>;
}) => (
  <div className="flex flex-wrap items-center gap-3 text-sm">
    {needsEvidence && (
      <select
        aria-label={`${t.evidencePlaceholder} (${fieldKey})`}
        className="rounded-md border border-[color:var(--findable-hairline,#23252a)] bg-transparent px-2 py-1 text-[color:var(--findable-ink,#f7f8f8)]"
        onChange={(e) =>
          onEvidence((e.target.value || undefined) as EvidenceType | undefined)
        }
        value={evidence ?? ""}
      >
        <option value="">{t.evidencePlaceholder}</option>
        {EVIDENCE_TYPES.map((type) => (
          <option key={type} value={type}>
            {t[`evidence${type[0].toUpperCase()}${type.slice(1)}`]}
          </option>
        ))}
      </select>
    )}
    <label
      className="inline-flex items-center gap-2 text-[color:var(--findable-ink,#f7f8f8)]"
      htmlFor={checkboxId}
    >
      <Checkbox
        checked={confirmed}
        id={checkboxId}
        onCheckedChange={(v) => onConfirm(v === true)}
      />
      {t.confirm}
    </label>
  </div>
);

const CopyBox = ({
  label,
  text,
  t,
}: {
  label: string;
  text: string;
  t: Record<string, string>;
}) => (
  <div className="flex flex-col gap-2">
    <div className="flex items-center justify-between gap-2">
      <span className="font-medium text-[color:var(--findable-ink,#f7f8f8)] text-sm">
        {label}
      </span>
      <button
        className="rounded-md border border-[color:var(--findable-hairline,#23252a)] px-3 py-1 text-[color:var(--findable-ink,#f7f8f8)] text-sm"
        onClick={() => {
          navigator.clipboard
            ?.writeText(text)
            .then(() => toast.success(t.copied))
            .catch(() => undefined);
        }}
        type="button"
      >
        {t.copy}
      </button>
    </div>
    <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md border border-[color:var(--findable-hairline,#23252a)] p-3 text-[color:var(--findable-ink-subtle,#8a8f98)] text-xs">
      {text}
    </pre>
  </div>
);

export const FactSheetCard = ({
  brand,
  brandId,
  initial,
  onSave,
  t,
}: FactSheetCardProps) => {
  const [sheet, setSheet] = useState<FactSheetData>(initial);
  const [profilesText, setProfilesText] = useState(initial.profiles.join("\n"));
  const [saving, setSaving] = useState(false);

  const normalized = useMemo(
    () =>
      normalizeFactSheet({
        ...sheet,
        profiles: profilesText.split("\n"),
      }),
    [sheet, profilesText]
  );
  const ok = usableFacts(normalized);
  const jsonLd = JSON.stringify(
    buildOrganizationJsonLd(brand, normalized),
    null,
    2
  );
  const llms = buildLlmsText(brand, normalized);

  const setField = <K extends keyof FactSheetData>(
    key: K,
    value: FactSheetData[K]
  ) => setSheet((prev) => ({ ...prev, [key]: value }));
  const setConfirmed = (key: FactKey, v: boolean) =>
    setSheet((prev) => ({
      ...prev,
      confirmed: { ...prev.confirmed, [key]: v },
    }));
  const setEvidence = (key: FactKey, v: EvidenceType | undefined) =>
    setSheet((prev) => {
      const evidence = { ...prev.evidence };
      if (v) {
        evidence[key] = v;
      } else {
        delete evidence[key];
      }
      return { ...prev, evidence };
    });

  const save = async () => {
    setSaving(true);
    const result = await onSave(brandId, normalized).catch(() => ({
      error: t.saveFailed,
    }));
    setSaving(false);
    if ("error" in result) {
      toast.error(result.error);
      return;
    }
    toast.success(t.saved);
  };

  const row = (
    key: Exclude<FactKey, "profiles" | "foundedYear">,
    label: string,
    hint: string
  ) => (
    <div className="flex flex-col gap-2">
      <label
        className="flex flex-col gap-1 text-sm"
        htmlFor={`fact-${key}-${brandId}`}
      >
        <span className="text-[color:var(--findable-ink,#f7f8f8)]">
          {label}
        </span>
        <span className="text-[color:var(--findable-ink-subtle,#8a8f98)]">
          {hint}
        </span>
      </label>
      {key === "scope" ? (
        <Textarea
          id={`fact-${key}-${brandId}`}
          onChange={(e) => setField(key, e.target.value)}
          rows={3}
          value={sheet[key]}
        />
      ) : (
        <Input
          id={`fact-${key}-${brandId}`}
          onChange={(e) => setField(key, e.target.value)}
          value={sheet[key]}
        />
      )}
      <FieldHead
        checkboxId={`fact-ok-${key}-${brandId}`}
        confirmed={sheet.confirmed[key] === true}
        evidence={sheet.evidence[key]}
        fieldKey={key}
        needsEvidence
        onConfirm={(v) => setConfirmed(key, v)}
        onEvidence={(v) => setEvidence(key, v)}
        t={t}
      />
    </div>
  );

  return (
    <details className="rounded-xl border border-[color:var(--findable-hairline,#23252a)] p-4">
      <summary className="cursor-pointer font-medium text-[color:var(--findable-ink,#f7f8f8)]">
        {t.title}
      </summary>
      <div className="mt-4 flex flex-col gap-4">
        <p className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm">
          {t.lede}
        </p>

        {row("oneLiner", t.oneLiner, t.oneLinerHint)}
        {row("operator", t.operator, t.operatorHint)}
        {row("scope", t.scope, t.scopeHint)}

        <details className="flex flex-col gap-4">
          <summary className="cursor-pointer text-[color:var(--findable-ink,#f7f8f8)] text-sm">
            {t.more}
          </summary>
          <div className="mt-3 flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <label
                className="flex flex-col gap-1 text-sm"
                htmlFor={`fact-profiles-${brandId}`}
              >
                <span className="text-[color:var(--findable-ink,#f7f8f8)]">
                  {t.profiles}
                </span>
                <span className="text-[color:var(--findable-ink-subtle,#8a8f98)]">
                  {t.profilesHint}
                </span>
              </label>
              <Textarea
                id={`fact-profiles-${brandId}`}
                onChange={(e) => setProfilesText(e.target.value)}
                rows={3}
                value={profilesText}
              />
              <FieldHead
                checkboxId={`fact-ok-profiles-${brandId}`}
                confirmed={sheet.confirmed.profiles === true}
                evidence={undefined}
                fieldKey="profiles"
                needsEvidence={false}
                onConfirm={(v) => setConfirmed("profiles", v)}
                onEvidence={() => undefined}
                t={t}
              />
            </div>
            <div className="flex flex-col gap-2">
              <label
                className="text-[color:var(--findable-ink,#f7f8f8)] text-sm"
                htmlFor={`fact-founded-${brandId}`}
              >
                {t.foundedYear}
              </label>
              <Input
                id={`fact-founded-${brandId}`}
                inputMode="numeric"
                onChange={(e) =>
                  setField(
                    "foundedYear",
                    e.target.value === "" ? null : Number(e.target.value)
                  )
                }
                value={sheet.foundedYear ?? ""}
              />
              <FieldHead
                checkboxId={`fact-ok-foundedYear-${brandId}`}
                confirmed={sheet.confirmed.foundedYear === true}
                evidence={sheet.evidence.foundedYear}
                fieldKey="foundedYear"
                needsEvidence
                onConfirm={(v) => setConfirmed("foundedYear", v)}
                onEvidence={(v) => setEvidence("foundedYear", v)}
                t={t}
              />
            </div>
            {row("disambiguation", t.disambiguation, t.disambiguationHint)}
          </div>
        </details>

        <div>
          <button
            className="rounded-md bg-[color:var(--findable-primary,#ff7a4d)] px-4 py-2 font-medium text-black text-sm disabled:opacity-60"
            disabled={saving}
            onClick={save}
            type="button"
          >
            {saving ? t.saving : t.save}
          </button>
        </div>

        <div className="flex flex-col gap-3 border-[color:var(--findable-hairline,#23252a)] border-t pt-4">
          <span className="font-medium text-[color:var(--findable-ink,#f7f8f8)] text-sm">
            {t.previewTitle}
          </span>
          <p className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm">
            {t.previewNote}
          </p>
          {ok.size === 0 ? (
            <p className="text-[color:var(--findable-ink-tertiary,#7e8289)] text-sm">
              {t.previewEmpty}
            </p>
          ) : null}
          <CopyBox label={t.jsonLdTitle} t={t} text={jsonLd} />
          <CopyBox label={t.llmsTitle} t={t} text={llms} />
        </div>
      </div>
    </details>
  );
};
