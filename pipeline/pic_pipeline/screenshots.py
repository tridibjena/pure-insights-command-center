"""Capture the README screenshots from the running app (real data, dark theme).

Prerequisites: `npm run setup` and `npm run dev` (API on :4000, web on :5173).
Usage:  python -m pic_pipeline.screenshots [--base-url http://localhost:5173] [--only 03,07]
"""

from __future__ import annotations

import argparse
import os
import time
from pathlib import Path

from playwright.sync_api import Page, sync_playwright

from .config import DOCS_DIR

OUT = DOCS_DIR / "screenshots"
USERS = {
    "admin": "admin@pureinsights.local",
    "sre": "sre@pureinsights.local",
    "finops": "finops@pureinsights.local",
    "owner": "user_7@company.com",
}
HEADERS = {"X-Requested-With": "XMLHttpRequest"}
VIEWPORT = {"width": 1440, "height": 900}
DRILLDOWN_REPORT = "RPT_265"


def login(page: Page, base: str, who: str) -> None:
    page.context.clear_cookies()
    res = page.request.post(
        f"{base}/api/auth/login",
        headers=HEADERS,
        data={"email": USERS[who], "password": os.environ["SEED_DEMO_PASSWORD"]},
    )
    assert res.ok, f"login failed for {who}: {res.status}"


def api_post(page: Page, base: str, path: str, data: dict | None = None) -> dict:
    res = page.request.post(f"{base}{path}", headers=HEADERS, data=data or {})
    assert res.ok, f"POST {path} -> {res.status}"
    return res.json()


def settle(page: Page, ms: int = 900) -> None:
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(ms)


def shot(page: Page, name: str, full_page: bool = True) -> Path:
    path = OUT / f"{name}.png"
    page.screenshot(path=str(path), full_page=full_page)
    print(f"  saved {path.relative_to(DOCS_DIR.parent)}")
    return path


def capture(base: str, only: set[str] | None) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    want = lambda key: only is None or key in only  # noqa: E731
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport=VIEWPORT, color_scheme="dark", device_scale_factor=2)

        if want("01"):
            page.context.clear_cookies()
            page.goto(f"{base}/login")
            settle(page)
            page.get_by_role("button", name="sre@pureinsights.local").click()
            page.get_by_label("Password").fill("••••••••••••")
            shot(page, "01-login", full_page=False)

        # Live alerting: reset the replay and stream snapshots through the alert pipeline.
        if want("03") or want("04"):
            login(page, base, "sre")
            api_post(page, base, "/api/telemetry/replay/reset", {"clearAlerts": True})
            api_post(page, base, "/api/telemetry/replay/config", {"intervalMs": 3000})
            page.goto(f"{base}/alerts")
            settle(page)
            api_post(page, base, "/api/telemetry/replay/start")
            page.wait_for_selector(".toast", timeout=15000)
            page.wait_for_timeout(7000)  # ~2 snapshots: raises, escalations and auto-resolves
            api_post(page, base, "/api/telemetry/replay/stop")
            page.wait_for_timeout(400)
            if want("03"):
                shot(page, "03-live-alerting", full_page=False)
            if want("04"):
                res = page.request.get(f"{base}/api/alerts?status=live&limit=500").json()
                multi = [a for a in res["alerts"] if a["occurrence_count"] > 1 and a["status"] == "OPEN"]
                target = sorted(multi or res["alerts"], key=lambda a: -a["occurrence_count"])[0]
                page.goto(f"{base}/alerts")
                settle(page)
                page.locator("tr.clickable", has_text=target["title"]).first.click()
                page.get_by_role("button", name="Acknowledge", exact=True).click()
                page.wait_for_timeout(800)
                shot(page, "04-alert-detail", full_page=False)

        if want("02"):
            login(page, base, "admin")
            page.goto(f"{base}/health")
            settle(page, 1500)
            shot(page, "02-system-health")

        if want("05"):
            login(page, base, "admin")
            page.goto(f"{base}/orphans")
            settle(page)
            page.get_by_role("button", name="Assign owner").first.click()
            page.wait_for_timeout(500)
            shot(page, "05-orphaned-reports", full_page=False)

        if want("06"):
            login(page, base, "admin")
            page.goto(f"{base}/reports/{DRILLDOWN_REPORT}")
            settle(page, 1200)
            shot(page, "06-report-drilldown")

        if want("07"):
            login(page, base, "finops")
            page.goto(f"{base}/costs")
            settle(page, 1500)
            shot(page, "07-cost-allocation")

        if want("08"):
            login(page, base, "admin")
            page.goto(f"{base}/data-quality")
            settle(page)
            shot(page, "08-data-quality")

        if want("09"):
            login(page, base, "owner")
            page.goto(f"{base}/reports")
            settle(page)
            shot(page, "09a-rbac-report-owner-scope", full_page=False)
            page.goto(f"{base}/costs")
            settle(page)
            shot(page, "09b-rbac-forbidden", full_page=False)

        if want("10"):
            login(page, base, "admin")
            page.goto(f"{base}/admin")
            settle(page)
            shot(page, "10-administration")

        browser.close()


def main() -> None:
    from .config import REPO_ROOT  # noqa: F401  (loads .env)

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default=os.getenv("SCREENSHOT_BASE_URL", "http://localhost:5173"))
    parser.add_argument("--only", help="comma-separated shot numbers, e.g. 03,07")
    args = parser.parse_args()
    only = set(args.only.split(",")) if args.only else None
    started = time.perf_counter()
    capture(args.base_url, only)
    print(f"done in {time.perf_counter() - started:.0f}s")


if __name__ == "__main__":
    main()
