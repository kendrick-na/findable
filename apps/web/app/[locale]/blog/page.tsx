import { permanentRedirect } from "next/navigation";

export default async function BlogRedirect({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  permanentRedirect(locale.startsWith("ko") ? "/ko/insights" : "/insights");
}
