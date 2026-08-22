import sys
from playwright.sync_api import sync_playwright

OUT = "/private/tmp/claude-501/-Users-easymilli-Downloads------/823941e9-126b-462e-ac2e-22db01739da7/scratchpad"
URL = sys.argv[1]
NAME = sys.argv[2]
WIDTH = int(sys.argv[3]) if len(sys.argv) > 3 else 1440

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": WIDTH, "height": 1100},
                            color_scheme="dark")
    errs = []
    page.on("console", lambda m: errs.append(f"{m.type}: {m.text[:200]}") if m.type == "error" else None)
    page.on("pageerror", lambda e: errs.append(f"pageerror: {str(e)[:200]}"))

    page.goto(URL, timeout=120000, wait_until="domcontentloaded")
    page.wait_for_timeout(6000)
    page.screenshot(path=f"{OUT}/{NAME}.png", full_page=True)
    print("URL:", page.url)
    print("=== 화면 텍스트 ===")
    print(page.locator("body").inner_text()[:1500])
    print("=== 콘솔 에러 ===")
    for e in errs[:8]:
        print("  ", e)
    if not errs:
        print("  (없음)")
    browser.close()
