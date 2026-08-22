import { auth } from "@repo/auth/server";
import { database } from "@repo/database";
import { Globe2Icon, MailIcon } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  savePublisherSettings,
  verifyPublisherDomain,
} from "@/app/actions/content/settings";
import { Header } from "../../components/header";

export default async function PublishingSettingsPage() {
  const { orgId } = await auth();
  if (!orgId) {
    redirect("/sign-in");
  }
  const publishers = await database.publisher.findMany({
    where: { brand: { organizationId: orgId } },
    include: {
      brand: true,
      _count: {
        select: { newsletterSubscriptions: { where: { status: "active" } } },
      },
    },
  });
  return (
    <>
      <Header page="퍼블리싱 설정" pages={["Findable", "콘텐츠"]} />
      <main className="flex flex-1 flex-col gap-6 p-6 pt-2">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="font-semibold text-2xl">채널 설정</h1>
            <p className="mt-2 text-sm text-white/55">
              브랜드별 뉴스레터와 고객 전용 도메인을 관리합니다.
            </p>
          </div>
          <Link
            className="text-[color:var(--findable-primary,#ff7a4d)] text-sm"
            href="/insights"
          >
            콘텐츠로 돌아가기
          </Link>
        </div>
        {publishers.length === 0 ? (
          <div className="findable-card p-6 text-sm text-white/55">
            먼저 브랜드를 만들고 콘텐츠 초안을 생성해 주세요.
          </div>
        ) : (
          publishers.map((publisher) => (
            <section
              className="findable-card grid gap-6 p-6"
              key={publisher.id}
            >
              <div>
                <p className="text-white/40 text-xs">
                  {publisher.brand?.domain}
                </p>
                <h2 className="mt-1 font-semibold text-xl">{publisher.name}</h2>
              </div>
              <form
                action={savePublisherSettings}
                className="grid gap-5 lg:grid-cols-2"
              >
                <input name="publisherId" type="hidden" value={publisher.id} />
                <label className="grid gap-2 text-sm">
                  <span className="flex items-center gap-2">
                    <Globe2Icon className="size-4" /> 고객 전용 도메인
                  </span>
                  <input
                    className="h-10 rounded-md border border-white/10 bg-black/20 px-3"
                    defaultValue={publisher.customDomain ?? ""}
                    name="customDomain"
                    placeholder="insights.customer.com"
                  />
                  <span className="text-white/40 text-xs">
                    상태: {publisher.customDomainStatus}
                  </span>
                </label>
                <label className="flex items-start gap-3 rounded-lg border border-white/10 p-4 text-sm">
                  <input
                    defaultChecked={publisher.newsletterEnabled}
                    name="newsletterEnabled"
                    type="checkbox"
                  />
                  <span>
                    <span className="flex items-center gap-2 font-medium">
                      <MailIcon className="size-4" /> 뉴스레터 사용
                    </span>
                    <span className="mt-2 block text-white/45 text-xs">
                      확인된 구독자 {publisher._count.newsletterSubscriptions}명
                    </span>
                  </span>
                </label>
                <button
                  className="findable-btn-primary h-10 rounded-md px-4 text-sm lg:col-span-2"
                  type="submit"
                >
                  설정 저장
                </button>
              </form>
              {publisher.customDomain &&
              publisher.customDomainVerificationToken ? (
                <div className="grid gap-3 rounded-lg border border-white/10 bg-black/15 p-4 text-sm">
                  <p className="font-medium">
                    DNS에 아래 두 레코드를 추가하세요.
                  </p>
                  <code>
                    TXT _findable.{publisher.customDomain} →{" "}
                    {publisher.customDomainVerificationToken}
                  </code>
                  <code>
                    {publisher.customDomain.split(".").length > 2
                      ? `CNAME ${publisher.customDomain} → cname.vercel-dns.com`
                      : `A ${publisher.customDomain} → 76.76.21.21`}
                  </code>
                  <form action={verifyPublisherDomain}>
                    <input
                      name="publisherId"
                      type="hidden"
                      value={publisher.id}
                    />
                    <button
                      className="rounded-md border border-white/15 px-4 py-2"
                      type="submit"
                    >
                      DNS 확인 및 연결
                    </button>
                  </form>
                  {publisher.customDomainStatus === "verified" ? (
                    <p className="text-amber-300">
                      소유권은 확인됐습니다. 운영자가 Vercel 연결 키를 설정하면
                      HTTPS가 활성화됩니다.
                    </p>
                  ) : null}
                </div>
              ) : null}
            </section>
          ))
        )}
      </main>
    </>
  );
}
