import { expect, it } from "vitest";
import { generateAuditPrompts } from "./audit-prompts";

it("asks English prompts with the English name and Korean prompts with the Korean name", () => {
  const prompts = generateAuditPrompts(
    { ko: "노우버스", en: "KNOWVERSE" },
    "both"
  );
  const english = prompts.filter((p) => p.lang === "en");
  const korean = prompts.filter((p) => p.lang === "ko");
  expect(english).toHaveLength(2);
  for (const p of english) {
    expect(p.text).toContain("KNOWVERSE");
    expect(p.text).not.toContain("노우버스");
  }
  for (const p of korean) {
    expect(p.text).toContain("노우버스");
  }
  expect(english[0]?.text).toBe(
    "What does KNOWVERSE offer, and who is it for?"
  );
});
