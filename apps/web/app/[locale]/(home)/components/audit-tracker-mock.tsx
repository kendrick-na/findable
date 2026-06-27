// Findable Audit Tracker Mock — Linear Issue Tracker 패턴 카피
// 좌측 사이드바 + 본문 + 우측 메타 (정적 mock)
// D-060 (2026-05-11): locale 분기 추가

import {
  Activity,
  BarChart3,
  Check,
  ChevronDown,
  Clock,
  FileText,
  Folder,
  Inbox,
  MoreHorizontal,
  Search,
  Sparkles,
  Star,
  TrendingUp,
} from "lucide-react";

const COPY = {
  ko: {
    sidebar: ["받은편지함", "모든 진단", "진행 중", "리포트"],
    workspace: ["브랜드 이니셔티브", "진단 프로젝트"],
    favorites: ["메디큐브 Q1 SoV report", "Citation gap · 7 engines", "Korean Entity Grounding"],
    search: "검색",
    workspaceLabel: "워크스페이스",
    favoritesLabel: "즐겨찾기",
    activity: [
      { avatar: "F", label: "Findable", role: "에이전트", time: "2분 전", text: "ChatGPT 답변 12건 인용 발견" },
      { avatar: "민", label: "민지", role: "GEO 분석가", time: "5분 전", text: "한국어 변형 통합 — 메디큐브/MEDICUBE/Medicube 47회" },
      { avatar: "F", label: "Findable", role: "에이전트", time: "12분 전", text: "AUDIT-0421을 진행 중으로 이동" },
    ],
    issueTitle: "메디큐브 — Perplexity SoV 12% 하락",
    issueBodyPre: "7개 엔진 답변 비교 결과 Perplexity에서 ",
    issueBodyPost: " 지표가 지난 7일 평균 -12% 하락. 인용 도메인 분석 시작.",
    activityLabel: "활동",
    agentRunning: "Findable 에이전트 · 진단 중",
    agentResult: "→ 7개 AI 답변 142건 분석 · 인용 갭 23건 발견",
    metaStatus: "상태",
    metaStatusValue: "진행 중",
    metaPriority: "우선순위",
    metaPriorityValue: "높음",
    metaAssignee: "담당자",
    metaAssigneeValue: "민지",
    metaAssigneeAvatar: "민",
    metaLabels: "라벨",
    tagCitation: "인용",
    tagBeauty: "K-뷰티",
    metaCycle: "사이클",
    metaProject: "프로젝트",
    metaProjectValue: "K-뷰티 Q1 트래킹",
    metaRuntime: "실행 시간",
    metaRuntimeValue: "2분 17초",
    resolve: "해결 처리",
  },
  en: {
    sidebar: ["Inbox", "All audits", "In progress", "Reports"],
    workspace: ["Brand initiatives", "Audit projects"],
    favorites: ["Medicube Q1 SoV report", "Citation gap · 7 engines", "Korean Entity Grounding"],
    search: "Search",
    workspaceLabel: "Workspace",
    favoritesLabel: "Favorites",
    activity: [
      { avatar: "F", label: "Findable", role: "agent", time: "2 min ago", text: "Found 12 citations in ChatGPT answers" },
      { avatar: "M", label: "Minji", role: "GEO analyst", time: "5 min ago", text: "Merged Korean variants — Medicube / MEDICUBE / 메디큐브 ×47" },
      { avatar: "F", label: "Findable", role: "agent", time: "12 min ago", text: "Moved AUDIT-0421 to In progress" },
    ],
    issueTitle: "Medicube — Perplexity SoV down 12%",
    issueBodyPre: "Comparing answers across 7 engines, the ",
    issueBodyPost: " metric on Perplexity dropped -12% vs the 7-day average. Started cited-domain analysis.",
    activityLabel: "Activity",
    agentRunning: "Findable agent · auditing",
    agentResult: "→ Analyzed 142 answers across 7 AI engines · found 23 citation gaps",
    metaStatus: "Status",
    metaStatusValue: "In progress",
    metaPriority: "Priority",
    metaPriorityValue: "High",
    metaAssignee: "Assignee",
    metaAssigneeValue: "Minji",
    metaAssigneeAvatar: "M",
    metaLabels: "Labels",
    tagCitation: "Citation",
    tagBeauty: "K-beauty",
    metaCycle: "Cycle",
    metaProject: "Project",
    metaProjectValue: "K-beauty Q1 tracking",
    metaRuntime: "Runtime",
    metaRuntimeValue: "2m 17s",
    resolve: "Resolve",
  },
};

interface AuditTrackerMockProps {
  locale?: string;
}

export const AuditTrackerMock = ({ locale = "ko" }: AuditTrackerMockProps) => {
  const isKo = locale.startsWith("ko");
  const t = isKo ? COPY.ko : COPY.en;
  const SIDEBAR = [
    { icon: Inbox, label: t.sidebar[0], count: 3 },
    { icon: FileText, label: t.sidebar[1], count: 142 },
    { icon: Activity, label: t.sidebar[2], count: 7 },
    { icon: BarChart3, label: t.sidebar[3], count: undefined as number | undefined },
  ];
  const WORKSPACE = [
    { icon: TrendingUp, label: t.workspace[0] },
    { icon: Folder, label: t.workspace[1] },
  ];
  const FAVORITES = t.favorites.map((label) => ({ label }));
  const ACTIVITY = t.activity;
  return (
    <div
      className="overflow-hidden rounded-xl border border-[var(--findable-hairline-strong)] bg-[var(--findable-surface-1)]"
      style={{
        boxShadow:
          "inset 0 1px 0 rgba(255,255,255,0.06), 0 24px 48px -16px rgba(0,0,0,0.5)",
        fontFamily: "var(--findable-font-sans)",
      }}
    >
      <div className="grid grid-cols-1 md:grid-cols-[200px_1fr_240px]">
        {/* 좌측 사이드바 — 모바일에서는 숨김 (옵션 C) */}
        <aside className="hidden border-[var(--findable-hairline)] border-r bg-[var(--findable-canvas)] p-3 text-[13px] md:block">
          {/* Workspace selector */}
          <div className="mb-4 flex items-center justify-between rounded px-2 py-1.5 text-[var(--findable-ink)] hover:bg-[var(--findable-surface-2)]">
            <span className="flex items-center gap-2">
              <span className="flex h-5 w-5 items-center justify-center rounded bg-[var(--findable-primary)] text-[10px] font-medium text-white">
                F
              </span>
              <span>Findable</span>
            </span>
            <ChevronDown className="h-3.5 w-3.5 text-[var(--findable-ink-subtle)]" />
          </div>

          {/* 검색 */}
          <div className="mb-4 flex items-center gap-2 rounded px-2 py-1.5 text-[var(--findable-ink-tertiary)]">
            <Search className="h-3.5 w-3.5" />
            <span className="text-[12px]">{t.search}</span>
          </div>

          {/* 메인 메뉴 */}
          <nav className="space-y-0.5">
            {SIDEBAR.map((item, i) => (
              <button
                key={item.label}
                type="button"
                className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left ${
                  i === 1
                    ? "bg-[var(--findable-surface-2)] text-[var(--findable-ink)]"
                    : "text-[var(--findable-ink-muted)] hover:bg-[var(--findable-surface-2)]"
                }`}
              >
                <span className="flex items-center gap-2">
                  <item.icon className="h-3.5 w-3.5" />
                  <span>{item.label}</span>
                </span>
                {item.count !== undefined && (
                  <span className="text-[11px] text-[var(--findable-ink-tertiary)]">
                    {item.count}
                  </span>
                )}
              </button>
            ))}
          </nav>

          {/* Workspace */}
          <p className="mt-5 px-2 text-[10px] uppercase tracking-[0.14em] text-[var(--findable-ink-tertiary)]">
            {t.workspaceLabel}
          </p>
          <nav className="mt-1.5 space-y-0.5">
            {WORKSPACE.map((item) => (
              <button
                key={item.label}
                type="button"
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[var(--findable-ink-muted)] hover:bg-[var(--findable-surface-2)]"
              >
                <item.icon className="h-3.5 w-3.5" />
                <span>{item.label}</span>
              </button>
            ))}
          </nav>

          {/* Favorites */}
          <p className="mt-5 px-2 text-[10px] uppercase tracking-[0.14em] text-[var(--findable-ink-tertiary)]">
            {t.favoritesLabel}
          </p>
          <nav className="mt-1.5 space-y-0.5">
            {FAVORITES.map((item) => (
              <button
                key={item.label}
                type="button"
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[var(--findable-ink-muted)] hover:bg-[var(--findable-surface-2)]"
              >
                <Star className="h-3.5 w-3.5" />
                <span className="truncate text-[12px]">{item.label}</span>
              </button>
            ))}
          </nav>
        </aside>

        {/* 본문 */}
        <main className="bg-[var(--findable-surface-1)] p-6">
          {/* breadcrumb */}
          <div className="flex items-center gap-2 text-[12px] text-[var(--findable-ink-subtle)]">
            <span style={{ fontFamily: "var(--findable-font-mono)" }}>
              AUDIT-0421
            </span>
            <span>·</span>
            <span>02 / 142</span>
            <span className="ml-auto flex items-center gap-2">
              <span className="rounded bg-[var(--findable-surface-2)] px-2 py-0.5 text-[10px]">
                ENG-2703
              </span>
              <MoreHorizontal className="h-4 w-4" />
            </span>
          </div>

          {/* 제목 */}
          <h3
            className="mt-4 text-[20px] text-[var(--findable-ink)]"
            style={{ fontWeight: 500 }}
          >
            {t.issueTitle}
          </h3>

          <p className="mt-2 text-[13px] leading-[1.6] text-[var(--findable-ink-muted)]">
            {t.issueBodyPre}
            <code
              className="rounded bg-[var(--findable-surface-2)] px-1.5 py-0.5 text-[11px] text-[var(--findable-primary)]"
              style={{ fontFamily: "var(--findable-font-mono)" }}
            >
              brand_recall
            </code>
            {t.issueBodyPost}
          </p>

          {/* Activity */}
          <p
            className="mt-6 mb-3 text-[11px] uppercase tracking-[0.14em] text-[var(--findable-ink-tertiary)]"
            style={{ fontWeight: 600 }}
          >
            {t.activityLabel}
          </p>
          <div className="space-y-3">
            {ACTIVITY.map((a, i) => (
              <div key={i} className="flex gap-3">
                <span
                  className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-medium ${
                    a.role === "agent"
                      ? "bg-[var(--findable-primary)] text-white"
                      : "bg-[var(--findable-surface-3)] text-[var(--findable-ink-muted)]"
                  }`}
                >
                  {a.avatar}
                </span>
                <div className="flex-1">
                  <p className="text-[12px]">
                    <span className="text-[var(--findable-ink)]">
                      {a.label}
                    </span>
                    <span className="ml-2 text-[var(--findable-ink-tertiary)]">
                      {a.role}
                    </span>
                    <span className="ml-2 text-[var(--findable-ink-tertiary)]">
                      · {a.time}
                    </span>
                  </p>
                  <p className="mt-0.5 text-[12px] leading-[1.5] text-[var(--findable-ink-muted)]">
                    {a.text}
                  </p>
                </div>
              </div>
            ))}
          </div>

          {/* AI agent 진행 박스 */}
          <div
            className="mt-6 rounded-md border border-[var(--findable-primary)]/30 bg-[var(--findable-primary)]/5 p-3"
            style={{ fontFamily: "var(--findable-font-mono)" }}
          >
            <div className="flex items-center gap-2 text-[11px] text-[var(--findable-primary)]">
              <Sparkles className="h-3 w-3" />
              <span>{t.agentRunning}</span>
            </div>
            <p className="mt-1.5 text-[11px] text-[var(--findable-ink-muted)]">
              {t.agentResult}
            </p>
          </div>
        </main>

        {/* 우측 메타 — 모바일에서는 숨김 (옵션 C) */}
        <aside className="hidden space-y-5 border-[var(--findable-hairline)] border-l bg-[var(--findable-canvas)] p-5 text-[12px] md:block">
          <Meta
            label={t.metaStatus}
            value={
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-[var(--findable-primary)]" />
                <span>{t.metaStatusValue}</span>
              </span>
            }
          />
          <Meta
            label={t.metaPriority}
            value={
              <span className="text-[var(--findable-ink)]">
                {t.metaPriorityValue}
              </span>
            }
          />
          <Meta
            label={t.metaAssignee}
            value={
              <span className="flex items-center gap-1.5">
                <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[var(--findable-surface-3)] text-[9px] text-[var(--findable-ink-muted)]">
                  {t.metaAssigneeAvatar}
                </span>
                <span>{t.metaAssigneeValue}</span>
              </span>
            }
          />
          <Meta
            label={t.metaLabels}
            value={
              <div className="flex flex-wrap gap-1">
                <Tag color="primary">GEO</Tag>
                <Tag>{t.tagCitation}</Tag>
                <Tag>{t.tagBeauty}</Tag>
              </div>
            }
          />
          <Meta
            label={t.metaCycle}
            value={<span className="text-[var(--findable-ink)]">CYC 12</span>}
          />
          <Meta
            label={t.metaProject}
            value={
              <span className="text-[var(--findable-ink)]">
                {t.metaProjectValue}
              </span>
            }
          />
          <Meta
            label={t.metaRuntime}
            value={
              <span className="flex items-center gap-1 text-[var(--findable-ink-muted)]">
                <Clock className="h-3 w-3" />
                <span>{t.metaRuntimeValue}</span>
              </span>
            }
          />
          <div className="border-[var(--findable-hairline)] border-t pt-4">
            <button
              type="button"
              className="flex w-full items-center justify-center gap-1.5 rounded-md bg-[var(--findable-surface-2)] py-2 text-[12px] text-[var(--findable-ink)] transition hover:bg-[var(--findable-surface-3)]"
            >
              <Check className="h-3.5 w-3.5 text-[var(--findable-success)]" />
              {t.resolve}
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
};

const Meta = ({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) => (
  <div>
    <p className="text-[10px] uppercase tracking-[0.14em] text-[var(--findable-ink-tertiary)]">
      {label}
    </p>
    <div className="mt-1.5 text-[var(--findable-ink-muted)]">{value}</div>
  </div>
);

const Tag = ({
  children,
  color,
}: {
  children: React.ReactNode;
  color?: "primary";
}) => (
  <span
    className={`rounded px-1.5 py-0.5 text-[10px] ${
      color === "primary"
        ? "bg-[var(--findable-primary)]/15 text-[var(--findable-primary)]"
        : "bg-[var(--findable-surface-2)] text-[var(--findable-ink-muted)]"
    }`}
    style={{ fontFamily: "var(--findable-font-mono)" }}
  >
    {children}
  </span>
);
