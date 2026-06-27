import { auth } from "@repo/auth/server";
import { notFound, redirect } from "next/navigation";
import { Header } from "../components/header";

interface SearchPageProperties {
  searchParams: Promise<{
    q: string;
  }>;
}

export const generateMetadata = async ({
  searchParams,
}: SearchPageProperties) => {
  const { q } = await searchParams;

  return {
    title: `${q} - Search results`,
    description: `Search results for ${q}`,
  };
};

const SearchPage = async ({ searchParams }: SearchPageProperties) => {
  const { q } = await searchParams;
  const { orgId } = await auth();

  if (!orgId) {
    notFound();
  }

  if (!q) {
    redirect("/");
  }

  return (
    <>
      <Header page="Search" pages={["Findable"]} />
      <div className="flex flex-1 flex-col gap-4 p-6 pt-2">
        <p className="text-muted-foreground">
          검색 기능은 v1.5에서 제공됩니다. 지금은{" "}
          <a href="/audit" className="underline">
            무료 Audit
          </a>
          으로 시작해보세요.
        </p>
      </div>
    </>
  );
};

export default SearchPage;
