import sys
from playwright.sync_api import sync_playwright
OUT="/private/tmp/claude-501/-Users-easymilli-Downloads------/823941e9-126b-462e-ac2e-22db01739da7/scratchpad"
URL, NAME = sys.argv[1], sys.argv[2]
with sync_playwright() as p:
    b=p.chromium.launch(headless=True)
    # 한국어 브라우저 + KR 국가 헤더 강제
    ctx=b.new_context(viewport={"width":1440,"height":1000}, color_scheme="dark",
                      locale="ko-KR", extra_http_headers={"x-vercel-ip-country":"KR"})
    pg=ctx.new_page()
    pg.goto(URL, timeout=180000, wait_until="domcontentloaded")
    pg.wait_for_timeout(12000)
    h=pg.evaluate("document.documentElement.scrollHeight")
    print(f"높이: {h}px · 스크롤 {h/1000:.1f}회")
    print(f"본문 글자수: {len(pg.locator('body').inner_text())}")
    pg.screenshot(path=f"{OUT}/{NAME}.png", full_page=True)
    print("=== 제목 구조 ===")
    for tag in ["h1","h2","h3"]:
        for el in pg.locator(tag).all():
            t=(el.inner_text() or "").strip().replace("\n"," ")
            if t: print(f"  <{tag}> {t[:75]}")
    b.close()
