// 증거 한 장 → md/HTML 출력 (EV-b 화면 승인 전 대체, S2). 화면(UI)이 아니다 — 파일을 만들 뿐이다.
//   · 「화면 제공」 표현 금지: 이 출력은 스크립트가 만든 문서다.
//   · DB·네트워크·환경변수를 쓰지 않는다. 입력은 EvidenceSheetParts 모양의 JSON 파일(저장 결과에서 이미 뽑은 조각).
//   · 최종 글에 금칙어가 있으면 파일을 쓰지 않고 실패한다.
//
// 사용 (bun):
//   bun scripts/proof/render-evidence-sheet.ts <parts.json> <출력폴더> [--name <파일이름>] [--sample] [--pilot <N>] [--lang ko|en]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildEvidenceSheetView,
  buildLimitsBlock,
  type EvidenceSheetView,
  flattenView,
  scanBannedPhrases,
} from "../../packages/audit/evidence-copy";
import {
  assembleEvidenceSheet,
  type EvidenceSheetParts,
} from "../../packages/audit/evidence-sheet";

function argValue(args: string[], flag: string): string | null {
  const i = args.indexOf(flag);
  return i >= 0 ? (args[i + 1] ?? null) : null;
}

function cell(text: string): string {
  return text.split("|").join("\\|");
}

export function viewToMarkdown(view: EvidenceSheetView): string {
  const out: string[] = [];
  if (view.sample_label) {
    out.push(`> **${view.sample_label}**`, "");
  }
  out.push(`# ${view.title}`, "", `> ${view.draft_label}`, "");
  out.push(`**${view.first_line}**`, "", view.second_line, "");
  for (const s of view.sections) {
    out.push(`## ${s.heading}`, "");
    for (const line of s.lines) {
      out.push(s.id === "limits" ? `1. ${line}` : `- ${line}`);
    }
    if (s.lines.length > 0) {
      out.push("");
    }
    if (s.table) {
      out.push(`| ${s.table.headers.map(cell).join(" | ")} |`);
      out.push(`|${s.table.headers.map(() => "---").join("|")}|`);
      for (const row of s.table.rows) {
        out.push(`| ${row.map(cell).join(" | ")} |`);
      }
      out.push("");
    }
  }
  out.push(
    `## ${view.language === "ko" ? "푸터" : "Footer"}`,
    "",
    view.footer_line,
    ""
  );
  return out.join("\n");
}

function esc(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function viewToHtml(view: EvidenceSheetView): string {
  const body: string[] = [];
  if (view.sample_label) {
    body.push(`<p class="sample">${esc(view.sample_label)}</p>`);
  }
  body.push(`<h1>${esc(view.title)}</h1>`);
  body.push(`<p class="draft">${esc(view.draft_label)}</p>`);
  body.push(`<p class="first">${esc(view.first_line)}</p>`);
  body.push(`<p>${esc(view.second_line)}</p>`);
  for (const s of view.sections) {
    body.push(`<h2>${esc(s.heading)}</h2>`);
    if (s.lines.length > 0) {
      const tag = s.id === "limits" ? "ol" : "ul";
      body.push(
        `<${tag}>${s.lines.map((l) => `<li>${esc(l)}</li>`).join("")}</${tag}>`
      );
    }
    if (s.table) {
      const head = s.table.headers.map((h) => `<th>${esc(h)}</th>`).join("");
      const rows = s.table.rows
        .map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`)
        .join("");
      body.push(
        `<table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`
      );
    }
  }
  body.push(`<p class="footer">${esc(view.footer_line)}</p>`);
  const style =
    "body{font-family:-apple-system,'Apple SD Gothic Neo',sans-serif;max-width:760px;margin:24px auto;padding:0 16px;color:#111;line-height:1.5}" +
    "h2{font-size:15px;margin:18px 0 4px;border-bottom:1px solid #ccc}table{border-collapse:collapse;width:100%;font-size:12px}" +
    "th,td{border:1px solid #ccc;padding:3px 6px;text-align:left}.sample{background:#eee;padding:4px 8px;font-weight:700}" +
    ".draft{color:#666;font-size:12px}.first{font-weight:700}.footer{margin-top:20px;font-size:12px;color:#444}@media print{body{margin:0}}";
  return `<!doctype html><html lang="${view.language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(view.title)}</title><style>${style}</style></head><body>${body.join("\n")}</body></html>\n`;
}

function main(): void {
  const args = process.argv.slice(2);
  const [partsPath, outDir] = args;
  if (!(partsPath && outDir)) {
    console.error(
      "사용: bun scripts/proof/render-evidence-sheet.ts <parts.json> <출력폴더> [--name N] [--sample] [--pilot N] [--lang ko|en]"
    );
    process.exit(2);
  }
  const parts = JSON.parse(
    readFileSync(partsPath, "utf8")
  ) as EvidenceSheetParts;
  const pilotRaw = argValue(args, "--pilot");
  const pilot = pilotRaw === null ? null : Number(pilotRaw);
  const langArg = argValue(args, "--lang");
  const lang =
    langArg === "en" || langArg === "ko" ? langArg : parts.ui_language;
  const sheet = assembleEvidenceSheet({
    ...parts,
    limits: buildLimitsBlock({ pilot_review_count: pilot }),
    ui_language: lang,
  });
  const view = buildEvidenceSheetView(sheet, {
    pilot_review_count: pilot,
    sample: args.includes("--sample"),
  });
  const hits = scanBannedPhrases(flattenView(view));
  if (hits.length > 0) {
    console.error(
      `금칙어 ${hits.length}건 — 파일을 쓰지 않습니다: ${hits.map((h) => h.phrase).join(", ")}`
    );
    process.exit(1);
  }
  const name = argValue(args, "--name") ?? "evidence-sheet";
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, `${name}.${lang}.md`), viewToMarkdown(view));
  writeFileSync(join(outDir, `${name}.${lang}.html`), viewToHtml(view));
  console.log(`쓴 파일: ${name}.${lang}.md, ${name}.${lang}.html (${outDir})`);
}

if (import.meta.main) {
  main();
}
