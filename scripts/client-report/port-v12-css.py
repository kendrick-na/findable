"""v12 리포트 템플릿(template.html)의 <style> → 웹용 CSS(.fr12 범위로 격리).

사용: python3 scripts/client-report/port-v12-css.py <v12 fix/template.html> > apps/web/components/client-report-v12/report-v12.css

규칙(기계 변환 — 손으로 고치지 않는다):
- 모든 선택자 앞에 `.fr12 ` 를 붙인다. `:root`·`html`·`body`·`html,body` → `.fr12`, `*` → `.fr12, .fr12 *`.
- `@font-face`(로컬 OTF 경로)는 지운다 — 웹은 layout 의 Pretendard(CDN)를 쓴다. font-family "Pret" → Pretendard.
- `@page` 는 그대로 둔다(A4 · 여백 0).
원본 지문(md5)을 머리 주석에 남긴다. 템플릿이 바뀌면 다시 돌리고 테스트가 지문을 대조한다.
"""
import hashlib
import re
import sys

path = sys.argv[1]
raw = open(path, "rb").read()
html = raw.decode("utf-8")
css = html[html.index("<style>") + 7 : html.index("</style>")]
css = re.sub(r"@font-face\s*\{[^}]*\}", "", css)
css = css.replace('"Pret",', '"Pretendard Variable",Pretendard,')


def scope(sel: str) -> str:
    s = sel.strip()
    if not s:
        return s
    if s in (":root", "html", "body"):
        return ".fr12"
    if s == "*":
        return ".fr12,.fr12 *"
    return f".fr12 {s}"


out = []
pos = 0
for m in re.finditer(r"([^{}]+)\{([^{}]*)\}", css):
    sel, body = m.group(1), m.group(2)
    sel_clean = re.sub(r"/\*.*?\*/", "", sel, flags=re.S).strip()
    if sel_clean.startswith("@page"):
        out.append(f"{sel_clean}{{{body}}}")
        continue
    scoped = ",".join(scope(x) for x in sel_clean.split(","))
    out.append(f"{scoped}{{{body.strip()}}}")

md5 = hashlib.md5(raw).hexdigest()
print(f"/* 자동 생성 — scripts/client-report/port-v12-css.py · 원본 v12 fix/template.html md5 {md5} · 손으로 고치지 말 것 */")
print("\n".join(out))
