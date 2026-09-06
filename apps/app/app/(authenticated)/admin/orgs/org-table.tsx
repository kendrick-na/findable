"use client";

import { Badge } from "@repo/design-system/components/ui/badge";
import { Button } from "@repo/design-system/components/ui/button";
import { Input } from "@repo/design-system/components/ui/input";
import { toast } from "@repo/design-system/components/ui/sonner";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { Fragment, useState } from "react";
import type {
  AdminResult,
  InviteRow,
  OrgDetail,
  OrgRow,
} from "@/app/actions/admin/orgs";
import { OrgDetailPanel } from "./org-detail";

/**
 * 운영 콘솔 표 — 가입 조직 + 초대 코드.
 *
 * 🔴 **서버액션을 import 하지 않고 주입받는다** — 직접 import 하면 `node:*` 가
 *   브라우저 번들로 끌려와 Storybook 이 통째로 죽는다(N-41 실측 · N-37 함정).
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** 만료까지 남은 일수. 지났으면 음수. */
function daysLeft(at: Date | null): number | null {
  if (!at) {
    return null;
  }
  return Math.ceil((new Date(at).getTime() - Date.now()) / DAY_MS);
}

const fmt = (d: Date | null) =>
  d ? new Date(d).toLocaleDateString("ko-KR") : "—";

const ReadinessCell = ({
  brandCount,
  busy,
  missingCount,
  onBackfill,
}: {
  brandCount: number;
  busy: boolean;
  missingCount: number;
  onBackfill?: () => void;
}) => {
  if (brandCount === 0) {
    return (
      <span className="text-[color:var(--findable-ink-tertiary,#7e8289)]">
        —
      </span>
    );
  }
  if (missingCount === 0) {
    return (
      <Badge className="border-emerald-400/20 bg-emerald-400/10 text-emerald-200">
        기록 있음
      </Badge>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <Badge className="border-amber-400/20 bg-amber-400/10 text-amber-200">
        미측정 {missingCount}
      </Badge>
      {onBackfill ? (
        <Button
          disabled={busy}
          onClick={onBackfill}
          size="sm"
          type="button"
          variant="ghost"
        >
          보완
        </Button>
      ) : null}
    </div>
  );
};

export const OrgTable = ({
  orgs,
  invites,
  onSetDays,
  onCreateCode,
  onBackfillReadiness,
  onUpdateCode,
  onLoadDetail,
}: {
  invites: InviteRow[];
  onCreateCode?: (input: {
    code: string;
    grantDays: number;
    label: string;
    maxRedemptions: number | null;
    validUntil: Date | null;
  }) => Promise<AdminResult>;
  /** 자동 실행 도입 전 누락된 사이트 준비도만 보완한다. */
  onBackfillReadiness?: (organizationId: string) => Promise<AdminResult>;
  /**
   * 조직 상세(가입자·브랜드·질문)를 **펼칠 때만** 부른다 — 목록은 200행까지 뽑으므로
   * 미리 join 하면 N+1 이 200배가 된다.
   * 🔴 서버액션을 여기서 import 하지 않고 **주입**받는 이유는 이 파일 상단 주석 참조.
   */
  onLoadDetail?: (orgId: string) => Promise<OrgDetail>;
  onSetDays?: (input: { days: number; orgId: string }) => Promise<AdminResult>;
  onUpdateCode?: (input: {
    grantDays: number;
    id: string;
    maxRedemptions: number | null;
  }) => Promise<AdminResult>;
  orgs: OrgRow[];
}) => {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  // 펼친 조직 하나 + 그 상세 캐시. 다시 접었다 펴도 재조회하지 않는다.
  const [openOrgId, setOpenOrgId] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, OrgDetail>>({});
  const [loadingDetail, setLoadingDetail] = useState<string | null>(null);
  const [newCode, setNewCode] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [newDays, setNewDays] = useState("30");
  const [newMax, setNewMax] = useState("20");

  /**
   * 조직 상세 펼치기/접기.
   * ⚠️ 실패해도 **행이 열린 채 비어 있지 않게** 한다 — 그러면 *"이 조직은 데이터가
   *   없다"* 로 오독된다. 못 불러왔으면 닫고 그렇다고 말한다.
   */
  const toggleDetail = async (orgId: string) => {
    if (openOrgId === orgId) {
      setOpenOrgId(null);
      return;
    }
    if (details[orgId] || !onLoadDetail) {
      setOpenOrgId(orgId);
      return;
    }
    setLoadingDetail(orgId);
    try {
      const detail = await onLoadDetail(orgId);
      setDetails((prev) => ({ ...prev, [orgId]: detail }));
      setOpenOrgId(orgId);
    } catch {
      toast.error("상세를 불러오지 못했어요.");
      setOpenOrgId(null);
    } finally {
      setLoadingDetail(null);
    }
  };

  const run = async (key: string, fn: () => Promise<AdminResult>) => {
    setBusy(key);
    try {
      const result = await fn();
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("적용했어요.");
      router.refresh();
    } catch {
      toast.error("처리하지 못했어요.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-8">
      {/* ── 초대 코드 ────────────────────────────────── */}
      <section className="flex flex-col gap-3">
        <h2 className="font-semibold text-[color:var(--findable-ink,#f7f8f8)] text-lg">
          초대 코드
        </h2>

        {onCreateCode ? (
          <div className="findable-card flex flex-wrap items-end gap-3 p-4">
            <label className="flex flex-col gap-1" htmlFor="new-code">
              <span className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-xs">
                코드
              </span>
              <Input
                className="w-52 uppercase"
                id="new-code"
                onChange={(e) => setNewCode(e.target.value)}
                placeholder="OVEREDGE2026"
                value={newCode}
              />
            </label>
            <label className="flex flex-col gap-1" htmlFor="new-label">
              <span className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-xs">
                이름(운영용)
              </span>
              <Input
                className="w-56"
                id="new-label"
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="KAIST 오버엣지 2026"
                value={newLabel}
              />
            </label>
            <label className="flex flex-col gap-1" htmlFor="new-days">
              <span className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-xs">
                기간(일)
              </span>
              <Input
                className="w-24"
                id="new-days"
                inputMode="numeric"
                onChange={(e) => setNewDays(e.target.value)}
                value={newDays}
              />
            </label>
            <label className="flex flex-col gap-1" htmlFor="new-max">
              <span className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-xs">
                한도(비우면 무제한)
              </span>
              <Input
                className="w-32"
                id="new-max"
                inputMode="numeric"
                onChange={(e) => setNewMax(e.target.value)}
                value={newMax}
              />
            </label>
            <Button
              className="findable-btn-primary"
              disabled={busy === "create"}
              onClick={() =>
                run("create", () =>
                  onCreateCode({
                    code: newCode,
                    label: newLabel,
                    grantDays: Number(newDays) || 30,
                    maxRedemptions: newMax.trim() ? Number(newMax) : null,
                    validUntil: null,
                  })
                )
              }
              type="button"
            >
              코드 만들기
            </Button>
          </div>
        ) : null}

        {invites.length === 0 ? (
          <p className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm">
            아직 만든 코드가 없어요.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {invites.map((c) => {
              const full =
                c.maxRedemptions !== null &&
                c.redeemedCount >= c.maxRedemptions;
              return (
                <li
                  className="findable-card flex flex-wrap items-center justify-between gap-3 p-4"
                  key={c.id}
                >
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="flex items-center gap-2">
                      <code className="font-mono text-[color:var(--findable-ink,#f7f8f8)] text-sm">
                        {c.code}
                      </code>
                      <Badge variant="outline">{c.grantPlan}</Badge>
                      <Badge variant="outline">{c.grantDays}일</Badge>
                      {full ? (
                        <Badge className="border-transparent bg-[color:var(--signal-bad,#f87171)]/15 text-[color:var(--signal-bad,#f87171)]">
                          한도 도달
                        </Badge>
                      ) : null}
                    </span>
                    <span className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-xs">
                      {c.label} · 사용 {c.redeemedCount}
                      {c.maxRedemptions === null
                        ? ""
                        : ` / ${c.maxRedemptions}`}
                      {c.validUntil ? ` · 유효 ${fmt(c.validUntil)}까지` : ""}
                    </span>
                  </div>
                  {onUpdateCode ? (
                    <div className="flex items-center gap-2">
                      <Input
                        className="w-20"
                        defaultValue={String(c.grantDays)}
                        id={`days-${c.id}`}
                        inputMode="numeric"
                      />
                      <Button
                        disabled={busy === c.id}
                        onClick={() => {
                          const el = document.getElementById(
                            `days-${c.id}`
                          ) as HTMLInputElement | null;
                          run(c.id, () =>
                            onUpdateCode({
                              id: c.id,
                              grantDays: Number(el?.value) || c.grantDays,
                              maxRedemptions: c.maxRedemptions,
                            })
                          );
                        }}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        기간 저장
                      </Button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ── 가입 조직 ────────────────────────────────── */}
      <section className="flex flex-col gap-3">
        <h2 className="flex items-baseline gap-2 font-semibold text-[color:var(--findable-ink,#f7f8f8)] text-lg">
          가입 조직
          <span className="text-[color:var(--findable-ink-tertiary,#7e8289)] text-sm tabular-nums">
            {orgs.length}
          </span>
        </h2>
        {orgs.length === 0 ? (
          <p className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm">
            아직 가입한 조직이 없어요.
          </p>
        ) : (
          <div className="overflow-x-auto">
            {/* 🔴 **칸 사이 가로 여백은 표에 한 번만 준다** (N-47 · 라이브 스크린샷이 잡음).
                셀이 전부 `py-*` 뿐이라 가로 padding 이 **0** 이었다. 그래서 오른쪽정렬 「측정」과
                왼쪽정렬 「가입」이 맞닿아 `0` + `2026. 8. 19.` 가 **「02026. 8. 19.」** 로 읽혔다
                (실제 값은 둘 다 맞다 — **붙어 있는 것**이 틀렸다). 「422026」·「3402026」도 같은 칸.
                ⚠️ 셀마다 `px-*` 를 덧붙이면 새 칸이 생길 때마다 또 빠뜨린다.
                → `border-separate` + `border-spacing-x` 로 **표 차원에서** 보장한다
                (`border-spacing-y-0` 이라 행 높이는 그대로, 행 구분선도 그대로다). */}
            <table className="w-full min-w-[900px] border-separate border-spacing-x-4 border-spacing-y-0 text-sm">
              <thead>
                <tr className="text-left text-[color:var(--findable-ink-subtle,#8a8f98)] text-xs">
                  <th className="py-2">조직</th>
                  <th className="py-2">플랜</th>
                  <th className="py-2">만료</th>
                  <th className="py-2 text-right">브랜드</th>
                  <th className="py-2 text-right">측정</th>
                  <th className="py-2">준비도</th>
                  <th className="py-2">가입</th>
                  <th className="py-2 text-right">컨설팅</th>
                  <th className="py-2 text-right">기간</th>
                </tr>
              </thead>
              <tbody>
                {orgs.map((o) => {
                  const left = daysLeft(o.planExpiresAt);
                  const open = openOrgId === o.id;
                  return (
                    <Fragment key={o.id}>
                      <tr className="border-[color:var(--findable-hairline,#23252a)] border-t">
                        <td className="py-2.5 text-[color:var(--findable-ink,#f7f8f8)]">
                          {/* 🔴 조직명 자체가 펼치기 버튼 — 「브랜드 7」이 보이는데
                           **어떤 브랜드인지** 볼 방법이 없던 것이 이 화면의 결함이었다. */}
                          {onLoadDetail ? (
                            <button
                              aria-expanded={open}
                              className="flex items-center gap-1.5 text-left hover:text-[color:var(--findable-primary,#ff7a4d)]"
                              disabled={loadingDetail === o.id}
                              onClick={() => toggleDetail(o.id)}
                              type="button"
                            >
                              {open ? (
                                <ChevronDownIcon className="size-3.5 shrink-0" />
                              ) : (
                                <ChevronRightIcon className="size-3.5 shrink-0" />
                              )}
                              {o.name}
                              {loadingDetail === o.id ? (
                                <span className="text-[color:var(--findable-ink-tertiary,#7e8289)] text-xs">
                                  여는 중…
                                </span>
                              ) : null}
                            </button>
                          ) : (
                            o.name
                          )}
                        </td>
                        <td className="py-2.5">
                          <Badge variant="outline">{o.plan}</Badge>
                        </td>
                        <td className="py-2.5 text-[color:var(--findable-ink-subtle,#8a8f98)]">
                          {left === null ? (
                            "—"
                          ) : (
                            <span
                              className={
                                left <= 3
                                  ? "text-[color:var(--signal-bad,#f87171)]"
                                  : undefined
                              }
                            >
                              {fmt(o.planExpiresAt)} ({left}일)
                            </span>
                          )}
                        </td>
                        {/* 🔴 측정 0 = "가입만 하고 안 쓰는 곳". 온보딩이 필요한 신호다. */}
                        <td className="py-2.5 text-right tabular-nums">
                          {o.brandCount}
                        </td>
                        <td className="py-2.5 text-right tabular-nums">
                          {o.trackingCount}
                        </td>
                        <td className="py-2.5">
                          <ReadinessCell
                            brandCount={o.brandCount}
                            busy={busy === `readiness-${o.id}`}
                            missingCount={o.readinessMissingCount}
                            onBackfill={
                              onBackfillReadiness
                                ? () =>
                                    run(`readiness-${o.id}`, () =>
                                      onBackfillReadiness(o.id)
                                    )
                                : undefined
                            }
                          />
                        </td>
                        <td className="py-2.5 text-[color:var(--findable-ink-subtle,#8a8f98)]">
                          {fmt(o.createdAt)}
                        </td>
                        <td className="py-2.5 text-right">
                          <Button
                            onClick={() => router.push(`/admin/orgs/${o.id}`)}
                            size="sm"
                            type="button"
                            variant="outline"
                          >
                            실측 데이터
                          </Button>
                        </td>
                        <td className="py-2.5 text-right">
                          {onSetDays ? (
                            <span className="flex justify-end gap-1">
                              <Button
                                disabled={busy === o.id}
                                onClick={() =>
                                  run(o.id, () =>
                                    onSetDays({ orgId: o.id, days: 30 })
                                  )
                                }
                                size="sm"
                                type="button"
                                variant="outline"
                              >
                                +30일
                              </Button>
                              <Button
                                disabled={busy === o.id}
                                onClick={() =>
                                  run(o.id, () =>
                                    onSetDays({ orgId: o.id, days: 0 })
                                  )
                                }
                                size="sm"
                                type="button"
                                variant="ghost"
                              >
                                회수
                              </Button>
                            </span>
                          ) : null}
                        </td>
                      </tr>
                      {open && details[o.id] ? (
                        <tr key={`${o.id}-detail`}>
                          {/* colSpan 은 위 헤더 열 수(9)와 같아야 표가 어긋나지 않는다. */}
                          <td className="p-0" colSpan={9}>
                            <OrgDetailPanel detail={details[o.id]} />
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};
