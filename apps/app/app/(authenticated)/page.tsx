import { auth } from "@repo/auth/server";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Header } from "./components/header";

const title = "Findable Dashboard";
const description = "Your AI brand visibility hub.";

export const metadata: Metadata = {
  title,
  description,
};

const App = async () => {
  const { orgId } = await auth();

  if (!orgId) {
    notFound();
  }

  return (
    <>
      <Header page="Dashboard" pages={["Findable"]} />
      <div className="flex flex-1 flex-col gap-4 p-6 pt-2">
        <h1 className="font-semibold text-2xl tracking-tight">
          Findable에 오신 것을 환영합니다.
        </h1>
        <p className="text-muted-foreground">
          AI 답변 속 브랜드 가시성을 추적·최적화하는 한국 최초 Agentic GEO
          플랫폼입니다. 베타 v1.0 — 무료 Audit으로 시작하세요.
        </p>
        <a
          href="/audit"
          className="inline-flex w-fit items-center rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground text-sm hover:bg-primary/90"
        >
          무료 Audit 시작하기
        </a>
      </div>
    </>
  );
};

export default App;
