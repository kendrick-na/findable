"use client";

import { Badge } from "@repo/design-system/components/ui/badge";
import { Button } from "@repo/design-system/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@repo/design-system/components/ui/dialog";
import { Input } from "@repo/design-system/components/ui/input";
import { Label } from "@repo/design-system/components/ui/label";
import { toast } from "@repo/design-system/components/ui/sonner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/design-system/components/ui/table";
import { useState, useTransition } from "react";
import {
  deleteBrand,
  pollMeasureOne,
  previewBrandDeletion,
  runMeasureOne,
  updateBrand,
} from "@/app/actions/admin/measure";

/** 측정 1건 원가(실측 평균, `reference_findable_traps` §8). 화면에 그대로 고지한다. */
const COST_KRW = 87;

interface BrandRow {
  domain: string;
  id: string;
  lastMeasuredAt: Date | null;
  lastStatus: string | null;
  name: string;
  organizationId: string | null;
  promptCount: number;
  trackingRows: number;
}

interface MeasureResult {
  brandName: string;
  jobId: string;
  status: string;
  trackingAfter: number;
  trackingBefore: number;
  trackingDelta: number;
}

const fmtDate = (d: Date | null) =>
  d
    ? new Intl.DateTimeFormat("ko-KR", {
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        month: "short",
      }).format(new Date(d))
    : "측정 없음";

/**
 * 시계열이 비었는지 한눈에. **0 은 경고색**이다 — 이 화면이 존재하는 이유가
 * 「Prompt 0 → Tracking 0」 브랜드를 찾는 것이기 때문이다(N-36 실측).
 */
const CountBadge = ({ n, zeroWarns }: { n: number; zeroWarns?: boolean }) => {
  if (n === 0 && zeroWarns) {
    return <Badge variant="destructive">0</Badge>;
  }
  return <Badge variant="secondary">{n}</Badge>;
};

export const MeasureConsole = ({ brands }: { brands: BrandRow[] }) => {
  const [pending, startTransition] = useTransition();
  const [runningId, setRunningId] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, MeasureResult>>({});

  // 삭제 확인 다이얼로그 — 이름을 직접 타이핑해야 열린다.
  const [target, setTarget] = useState<BrandRow | null>(null);
  const [confirmName, setConfirmName] = useState("");
  const [doomed, setDoomed] = useState<{
    auditJobs: number;
    prompts: number;
    trackingRows: number;
  } | null>(null);

  // 수정 다이얼로그
  const [editing, setEditing] = useState<BrandRow | null>(null);
  const [editName, setEditName] = useState("");
  const [editDomain, setEditDomain] = useState("");

  const onMeasure = (brand: BrandRow) => {
    if (
      // 실비가 나가는 액션이라 **되돌릴 수 없는 지출** 앞에 확인을 받는다.
      //   운영자 전용 콘솔(`/admin`)이고 하루 몇 번 쓰는 화면이라, 커스텀 모달을
      //   새로 만드는 것보다 브라우저 기본 확인창이 오히려 확실하다.
      // biome-ignore lint/suspicious/noAlert: 위 주석 참고
      !window.confirm(
        `「${brand.name}」 측정을 1건 돌릴까요?\n\n약 ${COST_KRW}원이 들고 3~5분 걸려요.`
      )
    ) {
      return;
    }
    setRunningId(brand.id);
    startTransition(async () => {
      const res = await runMeasureOne(brand.id);
      if (!res.ok) {
        setRunningId(null);
        toast.error(`측정 실패 — ${res.error}`);
        return;
      }
      if (res.started.skipped === "already_running") {
        setRunningId(null);
        toast.info("이미 측정이 돌고 있어요. 끝난 뒤 다시 눌러주세요.");
        return;
      }
      toast.info("측정을 시작했어요. 3~5분 걸려요.");
      // 🔴 측정은 최대 298초라 **기다리지 않고 걸어둔 뒤 따라간다**
      //   (동기로 붙들면 300초 상한에 죽는다 — 2026-08-17 실측).
      pollUntilDone(brand, res.started.jobId, res.started.trackingBefore);
    });
  };

  /** 끝날 때까지 8초마다 확인한다. 상한 6분(측정 최대 298초 + 여유). */
  const pollUntilDone = (
    brand: BrandRow,
    jobId: string,
    trackingBefore: number
  ) => {
    const deadline = Date.now() + 6 * 60 * 1000;
    const tick = async () => {
      const state = await pollMeasureOne(jobId, trackingBefore);
      if (!state.done) {
        if (Date.now() > deadline) {
          setRunningId(null);
          toast.error("6분이 지나도 안 끝났어요. 로그를 확인해주세요.");
          return;
        }
        setTimeout(tick, 8000);
        return;
      }
      setRunningId(null);
      setResults((prev) => ({
        ...prev,
        [brand.id]: {
          brandName: brand.name,
          jobId,
          status: state.status,
          trackingAfter: state.trackingNow,
          trackingBefore,
          trackingDelta: state.trackingDelta,
        },
      }));
      if (state.status === "failed") {
        toast.error("측정이 실패로 끝났어요.");
        return;
      }
      if (state.trackingDelta === 0) {
        // 🔴 이게 이 도구의 핵심 신호다 — 조용히 지나가면 안 된다.
        toast.error(
          `측정은 끝났는데 시계열이 하나도 안 쌓였어요 (${trackingBefore}행 그대로). 적재가 막힌 거예요.`
        );
        return;
      }
      toast.success(
        `시계열 ${trackingBefore} → ${state.trackingNow}행 (+${state.trackingDelta})`
      );
    };
    setTimeout(tick, 8000);
  };

  const openDelete = (brand: BrandRow) => {
    setTarget(brand);
    setConfirmName("");
    setDoomed(null);
    startTransition(async () => {
      const preview = await previewBrandDeletion(brand.id);
      if (preview) {
        setDoomed({
          auditJobs: preview.auditJobs,
          prompts: preview.prompts,
          trackingRows: preview.trackingRows,
        });
      }
    });
  };

  const onDelete = () => {
    if (!target) {
      return;
    }
    startTransition(async () => {
      const res = await deleteBrand(target.id, confirmName);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`「${target.name}」 을 지웠어요.`);
      setTarget(null);
    });
  };

  const openEdit = (brand: BrandRow) => {
    setEditing(brand);
    setEditName(brand.name);
    setEditDomain(brand.domain);
  };

  const onEdit = () => {
    if (!editing) {
      return;
    }
    startTransition(async () => {
      const res = await updateBrand(editing.id, {
        domain: editDomain,
        name: editName,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("고쳤어요.");
      setEditing(null);
    });
  };

  return (
    <>
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>브랜드</TableHead>
              <TableHead className="text-right">질문</TableHead>
              <TableHead className="text-right">시계열</TableHead>
              <TableHead>마지막 측정</TableHead>
              <TableHead className="text-right">할 일</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {brands.map((brand) => {
              const result = results[brand.id];
              const isRunning = runningId === brand.id;
              return (
                <TableRow key={brand.id}>
                  <TableCell>
                    <div className="font-medium">{brand.name}</div>
                    <div className="text-muted-foreground text-xs">
                      {brand.domain}
                    </div>
                    {result ? (
                      <div className="mt-1 text-xs">
                        {result.trackingDelta > 0 ? (
                          <span className="text-emerald-600 dark:text-emerald-400">
                            방금 {result.trackingBefore} →{" "}
                            {result.trackingAfter}행 (+{result.trackingDelta})
                          </span>
                        ) : (
                          <span className="text-destructive">
                            방금 측정했는데 시계열이 안 쌓였어요 (
                            {result.trackingBefore}행 그대로)
                          </span>
                        )}
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right">
                    <CountBadge n={brand.promptCount} zeroWarns />
                  </TableCell>
                  <TableCell className="text-right">
                    <CountBadge n={brand.trackingRows} zeroWarns />
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {fmtDate(brand.lastMeasuredAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        disabled={pending}
                        onClick={() => onMeasure(brand)}
                        size="sm"
                      >
                        {isRunning ? "측정 중…" : "측정"}
                      </Button>
                      <Button
                        disabled={pending}
                        onClick={() => openEdit(brand)}
                        size="sm"
                        variant="outline"
                      >
                        수정
                      </Button>
                      <Button
                        disabled={pending}
                        onClick={() => openDelete(brand)}
                        size="sm"
                        variant="ghost"
                      >
                        삭제
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <p className="text-muted-foreground text-xs">
        측정 1건에 약 {COST_KRW}원이 들어요. 「질문」이나 「시계열」이 빨간
        0이면 그 브랜드는 추세를 그릴 수 없는 상태예요.
      </p>

      {/* 수정 */}
      <Dialog onOpenChange={(o) => !o && setEditing(null)} open={!!editing}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>브랜드 고치기</DialogTitle>
            <DialogDescription>
              이름과 도메인을 바꿔요. 측정 이력은 그대로 남아요.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-name">이름</Label>
              <Input
                id="edit-name"
                onChange={(e) => setEditName(e.target.value)}
                value={editName}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-domain">도메인</Label>
              <Input
                id="edit-domain"
                onChange={(e) => setEditDomain(e.target.value)}
                value={editDomain}
              />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => setEditing(null)} variant="outline">
              그만두기
            </Button>
            <Button disabled={pending} onClick={onEdit}>
              고치기
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 삭제 — 이름을 직접 입력해야 실행된다 */}
      <Dialog onOpenChange={(o) => !o && setTarget(null)} open={!!target}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>「{target?.name}」 을 지울까요?</DialogTitle>
            <DialogDescription>
              되돌릴 수 없어요. 아래 것들이 같이 사라져요.
            </DialogDescription>
          </DialogHeader>
          {doomed ? (
            <ul className="flex flex-col gap-1 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
              <li>시계열 {doomed.trackingRows}행 — 같이 삭제</li>
              <li>추적 질문 {doomed.prompts}개 — 같이 삭제</li>
              <li>
                측정 이력 {doomed.auditJobs}건 — 남지만 이 브랜드와 연결이
                끊겨요
              </li>
            </ul>
          ) : (
            <p className="text-muted-foreground text-sm">세는 중…</p>
          )}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="confirm-name">
              지우려면 「{target?.name}」 을 그대로 입력하세요
            </Label>
            <Input
              autoComplete="off"
              id="confirm-name"
              onChange={(e) => setConfirmName(e.target.value)}
              placeholder={target?.name}
              value={confirmName}
            />
          </div>
          <DialogFooter>
            <Button onClick={() => setTarget(null)} variant="outline">
              그만두기
            </Button>
            <Button
              disabled={pending || confirmName.trim() !== target?.name}
              onClick={onDelete}
              variant="destructive"
            >
              영구 삭제
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
