"""Disposable local W1 route hydration check; never calls external AI providers."""

import os
from playwright.sync_api import sync_playwright


url = os.environ.get(
    "FINDABLE_W1_URL",
    "http://localhost:3001/ko/audit/00000000-0000-4000-8000-000000000042",
)

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    page = browser.new_page()
    try:
        response = page.goto(url, wait_until="domcontentloaded", timeout=90000)
        assert response is not None and response.status == 200
        page.wait_for_load_state("networkidle", timeout=90000)
        body = page.locator("body").inner_text()
        assert "질문 10개" in body
        assert "네이버 검색 노출 0/10" in body
        assert "이번 측정에서 AI 1곳 모두가 우리를 알아봤어요" in body
        assert "AI 2곳 중 1곳" not in body
        page.get_by_role(
            "heading", name="네이버 검색에 잡힐 한 주제의 글을 꾸준히 올리세요"
        ).click()
        body = page.locator("body").inner_text()
        assert "표본 방식" in body
        assert "효과로 해석하지 마세요" in body
        page.screenshot(path="/tmp/findable_w1_generated_browser.png", full_page=True)
        print("PASS: generated action -> local PG -> public route -> hydrated card")
    finally:
        browser.close()
