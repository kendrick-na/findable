import { isAdmin } from "@repo/auth/admin";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { listBrandsForAdmin } from "@/app/actions/admin/measure";
import { Header } from "../../components/header";
import { MeasureConsole } from "./measure-console";

export const metadata: Metadata = {
  title: "측정 콘솔",
  description: "브랜드 1건 측정 · 수정 · 삭제 (관리자 전용)",
};

// 이 화면 자체는 조회만 한다(0원). 측정은 서버액션이 하고 상한은 그쪽 maxDuration.
export const dynamic = "force-dynamic";

/**
 * 관리자 측정 콘솔 — 2026-08-17 세션N-37.
 *
 * 🔴 **왜 만들었나**: 무인 측정 경로가 cron 하나뿐이라 **한 번에 5건(435원)** 이 나갔다.
 *   1건(87원)만 돌릴 방법이 없어서 N-36 의 Tracking 유실 수정을 확인하지 못하고 있었다.
 *
 * 이 화면이 답하는 질문:
 *   ① 지금 어느 브랜드가 시계열이 비어 있나 (`Tracking 0` 이 한눈에)
 *   ② 1건 재보면 실제로 쌓이나 (측정 전후 행수를 **같은 줄에서** 보여준다)
 */
export default async function AdminMeasurePage() {
  if (!(await isAdmin())) {
    notFound();
  }

  const brands = await listBrandsForAdmin();

  return (
    <>
      <Header page="측정 콘솔" pages={["관리자"]} />
      <div className="flex flex-col gap-6 px-4 py-6 md:px-6">
        <div className="flex flex-col gap-1">
          <h1 className="font-semibold text-2xl tracking-tight">측정 콘솔</h1>
          <p className="text-muted-foreground text-sm">
            브랜드 하나를 골라 측정을 다시 돌려요. 1건에 약 87원이 들고 3~5분
            걸려요.
          </p>
        </div>
        <MeasureConsole brands={brands} />
      </div>
    </>
  );
}
