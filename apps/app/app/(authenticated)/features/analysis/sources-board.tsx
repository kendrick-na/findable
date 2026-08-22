// 백로그 3(2026-07-31): Mention/Citation 분리 + 인용 출처(Sources) 뷰.
// 서버 컴포넌트. 집계는 analysis-data.ts, 여기는 표시만 담당한다.

// 🔴 이름은 지표 사전에서 온다 — 이 화면은 같은 숫자를 카드에선 `언급률`,
//   아래 설명문(`:307`)에선 `등장률` 이라 부르고 있었다(한 화면 두 이름).
//   사전이 화면에 이미 있던 말 중 널리 쓰이는 쪽을 골랐으므로 설명문과 맞춰진다.
import {
  engineRegion,
  engineSourceState,
  REGION_LABEL,
} from "@repo/audit/market-scope";
import { METRICS } from "@repo/audit/metric-dictionary";
import { cn } from "@repo/design-system/lib/utils";
import { ExternalLinkIcon } from "lucide-react";
import type {
  CitedDomainStat,
  EngineMentionStat,
  SourceKind,
  SourcesAnalysis,
} from "../../lib/analysis-data";
import { SOURCE_KIND_LABEL } from "../../lib/analysis-data";
import { formatMeasuredAt } from "../../lib/dashboard-data";

// 표에 세우는 최대 도메인 수. 롱테일(1회 인용)은 접는다.
const MAX_DOMAINS = 15;

const KIND_TONE: Record<SourceKind, string> = {
  owned:
    "bg-[color:var(--findable-primary,#ff7a4d)]/15 text-[color:var(--findable-primary,#ff7a4d)]",
  community: "bg-sky-500/12 text-sky-300",
  reference: "bg-violet-500/12 text-violet-300",
  media: "bg-emerald-500/12 text-emerald-300",
  other: "bg-white/8 text-[color:var(--findable-ink-subtle,#8a8f98)]",
};

// 엔진 id → 사람이 읽는 이름. seed 의 Engine.name 을 다시 조회하지 않기 위한 표시용 사전.
//
// 🔴 세션N-38: `chatgpt-web`·`naver-briefing` **두 칸이 비어 있었다.** 폴백이 id 원문을
//   그대로 내보내므로 화면에 `naver-briefing` 이라고 **영문 슬러그가 노출**된다.
//   권역 분리를 하면 이 둘이 그룹 안에 모여 더 눈에 띈다 → 같은 커밋에서 메운다.
// ⚠️ `@repo/ai` 의 `ENGINES[].name` 은 `Naver`·`Daum` 이라 **여기와 다르다**(영문).
//   화면은 한국어 표기를 쓰기로 이미 정해져 있으므로(위 두 줄) 그쪽으로 갈아타지 않는다 —
//   갈아타면 사용자가 보던 이름이 조용히 영문으로 바뀐다. 대신 **누락만** 메운다.
const ENGINE_LABEL: Record<string, string> = {
  chatgpt: "ChatGPT",
  "chatgpt-web": "ChatGPT (웹)",
  claude: "Claude",
  perplexity: "Perplexity",
  gemini: "Gemini",
  hyperclova: "HyperCLOVA X",
  naver: "네이버",
  "naver-briefing": "네이버 AI 브리핑",
  daum: "다음",
};

// 🔴 `export`(세션N-34): 감성 섹션도 같은 이름표를 쓴다. 복제하면 한 화면은
//   `naver`, 다른 화면은 `네이버` 라고 부르게 된다(이 저장소의 "이름 4개" 사고와 같은 유형).
export function engineLabel(id: string): string {
  return ENGINE_LABEL[id] ?? id;
}

function percent(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

// 권역 표시 순서 — **한국을 먼저** 세운다.
// ⭐ 경쟁사 4곳(Profound·Peec·Otterly·Scrunch) 랜딩 라이브 fetch 결과
//   `naver|hyperclova|clova|daum|kakao` 언급이 **전부 0건**이다(재설계안 v4 §1111).
//   한국 엔진은 우리만 재는 축이므로 목록 아래로 밀지 않는다.
const REGION_ORDER = ["korea", "global"] as const;

/**
 * 엔진 한 줄. 🔴 **인용 0 을 세 가지로 갈라 말한다**(N-47 에 2 → 3 으로 늘었다).
 *
 * | 상태 | 화면 | 뜻 |
 * |---|---|---|
 * | `never` | 「출처 안 밝힘」 | API 가 출처를 아예 안 준다(hyperclova) |
 * | `not_collected` | 「출처 미수집」 | 🆕 낼 수 있는데 **우리가 그라운딩을 안 켰다** |
 * | `collected` | 「인용 N」 | 정상 수집 — 0 이면 **진짜로** 인용이 없었다 |
 *
 * 왜 갈라야 하나: 권역 분리를 하면 한국 엔진이 한 그룹에 모인다. 그 그룹 안에서
 * `인용 0` 이 나란히 보이면 *"한국 AI 는 우리를 안 읽는다"* 로 읽히는데,
 * hyperclova 는 **애초에 출처를 반환하지 않는 API** 라 0 이 성과와 무관하다.
 *
 * 🔴 **N-47 에 셋째 갈래가 필요해진 이유**: 프로덕션 382건 실측에서 perplexity 가
 *   **47/47**, gemini 가 **64/65** 로 출처가 비어 있었다. 그런데 화면은 이 둘을
 *   *"낼 수 있는 엔진"* 으로 분류해 **「인용 0」** 을 찍고 있었다 —
 *   고객에겐 *"이 AI 가 우리를 안 읽었다"* 로 읽힌다. 진실은 *"우리가 안 받아왔다"* 다.
 *   📕 이 저장소 최다 사고 — **못 잰 것을 0이라 부르기**.
 *
 * 판정은 `@repo/audit/market-scope` 단독 담당 — 여기서 엔진 id 를 비교하지 않는다.
 */
const EngineRow = ({
  engine,
  groundingEnabled,
}: {
  engine: EngineMentionStat;
  groundingEnabled: boolean;
}) => {
  const state = engineSourceState(engine.engineId, groundingEnabled);
  return (
    // ⚠️ `max-w-2xl`: PC(1440)에서 폭을 안 묶으면 이름과 숫자가 화면 양끝으로 벌어져
    //   **어느 줄의 숫자인지 눈으로 잇기 어렵다**(스크린샷 2026-08-17). 모바일은 원래 좁아 무영향.
    <div className="flex max-w-2xl items-baseline gap-3 border-white/5 border-b py-2 last:border-b-0">
      <span className="min-w-0 flex-1 truncate text-[color:var(--findable-ink-muted,#d0d6e0)] text-sm">
        {engineLabel(engine.engineId)}
      </span>
      <span className="shrink-0 text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm tabular-nums">
        등장 {engine.mentioned}/{engine.total}
      </span>
      {state === "collected" ? (
        <span
          className={cn(
            "shrink-0 text-right text-sm tabular-nums",
            engine.citations === 0
              ? "text-[color:var(--findable-ink-tertiary,#7e8289)]"
              : "text-[color:var(--findable-ink,#f7f8f8)]"
          )}
        >
          인용 {engine.citations}
        </span>
      ) : (
        // 🔴 모바일(390px)에서 잘리지 않게 짧게 쓴다. 실측: 「출처를 밝히지 않는 AI」는
        //   `...않는 AI` 로 잘렸다(스크린샷 2026-08-17). 뜻은 같고 길이만 줄인다.
        //
        // 🔴🔴 **「0」과 「못 잼」과 「안 받아옴」은 서로 다른 말이다**(N-47).
        //   `not_collected` 는 **우리가 그라운딩을 안 켜서** 출처가 안 온 상태다
        //   (프로덕션 실측: perplexity 47/47 · gemini 64/65 가 이 경우였다).
        //   여기에 `인용 0` 을 찍으면 고객은 *"이 AI 가 우리를 안 읽었다"* 로 읽는다.
        //   📕 이 저장소 최다 사고 — **못 잰 것을 0이라 부르기**. 정직하게 갈라 말한다.
        //   ⭐ 그라운딩을 켜면 이 분기는 **저절로 사라진다**(플래그를 보고 판정한다).
        <span className="shrink-0 text-right text-[color:var(--findable-ink-tertiary,#7e8289)] text-xs">
          {state === "never" ? "출처 안 밝힘" : "출처 미수집"}
        </span>
      )}
    </div>
  );
};

export const SourcesBoard = ({ data }: { data: SourcesAnalysis }) => {
  // 🔴 **서버 컴포넌트라 여기서 플래그를 읽는다** — prop 으로 실어나르면 배선이 한 겹 늘고
  //   그 겹에서 빠뜨리면 화면이 조용히 예전 말을 한다(📕 "이미 있는 걸 안 쓰고 있을 수 있다").
  //   판정 자체는 `engineSourceState` 단독 담당 — 여기서 엔진 id 를 비교하지 않는다(N-34).
  const groundingEnabled = process.env.FINDABLE_ENGINE_GROUNDING === "1";
  const {
    mentionRate,
    ownedCitations,
    kinds,
    domains,
    engines,
    measuredAt,
    filteredCitations,
  } = data;
  const mentionPct = percent(mentionRate.mentioned, mentionRate.total);
  const ownedPct = percent(ownedCitations.owned, ownedCitations.total);
  const topKind = kinds[0];
  const rows = domains.slice(0, MAX_DOMAINS);
  const hidden = domains.length - rows.length;

  return (
    <div className="flex flex-col gap-4">
      {/* Mention vs Citation — 이 화면의 존재 이유. 두 축을 나란히 세운다. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {/* 🔴 분모가 0이면 `0%` 를 찍지 않는다 — 못 잰 것을 "0점"이라 부르는 것이다
            (apple.com 사고 유형 · `measurement-coverage.ts` 머리말).
            바로 옆 카드는 이미 `—` 로 막고 있었는데 이 카드만 안 막혀 있었다
            = 같은 파일 안에 규칙이 두 벌(재설계안 v4 §4-a-1 ⑤). */}
        <MetricCard
          hint={
            mentionRate.total === 0
              ? "이번 측정에서는 분석할 AI 답변을 받지 못했어요"
              : `AI 답변 ${mentionRate.total}건 중 ${mentionRate.mentioned}건에 브랜드가 등장`
          }
          label={`${METRICS.sov.label} (Mention)`}
          value={mentionRate.total === 0 ? "—" : `${mentionPct}%`}
        />
        <MetricCard
          hint={
            ownedCitations.total === 0
              ? "이번 측정에서는 출처 링크를 못 찾았어요"
              : `전체 인용 ${ownedCitations.total}건 중 내 도메인 ${ownedCitations.owned}건`
          }
          label="우리 사이트가 출처로 걸린 비율"
          value={ownedCitations.total === 0 ? "—" : `${ownedPct}%`}
        />
        <MetricCard
          hint={
            topKind
              ? `출처로 가장 많이 걸린 종류 (${topKind.citations}건)`
              : "출처로 걸린 링크가 아직 없어요"
          }
          label="주요 출처"
          value={topKind ? SOURCE_KIND_LABEL[topKind.kind] : "—"}
        />
      </div>

      {/* 진단 문장 — 숫자만 두면 해석이 사용자 몫이 된다. */}
      <DiagnosisNote
        mentionPct={mentionPct}
        ownedPct={ownedPct}
        topKind={topKind?.kind}
        topKindShare={topKind?.share ?? 0}
        totalCitations={ownedCitations.total}
      />

      {kinds.length > 0 && (
        <div className="findable-card flex flex-col gap-4 p-6">
          <div className="flex flex-col gap-1">
            <h2 className="font-semibold text-[color:var(--findable-ink,#f7f8f8)] text-lg">
              출처 유형 구성
            </h2>
            <p className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm">
              AI가 답의 근거로 어떤 종류의 문서를 걸었는지 비중이에요.
            </p>
          </div>
          {/* 100% 누적 막대 */}
          <div className="flex h-3 overflow-hidden rounded-full bg-[color:var(--findable-surface-2,#141516)]">
            {kinds.map((kind) => (
              <div
                className={cn("h-full", KIND_BAR[kind.kind])}
                key={kind.kind}
                style={{ width: `${kind.share}%` }}
              />
            ))}
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {kinds.map((kind) => (
              <span className="flex items-center gap-2 text-sm" key={kind.kind}>
                <span
                  className={cn("size-2.5 rounded-full", KIND_BAR[kind.kind])}
                />
                <span className="text-[color:var(--findable-ink-muted,#d0d6e0)]">
                  {SOURCE_KIND_LABEL[kind.kind]}
                </span>
                <span className="text-[color:var(--findable-ink-tertiary,#7e8289)] tabular-nums">
                  {kind.share}%
                </span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 엔진별 Mention vs Citation 대조 — 권역(한국/글로벌)으로 나눠 세운다 */}
      <div className="findable-card flex flex-col gap-5 p-6">
        <div className="flex flex-col gap-1">
          <h2 className="font-semibold text-[color:var(--findable-ink,#f7f8f8)] text-lg">
            AI별 등장 · 출처
          </h2>
          <p className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm">
            우리를 말하면서도 링크가 0인 곳은, 답은 하지만 출처를 걸지 않는
            곳이에요.
          </p>
        </div>
        {REGION_ORDER.map((region) => {
          const group = engines.filter(
            (e) => engineRegion(e.engineId) === region
          );
          // 🔴 빈 권역은 섹션째 렌더하지 않는다 — 측정 안 한 곳에 `0%` 를 찍으면
          //   "못 잰 것"이 "0점"으로 읽힌다(apple.com 사고 유형).
          if (group.length === 0) {
            return null;
          }
          const mentioned = group.reduce((sum, e) => sum + e.mentioned, 0);
          const total = group.reduce((sum, e) => sum + e.total, 0);
          return (
            <section className="flex flex-col gap-2" key={region}>
              {/* 행과 같은 `max-w-2xl` — 헤더만 화면 끝에 있으면 제 그룹과 어긋나 보인다. */}
              <div className="flex max-w-2xl items-baseline justify-between gap-3">
                <h3 className="font-medium text-[color:var(--findable-ink,#f7f8f8)] text-sm">
                  {REGION_LABEL[region]}
                  <span className="ml-2 text-[color:var(--findable-ink-tertiary,#7e8289)] text-xs">
                    AI {group.length}곳
                  </span>
                </h3>
                <span className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm tabular-nums">
                  {total === 0 ? "—" : `등장 ${percent(mentioned, total)}%`}
                </span>
              </div>
              <div className="flex flex-col">
                {group.map((engine) => (
                  <EngineRow
                    engine={engine}
                    groundingEnabled={groundingEnabled}
                    key={engine.engineId}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>

      {/* 인용 도메인 목록 */}
      {rows.length > 0 && (
        <div className="findable-card flex flex-col gap-4 p-6">
          <div className="flex flex-col gap-1">
            <h2 className="font-semibold text-[color:var(--findable-ink,#f7f8f8)] text-lg">
              출처로 걸린 링크
            </h2>
            <p className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm">
              {formatMeasuredAt(measuredAt)} 측정 기준 · 많이 걸린 순
            </p>
          </div>
          <div className="flex flex-col">
            {rows.map((row) => (
              <DomainRow key={row.domain} row={row} />
            ))}
          </div>
          {hidden > 0 && (
            <p className="text-[color:var(--findable-ink-tertiary,#7e8289)] text-xs">
              그 외 {hidden}곳은 횟수가 적어 줄였어요.
            </p>
          )}
          {filteredCitations > 0 && (
            <p className="text-[color:var(--findable-ink-tertiary,#7e8289)] text-xs leading-relaxed">
              ※ 브랜드와 무관한 검색 결과 {filteredCitations}건은 집계에서
              제외했어요. 네이버·다음은 질문 문구로 검색한 결과를 함께 돌려주기
              때문에, 우리가 나오지 않은 문서가 섞여요.
            </p>
          )}
        </div>
      )}
    </div>
  );
};

const KIND_BAR: Record<SourceKind, string> = {
  owned: "bg-[color:var(--findable-primary,#ff7a4d)]",
  community: "bg-sky-400",
  reference: "bg-violet-400",
  media: "bg-emerald-400",
  other: "bg-[color:var(--findable-ink-tertiary,#7e8289)]",
};

const DomainRow = ({ row }: { row: CitedDomainStat }) => (
  <div className="flex items-start gap-3 border-white/5 border-b py-3 last:border-b-0">
    <span className="w-8 shrink-0 text-right text-[color:var(--findable-ink,#f7f8f8)] text-sm tabular-nums">
      {row.citations}
    </span>
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <a
          className="truncate font-medium text-[color:var(--findable-ink,#f7f8f8)] text-sm hover:underline"
          href={row.sampleUrl}
          rel="noopener noreferrer"
          target="_blank"
        >
          {row.domain}
          <ExternalLinkIcon className="ml-1 inline size-3 align-[-1px] opacity-60" />
        </a>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 font-medium text-xs",
            KIND_TONE[row.kind]
          )}
        >
          {SOURCE_KIND_LABEL[row.kind]}
        </span>
      </div>
      {row.sampleTitle && (
        <p className="truncate text-[color:var(--findable-ink-subtle,#8a8f98)] text-xs">
          {row.sampleTitle}
        </p>
      )}
    </div>
    <span className="hidden shrink-0 text-right text-[color:var(--findable-ink-tertiary,#7e8289)] text-xs sm:block">
      {row.engines.map(engineLabel).join(" · ")}
    </span>
  </div>
);

const MetricCard = ({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) => (
  <div className="findable-card flex flex-col gap-2 p-5">
    <p className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm">
      {label}
    </p>
    <span className="font-semibold text-3xl text-[color:var(--findable-ink,#f7f8f8)] tabular-nums">
      {value}
    </span>
    <p className="text-[color:var(--findable-ink-tertiary,#7e8289)] text-xs leading-relaxed">
      {hint}
    </p>
  </div>
);

/**
 * 숫자 → 문장. 임계값은 진단 카피의 근거를 코드에 남기기 위해 상수로 둔다.
 * (자사 인용률이 낮고 커뮤니티 의존이 높다 = 한국 GEO 의 전형적 실패 패턴)
 */
const LOW_OWNED_CITATION_PCT = 20;
const HIGH_THIRD_PARTY_SHARE = 40;

const DiagnosisNote = ({
  mentionPct,
  ownedPct,
  topKind,
  topKindShare,
  totalCitations,
}: {
  mentionPct: number;
  ownedPct: number;
  topKind?: SourceKind;
  topKindShare: number;
  totalCitations: number;
}) => {
  if (totalCitations === 0) {
    return (
      <p className="rounded border border-white/10 bg-white/[0.03] px-4 py-3 text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm leading-relaxed">
        이번 측정에서는 출처 링크를 못 찾았어요. 등장률(
        {mentionPct}%)은 답변 본문 기준이며, 인용은 검색 기반 엔진(네이버·다음·
        Perplexity)에서 주로 모여요.
      </p>
    );
  }

  const thirdPartyHeavy =
    topKind && topKind !== "owned" && topKindShare >= HIGH_THIRD_PARTY_SHARE;
  const lowOwned = ownedPct < LOW_OWNED_CITATION_PCT;

  if (lowOwned && thirdPartyHeavy) {
    return (
      <p className="rounded border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-amber-200/90 text-sm leading-relaxed">
        브랜드는 답변에 <strong>{mentionPct}%</strong> 등장하지만, 근거로 인용된
        곳은 대부분{" "}
        <strong>
          {SOURCE_KIND_LABEL[topKind]}({topKindShare}%)
        </strong>
        이고 자사 도메인은 <strong>{ownedPct}%</strong>에 그칩니다. AI가 우리
        브랜드를 설명할 때 <strong>우리 사이트가 아니라 남의 글</strong>을
        근거로 삼는다는 뜻이에요.
      </p>
    );
  }

  if (lowOwned) {
    return (
      <p className="rounded border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-amber-200/90 text-sm leading-relaxed">
        우리 사이트가 출처로 걸린 비율이 <strong>{ownedPct}%</strong>로 낮아요.
        공식 정보 페이지가 AI 답의 근거로 잘 쓰이지 않고 있어요.
      </p>
    );
  }

  return (
    <p className="rounded border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-emerald-200/90 text-sm leading-relaxed">
      우리 사이트가 전체 출처의 <strong>{ownedPct}%</strong>를 차지해요. 공식
      페이지가 AI 답의 근거로 쓰이고 있어요.
    </p>
  );
};
