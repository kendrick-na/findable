/**
 * 엑스포 매출 대조 실행 — 매출이 나온 회사가 「엑스포에 나온 그 회사」가 맞는지 확인한다.
 *
 * 사용(읽기 전용, 결과는 표·JSON 파일로만):
 *   OPENDART_API_KEY 는 환경변수로만 준다(값은 출력하지 않는다)
 *   DATA_GO_KR_SERVICE_KEY 가 있으면 국세청 사업자 상태도 함께 확인한다(없으면 건너뜀).
 *   bun --preload ./scripts/bun-server-only-shim.mjs scripts/expo-identity-run.ts \
 *       <companies.json> <revenue-checkpoint.json> <out.md> [<regions.json>]
 *
 * 근거 등급(company-identity.ts): confirmed(홈페이지 사업자번호 = DART) · probable · name_only · mismatch.
 * 매출 숫자를 영업 문서에 쓰는 것은 confirmed 뿐이다. 홈페이지는 회사당 한 쪽만, 2초 간격으로 읽는다.
 * 사업자번호는 저장·표시 모두 끝 4자리만(일치 여부만 필요하다).
 */
import { readFile, writeFile } from "node:fs/promises";
import {
  extractBizNumbers,
  judgeIdentity,
  revenueAllowed,
} from "@/lib/ax-mail/sources/company-identity";
import { readHomepageText } from "@/lib/ax-mail/sources/contact-email";
import { fetchDart } from "@/lib/ax-mail/sources/opendart";
import type { Checkpoint } from "./expo-revenue-lookup";
import { stripInstitutionTag } from "./expo-revenue-run";

const PAUSE_MS = 2000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const tail4 = (v: string | null | undefined) => (v ? `***${v.slice(-4)}` : "-");

function hostOf(homepage: string | null | undefined): string | null {
  if (!homepage) {
    return null;
  }
  try {
    return new URL(
      homepage.startsWith("http") ? homepage : `https://${homepage}`
    ).hostname;
  } catch {
    return null;
  }
}

interface ExpoCompany {
  booth: string;
  name: string;
}

/** 매출이 나온 회사 한 곳을 DART·홈페이지로 대조해 표의 한 줄(markdown)로 돌려준다. 대상이 아니면 null. */
async function checkOne(
  company: ExpoCompany,
  record: Checkpoint["done"][string] | undefined,
  regions: Record<string, string>,
  today: string
): Promise<{ allowed: boolean; row: string } | null> {
  if (record?.status !== "found") {
    return null;
  }
  const dart = await fetchDart({ name: stripInstitutionTag(company.name) });
  if (!dart?.company) {
    return null;
  }
  const host = hostOf(dart.company.homepage);
  // 첫 쪽에 없으면 회사소개·정책 쪽까지(최대 4쪽). 번호를 찾으면 거기서 멈춘다.
  const page = host
    ? await readHomepageText(host, {
        maxPages: 4,
        stopWhen: (text) => extractBizNumbers(text).length > 0,
      })
    : null;
  const homepageBizNos =
    page?.status === "ok" ? extractBizNumbers(page.text) : [];
  const verdict = judgeIdentity({
    dart: {
      address: dart.company.address,
      bizNo: dart.company.bizNo,
      name: dart.company.name,
    },
    expoName: stripInstitutionTag(company.name),
    expoRegion: regions[`${company.booth}|${company.name}`] ?? null,
    homepageBizNos,
  });
  const source = record.basis === "audit_report" ? "감사보고서" : "사업보고서";
  const homepage = host
    ? `${host}${page ? ` (${page.status}, ${page.pagesRead}쪽)` : ""}`
    : "홈페이지 정보 없음";
  const read = homepageBizNos.length
    ? homepageBizNos.map(tail4).join(", ")
    : "-";
  return {
    allowed: revenueAllowed(verdict.level),
    row: `| ${company.booth} | ${company.name} | ${record.amount?.toLocaleString("ko-KR")}원 (${record.fiscalYear}, ${source}) | ${verdict.level} | ${verdict.reasons.join(", ")} | ${homepage} | ${tail4(dart.company.bizNo)} | ${read} | ${today} |`,
  };
}

async function main(): Promise<void> {
  const [companiesPath, checkpointPath, outPath, regionsPath] =
    process.argv.slice(2);
  if (!(companiesPath && checkpointPath && outPath)) {
    console.error(
      "usage: expo-identity-run <companies.json> <revenue-checkpoint.json> <out.md> [regions.json]"
    );
    process.exit(2);
  }
  if (!process.env.OPENDART_API_KEY) {
    console.error("OPENDART_API_KEY 가 없습니다(값은 출력하지 않습니다).");
    process.exit(3);
  }
  const companies = JSON.parse(
    await readFile(companiesPath, "utf8")
  ) as ExpoCompany[];
  const checkpoint = JSON.parse(
    await readFile(checkpointPath, "utf8")
  ) as Checkpoint;
  const regions = regionsPath
    ? (JSON.parse(await readFile(regionsPath, "utf8")) as Record<
        string,
        string
      >)
    : {};
  const rows: string[] = [
    "| 부스 | 업체 | 매출 | 동일성 | 근거 | 홈페이지 | DART 사업자번호 | 홈페이지 번호 | 조회일 |",
    "|---|---|---|---|---|---|---|---|---|",
  ];
  const today = new Date().toISOString().slice(0, 10);
  let confirmed = 0;
  for (const company of companies) {
    const record =
      checkpoint.done[`${company.booth}|${company.name}`] ??
      checkpoint.done[company.name];
    const one = await checkOne(company, record, regions, today);
    if (one) {
      rows.push(one.row);
      confirmed += one.allowed ? 1 : 0;
      await sleep(PAUSE_MS);
    }
  }
  await writeFile(outPath, `${rows.join("\n")}\n`, "utf8");
  console.log(`rows=${rows.length - 2} confirmed=${confirmed}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "unexpected error");
  process.exit(1);
});
