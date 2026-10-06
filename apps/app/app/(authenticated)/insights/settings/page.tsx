import { auth } from "@repo/auth/server";
import { database } from "@repo/database";
import { Globe2Icon, MailIcon } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  savePublisherSettings,
  verifyPublisherDomain,
} from "@/app/actions/content/settings";
import { getAppDictionary } from "@/lib/i18n";
import { Header } from "../../components/header";

export default async function PublishingSettingsPage() {
  const { orgId } = await auth();
  if (!orgId) {
    redirect("/sign-in");
  }
  const t = (await getAppDictionary()).contentSettings;
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
      <Header page={t.headerTitle} pages={["Findable", t.headerParent]} />
      <main className="flex flex-1 flex-col gap-6 p-6 pt-2">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="font-semibold text-2xl">{t.title}</h1>
            <p className="mt-2 text-sm text-white/55">{t.lede}</p>
          </div>
          <Link
            className="text-[color:var(--findable-primary,#ff7a4d)] text-sm"
            href="/insights"
          >
            {t.back}
          </Link>
        </div>
        {publishers.length === 0 ? (
          <div className="findable-card p-6 text-sm text-white/55">
            {t.empty}
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
                    <Globe2Icon className="size-4" /> {t.customDomain}
                  </span>
                  <input
                    className="h-10 rounded-md border border-white/10 bg-black/20 px-3"
                    defaultValue={publisher.customDomain ?? ""}
                    name="customDomain"
                    placeholder="insights.customer.com"
                  />
                  <span className="text-white/40 text-xs">
                    {t.status.replace("{status}", publisher.customDomainStatus)}
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
                      <MailIcon className="size-4" /> {t.newsletter}
                    </span>
                    <span className="mt-2 block text-white/45 text-xs">
                      {t.subscribers.replace(
                        "{n}",
                        String(publisher._count.newsletterSubscriptions)
                      )}
                    </span>
                  </span>
                </label>
                <button
                  className="findable-btn-primary h-10 rounded-md px-4 text-sm lg:col-span-2"
                  type="submit"
                >
                  {t.save}
                </button>
              </form>
              {publisher.customDomain &&
              publisher.customDomainVerificationToken ? (
                <div className="grid gap-3 rounded-lg border border-white/10 bg-black/15 p-4 text-sm">
                  <p className="font-medium">{t.dnsTitle}</p>
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
                      {t.verify}
                    </button>
                  </form>
                  {publisher.customDomainStatus === "verified" ? (
                    <p className="text-amber-300">{t.verified}</p>
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
