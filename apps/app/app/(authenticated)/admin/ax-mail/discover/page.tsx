import { isAdmin } from "@repo/auth/admin";
import { auth } from "@repo/auth/server";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getAppDictionary } from "@/lib/i18n";
import { Header } from "../../../components/header";
import { DiscoverScreen } from "./discover-screen";

export const metadata: Metadata = { title: "회사 찾기" };
export const dynamic = "force-dynamic";
// 「데이터 불러오기」 서버액션이 원천 5곳을 차례로 부른다(원천당 15초 제한).
export const maxDuration = 120;

/**
 * 관리자 「회사 찾기」 — 대표 승인 화면 설계(2026-10-07).
 *   위: 저장한 조건(세그먼트) 칩 + 새 조건 / 칩 줄(업종·태그·지역·규모·성장·사이트·메일) + 결과 수
 *   왼쪽: 회사 표(선택·정렬·쪽) / 오른쪽: 회사 카드(출처·기준일·공개 메일·측정·리포트·메일 초안)
 *   아래: 영업 파이프라인 칸(누르면 표가 그 단계로 걸러진다)
 *
 * 🔒 관리자만(notFound). 🔒 SALES_DISCOVERY_ENABLED 꺼짐 → 안내만. 🔒 테이블 없음(P2021) → 「DB 준비 전」.
 */
export default async function DiscoverPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { orgId, userId } = await auth();
  if (!(orgId && userId && (await isAdmin()))) {
    notFound();
  }
  const [t, raw] = await Promise.all([getAppDictionary(), searchParams]);
  return (
    <>
      <Header page={t.salesDiscover.title} pages={[t.salesDiscover.crumb]} />
      <DiscoverScreen orgId={orgId} raw={raw} userId={userId} />
    </>
  );
}
