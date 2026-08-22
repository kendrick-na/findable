import { isPaid, type Plan, planCapabilities } from "@repo/auth/plan";
import { getCurrentPlan } from "@repo/auth/plan-server";
import type { Metadata } from "next";
import Link from "next/link";
import { Header } from "../components/header";
import { LockedSurface } from "../components/locked-surface";

/**
 * 이 플랜의 자동 재측정 주기를 사람 말로. 🔴 주기를 **하드코딩하지 않는다** —
 * `planCapabilities` 가 단일 진실이고 cron 도 같은 값을 쓴다. 여기 숫자를 따로 적으면
 * 나중에 주기를 바꿀 때 화면만 옛말을 하게 된다(= 없는 기능을 파는 것과 같은 계열).
 */
const refreshLabel = (plan: Plan): string => {
  const hours = planCapabilities(plan).autoRefreshHours;
  if (hours === null) {
    return "";
  }
  if (hours >= 168) {
    return "매주";
  }
  return "매일";
};

export const metadata: Metadata = {
  title: "추적 알림 · Findable",
  description: "매주 자동으로 다시 측정하고, 달라지면 알려드려요.",
};

// 블러로 깔릴 프리뷰(잠금 유저용).
// 🔴 2026-08-10 수정 — 여기 있던 값들은 **지어낸 수치**였다:
//   "매주 월요일 09:00"(실제 cron 은 매일 02:00 에 돌며 경과분만 처리) ·
//   "5%p 이상 하락 시"(근거 없는 임계값 — 시계열 1일이라 분포 자체가 없다) ·
//   "이메일 즉시 알림"(메일은 FINDABLE_ENABLE_DIGEST_EMAIL 꺼짐).
//   → 잠금화면 가짜 숫자 제거(`4292055`)와 같은 계열이므로 **실제 동작만** 남긴다.
const AlertsPreview = () => {
  const items = [
    { label: "자동 재측정 주기", value: "Starter 주간 · Growth 매일" },
    { label: "재측정 결과", value: "측정 이력에 쌓임" },
    { label: "변화 알림 메일", value: "준비 중" },
  ];
  return (
    <div className="findable-card flex flex-col gap-3 p-6">
      <p className="font-medium text-[color:var(--findable-ink,#f7f8f8)]">
        알림 설정 (예시)
      </p>
      {items.map((item) => (
        <div
          className="flex items-center justify-between rounded-lg border border-[color:var(--findable-hairline,#23252a)] bg-[color:var(--findable-surface-1,#0f1011)] px-4 py-3"
          key={item.label}
        >
          <span className="text-[color:var(--findable-ink-muted,#d0d6e0)] text-sm">
            {item.label}
          </span>
          <span className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm">
            {item.value}
          </span>
        </div>
      ))}
    </div>
  );
};

const AlertsPage = async () => {
  const plan = await getCurrentPlan();

  return (
    <>
      <Header page="추적 알림" pages={["Findable"]} />
      <div className="flex flex-1 flex-col gap-6 p-6 pt-2">
        {isPaid(plan) ? (
          /* 🔴 2026-08-10 수정 — 이전엔 유료 결제자에게도 "준비하고 있어요"만 띄웠다.
             그런데 **자동 재측정은 이미 작동 중**이다(cron + autoRefreshHours).
             즉 돈을 낸 사람에게 "작동하는 기능"을 "준비 중"이라고 알리고 있었다.
             → 켜져 있는 것과 아직 아닌 것을 **분리해서** 말한다. */
          <div className="findable-card flex flex-col gap-4 p-8">
            <div className="flex flex-col gap-1">
              <h2 className="font-semibold text-[color:var(--findable-ink,#f7f8f8)] text-xl">
                자동 재측정이 켜져 있어요
              </h2>
              <p className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm">
                {refreshLabel(plan)} 직접 누르지 않아도 알아서 다시 측정해요.
                결과는 측정 이력에서 바로 확인할 수 있어요.
              </p>
            </div>
            <Link
              className="self-start rounded-md bg-[color:var(--findable-primary,#ff7a4d)] px-4 py-2 font-medium text-black text-sm transition-opacity hover:opacity-90"
              href="/history"
            >
              측정 이력 보기
            </Link>
            <p className="border-[color:var(--findable-hairline,#23252a)] border-t pt-4 text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm">
              <span className="text-[color:var(--findable-ink-muted,#d0d6e0)]">
                변화 알림 메일은 준비 중이에요.
              </span>{" "}
              측정이 여러 번 쌓여야 "무엇이 의미 있는 변화인지" 기준을 세울 수
              있어서, 근거가 생긴 뒤에 열겠습니다.
            </p>
          </div>
        ) : (
          /* 🔴 2026-08-11 세션N-18 — **파는 자리에만 거짓말이 남아 있었다.**
             세션N-17 이 유료 화면과 프리뷰 카드는 정직하게 고쳤는데(메일=준비 중),
             **미결제자에게 보여주는 이 잠금 화면**의 판매 문구만 못 고쳤다.
             "…나오면 이메일"은 `FINDABLE_ENABLE_DIGEST_EMAIL` 이 꺼져 있어 **안 나간다**.
             바로 옆 유료 화면이 "준비 중"이라고 말하는 것과도 모순이었다.
             ⚖️ 결제 판단에 직접 영향을 주는 문구라 표시광고 리스크가 가장 큰 자리다.
             → **실제로 켜져 있는 것만** 판다. 메일이 켜지면 그때 bullet 을 되살릴 것. */
          <LockedSurface
            bullets={[
              "브랜드마다 자동으로 다시 측정 (Starter 주간 · Growth 매일)",
              "측정할 때마다 이력에 쌓여서 점수 변화를 비교",
              "측정할 질문·브랜드 관리",
            ]}
            desc="매번 직접 측정하지 않아도, 알아서 다시 재어 드려요."
            preview={<AlertsPreview />}
            title="추적 알림"
            unlockPlan="Growth"
          />
        )}
      </div>
    </>
  );
};

export default AlertsPage;
