import {
  actionTargetKey,
  buildGeoActions,
  type GeoAction,
} from "@repo/audit/actions";
import { auth, currentUser } from "@repo/auth/server";
import { database } from "@repo/database";
import { ListChecksIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { scopedLatestRunTracking } from "@/lib/db/scoped";
import { EmptyState } from "../components/empty-state";
import { Header } from "../components/header";
import { type ActionItem, ActionList } from "../features/analysis/action-list";
import {
  type SentimentBreakdownRow,
  SentimentSection,
} from "../features/analysis/sentiment-section";
import { engineLabel } from "../features/analysis/sources-board";
import { buildSourcesAnalysis } from "../lib/analysis-data";
import { summarizeSentiment } from "../lib/dashboard-data";
import { getPrimaryEmail } from "../lib/user";

export const metadata: Metadata = {
  title: "지금 할 일 · Findable",
  description:
    "측정 결과를 바탕으로 지금 해야 할 일을 우선순위로 알려드립니다.",
};

// S2'(2026-08-11) — 공용 `EmptyState` 로 교체. 문구는 그대로 유지한다
// (이 화면 것은 이미 4요소를 충족했다 — 바뀐 건 마크업 출처뿐).
const ActionsEmptyState = () => (
  <EmptyState
    description="측정을 한 번 실행하면, 그 결과를 바탕으로 지금 무엇부터 해야 하는지 우선순위로 정리해 드립니다."
    icon={<ListChecksIcon className="size-5" />}
    title="아직 측정한 적이 없어요"
  />
);

/**
 * 무료 진단 폴백 (전수감사 2026-08-02 §A-3) — "나머지 4건 보기" 약속 이행.
 *
 * www 진단 결과의 액션 티저가 "가입하면 나머지 N건"이라고 약속하는데,
 * 이 페이지는 org Tracking 전용이라 무료진단 가입자에겐 "측정 데이터 없음"
 * 빈 화면이 나왔다(약속 파기). 러너가 result.geoActions 를 이미 적재하므로
 * 같은 이메일의 최근 완료 진단에서 그대로 읽는다 — 추가 AI 호출 0.
 */
async function findEmailAuditActions(): Promise<{
  actions: GeoAction[];
  brandLabel: string;
  brandName?: string;
  /** 완료 체크를 붙이려면 도메인이 있어야 한다(서버가 이걸로 Brand 를 도출). */
  domain: string | null;
  /** 이 진단 시점의 SoV(0~100). 완료 스냅샷으로 박아 before/after 의 기준점이 된다. */
  sov: number | null;
} | null> {
  const user = await currentUser();
  const email = user ? getPrimaryEmail(user) : null;
  if (!email) {
    return null;
  }
  const job = await database.auditJob.findFirst({
    where: { email, status: "completed" },
    orderBy: { createdAt: "desc" },
    select: { domain: true, result: true },
  });
  const result = job?.result as {
    brandName?: string;
    geoActions?: GeoAction[];
    metrics?: { sov?: number };
  } | null;
  if (!result?.geoActions?.length) {
    return null;
  }
  return {
    actions: result.geoActions,
    brandLabel: result.brandName || job?.domain || "",
    brandName: result.brandName,
    domain: job?.domain ?? null,
    // 🔴 2차 교차검증에서 잡음: 예전엔 `null` 을 넘겨 **완료 시점 SoV 가 안 남았다**.
    //   그러면 `ActionCompletion.sovAtCompletion` 이 비어 "완료 후 몇 점 올랐나"를
    //   영영 계산할 수 없다 — 이 기능을 만든 목적 자체가 사라진다.
    //   ⚠️ 정의가 같은지 확인함: 진단 `metrics.sov` 와 대시보드 `currentSov` 는
    //     둘 다 "언급된 응답 / 성공 응답 × 100"(0~100)이라 **같은 축에서 비교 가능**하다.
    sov: typeof result.metrics?.sov === "number" ? result.metrics.sov : null,
  };
}

/**
 * 무료 진단 도메인에 이미 붙어 있는 완료 기록을 읽는다 (2026-08-10 세션N-13).
 *
 * 🔒 **org 스코프 필수**: `Brand` 를 `organizationId` 와 **함께** 조회한다.
 *   domain 만으로 찾으면 같은 도메인을 측정한 **다른 조직의 완료 기록이 샌다**
 *   (예: 여러 고객이 nike.com 을 진단 — 실제로 DB에 중복 도메인이 존재한다).
 *
 * 아직 Brand 가 없으면(=완료를 누른 적 없음) 빈 Map. 첫 완료 시 서버가 만든다.
 */
async function findAuditCompletions(
  domain: string | null
): Promise<Map<string, { sovAtCompletion: number | null }>> {
  const empty = new Map<string, { sovAtCompletion: number | null }>();
  if (!domain) {
    return empty;
  }
  const { orgId } = await auth();
  if (!orgId) {
    return empty;
  }
  const brand = await database.brand.findFirst({
    where: { organizationId: orgId, domain },
    select: { id: true },
  });
  if (!brand) {
    return empty;
  }
  const rows = await database.actionCompletion.findMany({
    where: { brandId: brand.id },
    select: { kind: true, target: true, sovAtCompletion: true },
  });
  return new Map(
    rows.map((r) => [
      `${r.kind}:${r.target}`,
      { sovAtCompletion: r.sovAtCompletion },
    ])
  );
}

/**
 * 무료 진단 기준 액션 목록 — **완료 체크 가능**(2026-08-10 세션N-13).
 *
 * 🔴 **바뀐 이유(실측)**: 예전엔 읽기 전용이었다("완료 체크는 brandId 가 있어야 해서 분리").
 *   그 결과 `ActionCompletion` 이 **진단 72건·브랜드 7개에도 0건**이었다 —
 *   버그가 아니라 **입구가 좁아서**다. 처방은 보이는데 **완료를 저장할 곳이 없었다.**
 *   → 이제 완료를 누르면 서버가 `domain` 으로 Brand 를 도출/생성해 연결한다
 *     (`toggleActionCompletionByDomain`).
 *
 * 🔗 **왜 중요한가**: 조치 기록이 0건이면 **before/after 를 영원히 만들 수 없다**.
 *   "진단→조치→재측정" 루프를 데이터로 증명하는 유일한 입구가 여기다.
 *
 * ⚠️ `domain` 이 없으면(구버전 job) 완료 체크를 붙이지 못하므로 읽기 전용으로 폴백한다.
 */
const AuditActions = ({
  actions,
  brandLabel,
  brandName,
  completions,
  domain,
  sov,
}: {
  actions: GeoAction[];
  brandLabel: string;
  brandName?: string;
  completions: Map<string, { sovAtCompletion: number | null }>;
  domain: string | null;
  sov: number | null;
}) => {
  const items: ActionItem[] = actions.map((a) => {
    // target 규칙은 추적 경로와 **같은 함수**를 쓴다(복제하면 같은 액션이 두 번 기록된다).
    const target = actionTargetKey(a);
    const done = completions.get(`${a.kind}:${target}`);
    return {
      kind: a.kind,
      target,
      title: a.title,
      evidence: a.evidence,
      how: a.how,
      source: a.source,
      priority: a.priority,
      completed: Boolean(done),
      completedSov: done?.sovAtCompletion ?? null,
    };
  });

  return (
    <div className="flex flex-1 flex-col gap-6 p-6 pt-2">
      <div className="flex flex-col gap-1">
        <h1 className="font-semibold text-[color:var(--findable-ink,#f7f8f8)] text-xl">
          {brandLabel} — 지금 할 일 (무료 진단 기준)
        </h1>
        <p className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm">
          {domain
            ? "무료 진단에서 나온 처방 전체예요. 완료로 표시하면 이 브랜드가 내 목록에 등록돼요. 추적을 시작하면 다음 측정에서 점수 변화까지 이어집니다."
            : "무료 진단에서 나온 처방 전체예요. 브랜드를 등록하고 추적을 시작하면 완료 체크와 다음 측정에서의 점수 변화까지 이어집니다."}
        </p>
      </div>
      {domain ? (
        <ActionList
          actions={items}
          currentSov={sov}
          target={{ kind: "audit", domain, brandName }}
        />
      ) : (
        <div className="flex flex-col gap-3">
          {actions.map((a, i) => (
            <div
              className="findable-card flex flex-col gap-2 p-5"
              key={a.title}
            >
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[color:var(--findable-primary,#ff7a4d)]/15 font-semibold text-[11px] text-[color:var(--findable-primary,#ff7a4d)] tabular-nums">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="font-medium text-[color:var(--findable-ink,#f7f8f8)] text-sm leading-snug">
                    {a.title}
                  </h2>
                  <p className="mt-2 whitespace-pre-line text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm leading-relaxed">
                    {a.how}
                  </p>
                  <p className="mt-2 text-[color:var(--findable-ink-subtle,#8a8f98)] text-xs leading-relaxed">
                    근거: {a.evidence}
                    {a.source ? ` · ${a.source}` : ""}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      <Link
        className="self-start rounded-md bg-[color:var(--findable-primary,#ff7a4d)] px-4 py-2 font-medium text-black text-sm transition-opacity hover:opacity-90"
        href="/brand"
      >
        브랜드 등록하고 추적 시작하기
      </Link>
    </div>
  );
};

const ActionsPage = async () => {
  const rows = await scopedLatestRunTracking();
  const sources = buildSourcesAnalysis(rows);
  const first = rows[0];

  if (!(first && sources)) {
    // org 추적이 없으면 → 무료 진단(이메일) 액션 폴백 → 그것도 없으면 빈 상태.
    const emailAudit = await findEmailAuditActions();
    // 이 도메인으로 이미 Brand 가 만들어져 있으면(=완료를 누른 적이 있으면) 그 기록을 읽는다.
    // 없으면 빈 Map — 첫 완료 시점에 서버가 Brand 를 만든다.
    const auditCompletions = await findAuditCompletions(
      emailAudit?.domain ?? null
    );
    return (
      <>
        <Header page="지금 할 일" pages={["Findable"]} />
        {emailAudit ? (
          <AuditActions
            actions={emailAudit.actions}
            brandLabel={emailAudit.brandLabel}
            brandName={emailAudit.brandName}
            completions={auditCompletions}
            domain={emailAudit.domain}
            sov={emailAudit.sov}
          />
        ) : (
          <div className="flex flex-1 flex-col gap-6 p-6 pt-2">
            <ActionsEmptyState />
          </div>
        )}
      </>
    );
  }

  // 프롬프트별 언급 여부 — 갭 액션의 핵심 입력. Tracking 행을 프롬프트 단위로 접는다.
  const byPrompt = new Map<string, { hit: number; total: number }>();
  for (const row of rows) {
    const key = row.promptId ?? "";
    const entry = byPrompt.get(key) ?? { hit: 0, total: 0 };
    entry.total += 1;
    if (row.brandMentioned) {
      entry.hit += 1;
    }
    byPrompt.set(key, entry);
  }
  const promptTexts = await database.prompt.findMany({
    where: { id: { in: [...byPrompt.keys()].filter(Boolean) } },
    select: { id: true, text: true },
  });
  const prompts = promptTexts.map((p) => ({
    text: p.text,
    hit: byPrompt.get(p.id)?.hit ?? 0,
    total: byPrompt.get(p.id)?.total ?? 0,
  }));

  const enginesMeasured = new Set(rows.map((r) => r.engineId)).size;
  const enginesMentioned = new Set(
    rows.filter((r) => r.brandMentioned).map((r) => r.engineId)
  ).size;
  const currentSov =
    rows.length > 0
      ? Math.round(
          (rows.filter((r) => r.brandMentioned).length / rows.length) * 100
        )
      : null;

  const mix = sources.kinds.reduce(
    (acc, k) => {
      acc[k.kind] = k.citations;
      return acc;
    },
    { owned: 0, community: 0, reference: 0, media: 0, other: 0 } as Record<
      string,
      number
    >
  );

  const geoActions = buildGeoActions({
    brandName: first.brand.name || first.brand.domain,
    averageMentionPosition: null,
    enginesMeasured,
    enginesMentioned,
    prompts,
    sourceMix: {
      owned: mix.owned ?? 0,
      community: mix.community ?? 0,
      reference: mix.reference ?? 0,
      media: mix.media ?? 0,
      other: mix.other ?? 0,
    },
    topDomains: sources.domains.map((d) => ({
      domain: d.domain,
      count: d.citations,
      owned: d.owned,
    })),
  });

  // ── 감성 분해 (세션N-34 · G-2) ────────────────────────────────
  // 🔴 **쿼리 변경 0.** `rows` 는 이미 `sentiment` 를 들고 있고(`scoped.ts:56`)
  //   질문 원문(`promptTexts`)도 위에서 이미 조회했다 — 새로 읽는 것이 없다.
  // 🔴 집계는 `summarizeSentiment`(대시보드와 **같은 함수**)를 쓴다.
  //   여기서 다시 세면 같은 브랜드의 감성이 두 화면에서 갈린다.
  const sentimentSummary = summarizeSentiment(rows);

  const promptTextById = new Map(promptTexts.map((p) => [p.id, p.text]));
  const groupSentiment = (
    keyOf: (row: (typeof rows)[number]) => string | null | undefined,
    labelOf: (key: string) => string
  ): SentimentBreakdownRow[] => {
    const groups = new Map<string, typeof rows>();
    for (const row of rows) {
      const key = keyOf(row);
      if (!key) {
        continue;
      }
      const bucket = groups.get(key);
      if (bucket) {
        bucket.push(row);
      } else {
        groups.set(key, [row]);
      }
    }
    const out: SentimentBreakdownRow[] = [];
    for (const [key, group] of groups) {
      const summary = summarizeSentiment(group);
      // 판정된 답변이 하나도 없는 그룹은 **그리지 않는다**(0% 로 깔면 "나쁘다"로 읽힌다).
      if (summary) {
        out.push({ label: labelOf(key), summary });
      }
    }
    // 밋밋한 것부터 — 이 화면은 "어디를 손볼까"에 답해야 한다(개선 여지 큰 순).
    return out.sort(
      (a, b) =>
        a.summary.positive / a.summary.total -
        b.summary.positive / b.summary.total
    );
  };

  const sentimentByPrompt = groupSentiment(
    (r) => r.promptId,
    (id) => promptTextById.get(id) ?? "(질문 원문 없음)"
  );
  const sentimentByEngine = groupSentiment(
    (r) => r.engineId,
    (id) => engineLabel(id)
  );

  // 완료 기록 병합 — 액션은 매 측정 재생성되지만 완료 표시는 영속(루프 닫기).
  const completions = await database.actionCompletion.findMany({
    where: { brandId: first.brandId },
    select: { kind: true, target: true, sovAtCompletion: true },
  });
  const completionKey = (kind: string, target: string) => `${kind}:${target}`;
  const completionMap = new Map(
    completions.map((c) => [completionKey(c.kind, c.target), c])
  );

  const items: ActionItem[] = geoActions.map((a) => {
    // target = 같은 종류 안에서 대상 구분. 프롬프트 갭은 질문 원문이 대상이다.
    const target = actionTargetKey(a);
    const done = completionMap.get(completionKey(a.kind, target));
    return {
      kind: a.kind,
      target,
      title: a.title,
      evidence: a.evidence,
      how: a.how,
      source: a.source,
      priority: a.priority,
      completed: Boolean(done),
      completedSov: done?.sovAtCompletion ?? null,
    };
  });

  return (
    <>
      <Header page="지금 할 일" pages={["Findable"]} />
      <div className="flex flex-1 flex-col gap-6 p-6 pt-2">
        <div className="flex flex-col gap-1">
          <h1 className="font-semibold text-[color:var(--findable-ink,#f7f8f8)] text-xl">
            {first.brand.name || first.brand.domain} — 지금 할 일
          </h1>
          <p className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm">
            최근 측정 결과를 바탕으로 효과가 큰 순서로 정리했어요. 완료로
            표시하면 다음 측정에서 점수 변화를 함께 보여드립니다.
          </p>
        </div>
        <ActionList
          actions={items}
          currentSov={currentSov}
          target={{ kind: "tracked", brandId: first.brandId }}
        />
        {/* 🔴 감성 섹션은 처방 **아래** — 이 화면의 주인공은 "지금 할 일"이다.
            감성은 *"왜 그 처방인가"* 의 근거로 읽히는 자리에 둔다.
            (「좋게 말하나?」 카드가 이리로 온다 — 예전 목적지 `/sources` 에는
             감성이 한 줄도 없어서 딴 주제 결제 벽이 떴다.) */}
        <SentimentSection
          byEngine={sentimentByEngine}
          byPrompt={sentimentByPrompt}
          summary={sentimentSummary}
        />
      </div>
    </>
  );
};

export default ActionsPage;
