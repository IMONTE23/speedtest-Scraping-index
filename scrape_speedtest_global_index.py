"""
Speedtest Global Index Scraper
==============================
Scrapes country-level internet speed rankings from
https://www.speedtest.net/global-index

Extracts both Mobile and Fixed Broadband tables with:
  - Rank, Country, Download speed (Mbps), Rank change

Uses Playwright with stealth context & persistent profiles to store Cloudflare clearance cookies.

Dependencies (install with pip):
    pip install playwright playwright-stealth beautifulsoup4
    python -m playwright install chromium

Usage:
    python scrape_speedtest_global_index.py           # headless (default)
    python scrape_speedtest_global_index.py --headed   # visible browser window
"""

import argparse
import csv
import sys
import time
from datetime import datetime
from pathlib import Path

from bs4 import BeautifulSoup
from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout
from playwright_stealth import Stealth

URL = "https://www.speedtest.net/global-index"
BASE_DIR = Path(__file__).resolve().parent
OUTPUT_DIR = BASE_DIR / "output"
PROFILE_DIR = BASE_DIR / ".browser_profile"

MIN_HTML_SIZE = 100_000


def _launch_and_fetch(headless: bool) -> str:
    """Fetch page HTML using Playwright persistent context + stealth."""
    mode = "headless" if headless else "headed"
    print(f"  Attempting {mode} browser with persistent profile...")

    PROFILE_DIR.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as pw:
        channels_to_try = ["chrome", None]
        context = None

        for channel in channels_to_try:
            try:
                kwargs = {
                    "user_data_dir": str(PROFILE_DIR),
                    "headless": headless,
                    "ignore_default_args": ["--enable-automation"],
                    "args": [
                        "--disable-blink-features=AutomationControlled",
                        "--no-sandbox",
                        "--disable-dev-shm-usage",
                    ],
                    "user_agent": (
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                        "AppleWebKit/537.36 (KHTML, like Gecko) "
                        "Chrome/126.0.0.0 Safari/537.36"
                    ),
                    "viewport": {"width": 1920, "height": 1080},
                    "locale": "en-US",
                }
                if channel:
                    kwargs["channel"] = channel

                context = pw.chromium.launch_persistent_context(**kwargs)
                break
            except Exception as err:
                if channel == "chrome":
                    continue
                raise err

        if not context:
            raise RuntimeError("Failed to launch browser context.")

        page = context.pages[0] if context.pages else context.new_page()

        try:
            Stealth().apply_stealth_sync(page)
        except Exception:
            pass

        try:
            page.goto(URL, wait_until="domcontentloaded", timeout=60_000)
        except PWTimeout:
            print("    Warning: page load timed out, proceeding with DOM.")

        # If Cloudflare Turnstile challenge page appears
        start_time = time.time()
        max_wait = 40 if not headless else 15
        
        if "Just a moment" in page.title():
            print("    [Notice] Cloudflare challenge detected.")
            if not headless:
                print("    --> Please click the Cloudflare 'Verify you are human' checkbox in the open Chrome window if prompted!")

        while time.time() - start_time < max_wait:
            if "Just a moment" not in page.title():
                print("    Cloudflare challenge cleared!")
                break
            page.wait_for_timeout(1000)

        # Wait for data rows selector
        try:
            page.wait_for_selector("tr.data-result", timeout=15_000)
        except PWTimeout:
            pass

        page.wait_for_timeout(2000)

        html = page.content()
        print(f"    Got {len(html):,} bytes of HTML (Title: '{page.title()}').")
        context.close()

    return html


def fetch_page(force_headed: bool = False, max_retries: int = 2) -> BeautifulSoup:
    """Fetch the page with automatic retries and headed fallback."""
    print(f"Fetching {URL} ...")

    html = ""
    for attempt in range(1, max_retries + 1):
        is_headed = force_headed or (attempt > 1)
        if attempt > 1:
            print(
                f"\n  [Retry {attempt}/{max_retries}] Retrying in headed mode..."
            )

        html = _launch_and_fetch(headless=not is_headed)
        if len(html) >= MIN_HTML_SIZE:
            break

    if len(html) < MIN_HTML_SIZE:
        print(
            f"\n  ERROR: Cloudflare verification incomplete.\n"
            f"  Run with '--headed' and allow the browser 10 seconds to pass the Cloudflare check.",
            file=sys.stderr,
        )
        sys.exit(1)

    return BeautifulSoup(html, "html.parser")


def parse_rank_change(cell) -> str:
    """Extract rank change text from a rank-change cell.

    Returns '+3', '-1', or '0' (for neutral/unchanged).
    """
    span = cell.find("span", class_="tooltip")
    if span is None:
        return ""
    classes = span.get("class", [])
    text = span.get_text(strip=True)
    if "neutral" in classes:
        return "0"
    return text


def extract_country_table(
    soup: BeautifulSoup, link_fragment: str, container_id: str = None
) -> list[dict]:
    """Extract ranking rows from a specific container for the given link fragment.

    Args:
        soup: Parsed page.
        link_fragment: '#mobile' or '#fixed' — used to distinguish tables.
        container_id: Optional ID of the container div (e.g. 'column-mobileMedian' or 'column-fixedMedian').

    Returns:
        List of dicts with keys: rank, country, download_mbps, rank_change.
    """
    container = soup.find(id=container_id) if container_id else soup
    if container is None:
        return []

    rows = []
    for tr in container.find_all("tr", class_="data-result"):
        country_cell = tr.find("td", class_="country")
        if country_cell is None:
            continue
        link = country_cell.find("a")
        if link is None:
            continue
        href = link.get("href", "")
        # Skip city-level rows (contain '?city=')
        if "?city=" in href:
            continue
        if not href.endswith(link_fragment):
            continue

        rank_cell = tr.find("td", class_="actual-rank")
        change_cell = tr.find("td", class_="rank-change")
        speed_cell = tr.find("td", class_="speed")

        rank = rank_cell.get_text(strip=True) if rank_cell else ""
        country = link.get_text(strip=True)
        speed = speed_cell.get_text(strip=True) if speed_cell else ""
        change = parse_rank_change(change_cell) if change_cell else ""

        rows.append({
            "rank": int(rank) if rank.isdigit() else rank,
            "country": country,
            "download_mbps": float(speed) if speed else "",
            "rank_change": change,
        })

    rows.sort(key=lambda r: r["rank"] if isinstance(r["rank"], int) else 9999)
    return rows


def write_csv(rows: list[dict], filepath: Path) -> None:
    """Write rows to a CSV file."""
    if not rows:
        print(f"  No data to write for {filepath.name}")
        return
    fieldnames = ["rank", "country", "download_mbps", "rank_change"]
    filepath.parent.mkdir(parents=True, exist_ok=True)
    with open(filepath, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)
    print(f"  Saved {len(rows)} rows to {filepath}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Scrape Speedtest Global Index rankings."
    )
    parser.add_argument(
        "--headed",
        action="store_true",
        help="Run browser in headed (visible) mode. Useful if headless is blocked.",
    )
    args = parser.parse_args()

    try:
        soup = fetch_page(force_headed=args.headed)
    except Exception as e:
        print(f"Error fetching page: {e}", file=sys.stderr)
        sys.exit(1)

    date_str = datetime.now().strftime("%d%m%y")

    # --- Mobile ---
    print("\nParsing Mobile rankings (Median)...")
    mobile_rows = extract_country_table(
        soup, "#mobile", container_id="column-mobileMedian"
    )
    print(f"  Found {len(mobile_rows)} countries.")
    write_csv(mobile_rows, OUTPUT_DIR / f"speedtest_mobile_{date_str}.csv")
    write_csv(mobile_rows, OUTPUT_DIR / "speedtest_mobile.csv")

    # --- Fixed Broadband ---
    print("\nParsing Fixed Broadband rankings (Median)...")
    fixed_rows = extract_country_table(
        soup, "#fixed", container_id="column-fixedMedian"
    )
    print(f"  Found {len(fixed_rows)} countries.")
    write_csv(fixed_rows, OUTPUT_DIR / f"speedtest_fixed_broadband_{date_str}.csv")
    write_csv(fixed_rows, OUTPUT_DIR / "speedtest_fixed_broadband.csv")

    if mobile_rows:
        print(f"\nSample mobile data (top 5):")
        for r in mobile_rows[:5]:
            print(
                f"  #{r['rank']:>3}  {r['country']:<30} "
                f"{r['download_mbps']:>8} Mbps  (change: {r['rank_change']})"
            )

    if fixed_rows:
        print(f"\nSample fixed broadband data (top 5):")
        for r in fixed_rows[:5]:
            print(
                f"  #{r['rank']:>3}  {r['country']:<30} "
                f"{r['download_mbps']:>8} Mbps  (change: {r['rank_change']})"
            )

    print("\nDone.")


if __name__ == "__main__":
    main()
