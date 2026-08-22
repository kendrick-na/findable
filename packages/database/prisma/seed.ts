// Engine 시드 — 20번(runner→Tracking 적재)의 선행조건.
//
// 배경(실측 2026-07-29): Engine 테이블은 프로덕션에서 비어 있다. audit runner는
//   AuditJob(Json)에만 write하고 Tracking/Engine을 만들지 않았다. Tracking.engineId는
//   NOT NULL + Engine FK(onDelete 미지정=Restrict)라, Tracking을 쓰려면 대응 Engine row가
//   반드시 선존해야 한다. 이 시드가 그 선행 데이터를 만든다.
//
// 정책(설계문서 §2 보강4):
//   - ENGINES 전량(9개, chatgpt-web·naver-briefing 포함)을 upsert한다. 나중에 베타 엔진을
//     켤 때 FK 위반 없이 바로 Tracking 적재 가능하도록.
//   - isActive는 DEFAULT_7(본류 audit이 실제 호출하는 엔진)만 true, 나머지(chatgpt-web·
//     naver-briefing)는 false. 대시보드/집계는 isActive로 본류만 노출.
//   - 멱등(upsert): 여러 번 돌려도 안전. name/provider/language/ordering/isActive를 항상 최신화.
//
// Prisma 7: PrismaClient는 driver adapter 필수(@prisma/adapter-neon). seeding은
//   `npx prisma db seed`로만 명시 실행(migrate 시 자동 실행 없음). config는 prisma.config.ts.

import { neonConfig } from "@neondatabase/serverless";
import { PrismaNeon } from "@prisma/adapter-neon";
import ws from "ws";
import { PrismaClient } from "../generated/client";

// 엔진 시드 데이터. @repo/database는 @repo/ai를 의존하지 않으므로(순환·exports 회피)
//   packages/ai/lib/engines/types.ts의 ENGINES를 이 시드가 소유 사본으로 인라인한다.
//   ⚠️ ai 쪽 ENGINES 목록(id/name/provider/language/ordering)이 바뀌면 이 배열도 맞출 것.
//   (근거: types.ts:33 ENGINES 실측 2026-07-29)
const ENGINES = [
  {
    id: "chatgpt",
    name: "ChatGPT",
    provider: "openai",
    language: "both",
    ordering: 1,
  },
  {
    id: "chatgpt-web",
    name: "ChatGPT (Web)",
    provider: "openai",
    language: "both",
    ordering: 2,
  },
  {
    id: "claude",
    name: "Claude",
    provider: "anthropic",
    language: "both",
    ordering: 3,
  },
  {
    id: "perplexity",
    name: "Perplexity",
    provider: "perplexity",
    language: "both",
    ordering: 4,
  },
  {
    id: "gemini",
    name: "Gemini",
    provider: "google",
    language: "both",
    ordering: 5,
  },
  {
    id: "hyperclova",
    name: "HyperCLOVA X",
    provider: "naver",
    language: "ko",
    ordering: 6,
  },
  {
    id: "naver",
    name: "Naver",
    provider: "naver",
    language: "ko",
    ordering: 7,
  },
  {
    id: "naver-briefing",
    name: "Naver AI 브리핑",
    provider: "naver",
    language: "ko",
    ordering: 8,
  },
  { id: "daum", name: "Daum", provider: "kakao", language: "ko", ordering: 9 },
] as const;

// 본류 audit이 실제 호출하는 7개(engines/index.ts DEFAULT_ENGINES와 동일).
// 이 목록만 isActive=true. chatgpt-web·naver-briefing은 옵션이라 false.
const ACTIVE_ENGINE_IDS = new Set<string>([
  "chatgpt",
  "claude",
  "perplexity",
  "gemini",
  "hyperclova",
  "naver",
  "daum",
]);

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }

  // seed는 로컬/CI Node 실행 → ws 폴백(index.ts는 Vercel용 fetch 모드였음).
  neonConfig.webSocketConstructor = ws;
  const adapter = new PrismaNeon({ connectionString });
  const prisma = new PrismaClient({ adapter });

  try {
    let count = 0;
    for (const e of ENGINES) {
      const isActive = ACTIVE_ENGINE_IDS.has(e.id);
      await prisma.engine.upsert({
        where: { id: e.id },
        create: {
          id: e.id,
          name: e.name,
          provider: e.provider,
          language: e.language,
          ordering: e.ordering,
          isActive,
        },
        update: {
          name: e.name,
          provider: e.provider,
          language: e.language,
          ordering: e.ordering,
          isActive,
        },
      });
      count++;
    }
    console.log(
      `[seed] Engine upsert 완료: ${count}개 (isActive=true: ${ACTIVE_ENGINE_IDS.size}개)`
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("[seed] 실패:", error);
  process.exit(1);
});
