"use client";

import { Button } from "@repo/design-system/components/ui/button";
import { Textarea } from "@repo/design-system/components/ui/textarea";
import { SITE_NOTE_MAX } from "@/lib/brand/site-note";

/**
 * "한 줄 소개" 입력 칸(2026-10-14 · 대표 승인) — 홈페이지에서 읽은 글자가 거의 없을 때(자바스크립트·이미지 사이트 등)만 보인다.
 * 자동 읽기가 모두 실패했을 때의 마지막 안전망이다. 입력은 질문 재료로만 쓰고 저장하지 않는다.
 * 서버액션은 부모가 주입한다(Storybook 규칙) — 이 컴포넌트는 순수 뷰다.
 */
export interface SiteNoteLabels {
  hint: string;
  placeholder: string;
  submit: string;
  title: string;
}

export const SiteNoteBox = ({
  busy,
  labels,
  onChange,
  onSubmit,
  value,
}: {
  busy: boolean;
  labels: SiteNoteLabels;
  onChange: (value: string) => void;
  onSubmit: () => void;
  value: string;
}) => (
  <div className="flex flex-col gap-2 rounded-md border border-amber-500/40 p-3">
    <span className="font-medium text-amber-600 text-sm dark:text-amber-400">
      {labels.title}
    </span>
    <p className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-xs">
      {labels.hint}
    </p>
    <Textarea
      aria-label={labels.title}
      disabled={busy}
      maxLength={SITE_NOTE_MAX}
      onChange={(e) => onChange(e.target.value)}
      placeholder={labels.placeholder}
      rows={2}
      value={value}
    />
    <div>
      <Button
        disabled={busy || value.trim().length < 5}
        onClick={onSubmit}
        size="sm"
        type="button"
        variant="outline"
      >
        {labels.submit}
      </Button>
    </div>
  </div>
);
