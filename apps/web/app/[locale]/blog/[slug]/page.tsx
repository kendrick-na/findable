import { database } from "@repo/database";
import { notFound, permanentRedirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function LegacyBlogPostRedirect({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  const post = await database.content.findFirst({
    where: { locale, slug, status: "published", noindex: false },
    select: { slug: true, publisher: { select: { slug: true } } },
  });
  if (!post) notFound();
  const prefix = locale.startsWith("ko") ? "/ko" : "";
  permanentRedirect(`${prefix}/p/${post.publisher.slug}/${post.slug}`);
}
