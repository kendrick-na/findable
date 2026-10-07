import Link from "next/link";
import { env } from "@/env";
import { withDiscovery } from "@/lib/ax-mail/discovery/guard";
import {
  loadCompanyCard,
  loadDiscoverScreen,
} from "@/lib/ax-mail/discovery/screen";
import {
  discoverHref,
  PAGE_SIZE,
  parseDiscoverParams,
  SORTS,
} from "@/lib/ax-mail/discovery/view";
import { reportWebUrl } from "@/lib/client-report/admin";
import { getAppDictionary } from "@/lib/i18n";
import { senderState } from "../sender-state";
import { CompanyCard } from "./company-card";
import { CompanyTable } from "./company-table";
import { FilterBar } from "./filter-bar";
import { IngestButton } from "./ingest-button";
import { PipelineBar } from "./pipeline-bar";
import { SegmentBar } from "./segment-bar";

/**
 * 「회사 찾기」 본문 — 인증은 page.tsx 가 끝낸 뒤 부른다(이 컴포넌트는 관리자 확인을 하지 않는다).
 * 플래그·테이블 확인은 여기서 withDiscovery 로 한다.
 */
export async function DiscoverScreen({
  orgId,
  raw,
  userId,
}: {
  orgId: string;
  raw: Record<string, string | string[] | undefined>;
  userId: string;
}) {
  const t = await getAppDictionary();
  const labels = t.salesDiscover;
  const params = parseDiscoverParams(raw);
  const webUrl = reportWebUrl(env.NEXT_PUBLIC_WEB_URL);
  const guarded = await withDiscovery(async () => {
    const [screen, card] = await Promise.all([
      loadDiscoverScreen(params),
      params.companyId ? loadCompanyCard(params.companyId, webUrl) : null,
    ]);
    return { card, screen };
  });
  const sender =
    guarded.state === "ready" && guarded.value.card
      ? await senderState(orgId, userId)
      : null;

  return (
    <main className="mx-auto flex w-full max-w-[1600px] flex-col gap-5 px-4 py-6 md:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <p className="font-medium text-emerald-400 text-xs uppercase tracking-[0.2em]">
            {labels.eyebrow}
          </p>
          <h1 className="font-semibold text-3xl tracking-tight">
            {labels.title}
          </h1>
          <p className="max-w-3xl text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm leading-6">
            {labels.description}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Link
            className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm underline-offset-2 hover:underline"
            href="/admin/ax-mail"
          >
            {labels.backToOutreach}
          </Link>
          {guarded.state === "ready" && <IngestButton labels={labels} />}
        </div>
      </div>

      {guarded.state === "disabled" && (
        <Notice body={labels.disabledBody} title={labels.disabledTitle} />
      )}
      {guarded.state === "db_not_ready" && (
        <Notice body={labels.dbNotReadyBody} title={labels.dbNotReadyTitle} />
      )}
      {guarded.state === "ready" && (
        <>
          <SegmentBar
            activeId={params.segmentId}
            allHref={discoverHref(params, { segmentId: null })}
            currentFilter={guarded.value.screen.segmentFilter}
            labels={labels}
            params={params}
            segments={guarded.value.screen.segments.map((s) => ({
              companyCount: s.companyCount,
              filter: s.filter,
              href: discoverHref(params, { segmentId: s.id }),
              id: s.id,
              name: s.name,
            }))}
          />
          {guarded.value.screen.segmentInvalid && (
            <p className="text-amber-300 text-sm">{labels.segmentInvalid}</p>
          )}
          <FilterBar
            labels={labels}
            params={params}
            total={guarded.value.screen.total}
          />
          <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
            <CompanyTable
              labels={labels}
              nextHref={
                params.page * PAGE_SIZE < guarded.value.screen.total
                  ? discoverHref(params, { page: params.page + 1 })
                  : null
              }
              page={params.page}
              pages={Math.max(
                1,
                Math.ceil(guarded.value.screen.total / PAGE_SIZE)
              )}
              prevHref={
                params.page > 1
                  ? discoverHref(params, { page: params.page - 1 })
                  : null
              }
              rows={guarded.value.screen.companies.map((c) => ({
                ...c,
                href: discoverHref(params, { companyId: c.id }),
              }))}
              segmentId={params.segmentId}
              selectedId={params.companyId}
              sort={params.sort}
              sortLinks={SORTS.map((sort) => ({
                href: discoverHref(params, { sort }),
                sort,
              }))}
              total={guarded.value.screen.total}
            />
            <aside className="xl:sticky xl:top-4">
              {guarded.value.card ? (
                <CompanyCard
                  canSave={sender?.kind === "ok"}
                  card={guarded.value.card}
                  closeHref={discoverHref(params, { companyId: null })}
                  key={guarded.value.card.company.id}
                  labels={labels}
                  mailLabels={t.axMail}
                />
              ) : (
                <p className="rounded-xl border border-[color:var(--findable-hairline,#23252a)] border-dashed p-6 text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm">
                  {params.companyId ? labels.cardNotFound : labels.cardEmpty}
                </p>
              )}
            </aside>
          </div>
          <PipelineBar
            allHref={discoverHref(params, { stage: null })}
            counts={guarded.value.screen.pipeline}
            labels={labels}
            params={params}
          />
        </>
      )}
    </main>
  );
}

function Notice({ title, body }: { body: string; title: string }) {
  return (
    <section
      className="rounded-xl border border-amber-900/60 bg-amber-950/20 p-5 text-sm"
      data-testid="discover-notice"
    >
      <p className="font-semibold text-amber-200">{title}</p>
      <p className="mt-1.5 text-amber-100/80 leading-6">{body}</p>
    </section>
  );
}
