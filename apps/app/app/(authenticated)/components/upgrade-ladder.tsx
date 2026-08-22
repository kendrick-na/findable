import type { Plan } from "@repo/auth/plan";
import { BarChart3Icon, BellIcon, FileDownIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

interface UpgradeLadderProps {
  plan: Plan;
}

interface LadderItem {
  desc: string;
  icon: ReactNode;
  // 🔴 S6-c#2(2026-08-11) — 아직 없는 기능은 **배지로** 구분한다. 예전에는 "(준비 중)"이
  //   설명문 **끝에 묻혀** 있어서 카드가 다른 두 개(실제 작동)와 똑같이 읽혔다.
  //   여기는 **돈 내기 전 화면**이라 표시 정직성이 특히 중요하다(설계 v3 원인②).
  ready?: boolean;
  title: string;
}

// Growth에서 열리는 가치. 강매가 아니라 "무엇이 더 열리는지" 노출.
const ITEMS: LadderItem[] = [
  {
    icon: <BarChart3Icon className="size-5" />,
    title: "경쟁사 비교",
    desc: "우리와 경쟁사를 나란히 놓고 누가 더 많이 등장하는지 보여드려요.",
  },
  {
    icon: <BellIcon className="size-5" />,
    title: "자동 추적",
    // 🔴 S2'(2026-08-11 세션N-19) — **"이메일로 보내드려요" 를 지웠다. 거짓 판매였다.**
    //   🔬실측: 메일 발송은 `FINDABLE_ENABLE_DIGEST_EMAIL` 로 잠겨 있고
    //   프로덕션 env(`findable` 50개 키)에 **그 키가 없다** = 꺼짐 → **메일이 안 나간다**.
    //   `alerts` 화면과 요금제 2곳은 같은 이유로 이미 정직하게 고쳐졌는데
    //   **이 카드만 누락**돼 돈 내기 전 화면에서 없는 기능을 팔고 있었다(설계 v3 원인②).
    //   ⚠️ 자동 **재측정**은 실제로 돈다(cron·`autoRefreshHours`) — 그것만 말한다.
    //   🔴 메일을 실제로 켜면(=env 추가) 그때 "이메일로 알려드려요"를 되살릴 것.
    desc: "매주 자동으로 다시 측정해서 달라진 점을 이력에 쌓아드려요.",
  },
  {
    icon: <FileDownIcon className="size-5" />,
    // 🔴 S7-2차(2026-08-11) — `Export` 는 영어이고, 사이드바는 같은 것을
    //   **「데이터 내보내기」** 라 부른다(NN/g 4 일관성 + 한국어 화면에 영어 혼재).
    title: "리포트 내보내기",
    desc: "Notion·Google Docs로 내보내 팀·대표님과 공유해요.",
    ready: false,
  },
];

// free/starter 유저에게만 노출(page.tsx에서 !isPaid=growth미만 가드). starter는 문구를 살짝 다르게.
export const UpgradeLadder = ({ plan }: UpgradeLadderProps) => {
  const headline =
    plan === "starter"
      ? "Starter에 더해, Growth에서 이런 것들이 열립니다"
      : "Growth로 업그레이드하면 이런 것들이 열립니다";

  return (
    <section className="findable-card-accent flex flex-col gap-5 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="font-semibold text-[color:var(--findable-ink,#f7f8f8)] text-lg">
            {headline}
          </h2>
          <p className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm">
            지금은 측정 요약까지 확인할 수 있어요. 심화 분석은 Growth에서
            열립니다.
          </p>
        </div>
        <Link
          className="findable-btn-primary inline-flex items-center rounded-md px-4 py-2 font-medium text-sm"
          href="/billing"
        >
          요금제 보기
        </Link>
      </div>

      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {ITEMS.map((item) => (
          <li
            className="flex flex-col gap-2 rounded-lg border border-[color:var(--findable-hairline,#23252a)] bg-[color:var(--findable-surface-1,#0f1011)] p-4"
            key={item.title}
          >
            <span className="flex size-9 items-center justify-center rounded-lg bg-[color:var(--findable-primary,#ff7a4d)]/12 text-[color:var(--findable-primary,#ff7a4d)]">
              {item.icon}
            </span>
            <p className="flex flex-wrap items-center gap-1.5 font-medium text-[color:var(--findable-ink,#f7f8f8)]">
              {item.title}
              {item.ready === false && (
                <span className="rounded-full border border-[color:var(--findable-hairline,#23252a)] px-1.5 py-0.5 font-normal text-[color:var(--findable-ink-tertiary,#7e8289)] text-xs">
                  준비 중
                </span>
              )}
            </p>
            <p className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm">
              {item.desc}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
};
