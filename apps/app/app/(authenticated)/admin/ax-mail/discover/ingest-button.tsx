"use client";

import { Button } from "@repo/design-system/components/ui/button";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ingestDiscoverySources } from "@/app/actions/admin/sales-discovery";
import { ingestReasonCode } from "@/lib/ax-mail/discovery/ingest-reason";
import type {
  ApiSource,
  IngestSourceResult,
} from "@/lib/ax-mail/discovery/ingest-runner";
import type { AppDictionary } from "@/lib/i18n";

type Labels = AppDictionary["salesDiscover"];

/** 원천을 하나씩 부른다(서버 액션 120초 제한 — 한 번에 다 부르면 시간 초과). 순서는 서버 API_SOURCES 와 같다. */
const SOURCES: ApiSource[] = [
  "fsc",
  "nps",
  "mfds",
  "ftc_mail_order",
  "opendart",
];
/** 한 원천을 이어서 부르는 최대 횟수(무한 반복 방지). */
const MAX_RESUMES = 20;

/**
 * 원천 하나를 부른다. 시간 예산에 걸려 partial 이면 nextIndex 부터 같은 원천을 다시 부른다
 * (최대 MAX_RESUMES 번). 결과 줄은 push 로 화면에 쌓는다.
 */
async function ingestOneSource(
  source: ApiSource,
  labels: Labels,
  push: (text: string) => void
): Promise<void> {
  let startIndex: number | undefined;
  for (let attempt = 0; attempt <= MAX_RESUMES; attempt++) {
    const result = await ingestDiscoverySources(source, startIndex);
    if (!result.ok) {
      push(labels.errors[result.error]);
      return;
    }
    const r = result.results[0];
    if (!r) {
      return;
    }
    push(line(labels, r));
    const next = r.result?.nextIndex;
    if (r.status !== "partial" || next === undefined) {
      return;
    }
    startIndex = next;
  }
}

function line(labels: Labels, r: IngestSourceResult): string {
  const name = labels.sourceShort[r.source];
  const reason = ingestReasonCode(r);
  if (reason === "ok" && r.result) {
    return `${name}: ${labels.ingestStatus.ok
      .replace("{fetched}", String(r.fetched))
      .replace("{created}", String(r.result.created))
      .replace("{updated}", String(r.result.updated))
      .replace("{ambiguous}", String(r.result.ambiguous))}`;
  }
  return `${name}: ${labels.ingestReason[reason]}`;
}

/** 「데이터 불러오기」 — API 원천마다 1페이지(파일 원천은 수동 단계 그대로). */
export function IngestButton({ labels }: { labels: Labels }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [lines, setLines] = useState<string[] | null>(null);
  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const done: string[] = [];
            const push = (text: string) => {
              done.push(text);
              setLines([...done]);
            };
            try {
              for (const source of SOURCES) {
                await ingestOneSource(source, labels, push);
              }
              router.refresh();
            } catch {
              push(labels.errors.unexpected);
            }
          })
        }
        size="sm"
        title={labels.ingestHelp}
        type="button"
        variant="outline"
      >
        {pending ? labels.ingesting : labels.ingest}
      </Button>
      {lines && (
        <output className="text-right text-[color:var(--findable-ink-subtle,#8a8f98)] text-xs leading-5">
          {lines.map((l) => (
            <span className="block" key={l}>
              {l}
            </span>
          ))}
        </output>
      )}
    </div>
  );
}
