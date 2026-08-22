---
description: Blind-revalidate a Findable design/strategy document by reusing only its verified facts, deriving a fresh conclusion independently, then contrasting with the original to surface findings. Use when a KAIST OverEdge daily exercise (Day01+) re-examines an existing Findable asset (PRD, COMPETITORS, ROADMAP, TRD), or when the user asks to re-validate / re-review / 재검증 a document without starting from a blank page.
---

# Blind Revalidator

## What This Skill Does

Runs Findable's core exercise method (CLAUDE.md §7.2): instead of rewriting a
document from scratch, it reuses only the **verified facts** of an existing
Findable asset, derives a **fresh conclusion independently**, then **contrasts**
that conclusion with the original. The gap between them is a *finding*
(a pivot or reinforcement candidate). This keeps objectivity without discarding
the already-built, deployed Findable.

## Inputs

- Target document (name/path — e.g. docs/PRD.md, COMPETITORS.md, TRD)
- Today's theme (what lens to re-examine through — e.g. "market sizing", "positioning")
- (optional) Any external facts to re-check (competitor price, market number)

## Process

1. Extract only the **verified facts** from the target document. Ignore its conclusions for now.
2. Independently derive a fresh conclusion from those facts + today's theme.
3. Contrast the fresh conclusion with the document's original conclusion.
4. Label every claim: `[확인사실]` / `[AI가설]` / `[확인필요]`. Never assert an unverified claim as fact.
5. Re-check competitor prices / market numbers against official web pages; if not possible, mark `[확인필요]`.
6. Register each finding as a code/doc TODO for docs/_적용/실행백로그.md (source §, target path, priority).

## Output

Write the result in this structure:

### 재검증: [문서명] · [날짜] · 테마: [테마]

**1. 재사용한 팩트 (verified only)**
- [확인사실] ...

**2. 독립 도출 결론 (fresh)**
- ...

**3. 기존 결론과 대조**
| 항목 | 기존 결론 | 새 도출 | 차이(=발견) |
|---|---|---|---|

**4. 발견 → 반영 (확신도별 차등)**
- 저위험·확신 → 실수정 OK
- 고위험·방향결정 → 원본 유지 + "🔍 [Day NN 재검토 제안 — 미확정]" 병기
- 실행백로그 등록: [항목 / 근거§ / 대상경로 / 우선순위]

## Safety Rules

- Use only facts actually present in the target document or verified on the web; never invent facts (see no_fabricated_facts).
- High-risk direction changes (North Star, target, scope) → keep original + annotate as unconfirmed proposal; do NOT overwrite.
- Do not modify implementation/source files (apps/·packages/) — this Skill produces analysis docs only, unless the user explicitly asks to apply to code.
- Never include .env.local values, Clerk secret, DATABASE_URL, or API keys in output.
- If the target document or today's theme is missing, stop and ask — do not guess which document to re-validate.