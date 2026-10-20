"use client";

import { Button } from "@repo/design-system/components/ui/button";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ingestDiscoverySources } from "@/app/actions/admin/sales-discovery";
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

function line(labels: Labels, r: IngestSourceResult): string {
  const name = labels.sourceShort[r.source];
  if (r.status !== "ok" || !r.result) {
    return `${name}: ${labels.ingestStatus[r.status === "ok" ? "error" : r.status]}`;
  }
  return `${name}: ${labels.ingestStatus.ok
    .replace("{fetched}", String(r.fetched))
    .replace("{created}", String(r.result.created))
    .replace("{updated}", String(r.result.updated))
    .replace("{ambiguous}", String(r.result.ambiguous))}`;
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
            try {
              for (const source of SOURCES) {
                const result = await ingestDiscoverySources(source);
                if (!result.ok) {
                  done.push(labels.errors[result.error]);
                  setLines([...done]);
                  break;
                }
                for (const r of result.results) {
                  done.push(line(labels, r));
                }
                setLines([...done]);
              }
              router.refresh();
            } catch {
              done.push(labels.errors.unexpected);
              setLines([...done]);
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
