"""
Speedtest Global Index Scraper
==============================
Scrapes country-level internet speed rankings from
https://www.speedtest.net/global-index

Extracts both Mobile and Fixed Broadband tables with:
  - Rank, Country, Download speed (Mbps), Rank change, yyyy-mm.

"""

import argparse
import csv
import re
import sys
import time
from datetime import datetime
from pathlib import Path

from bs4 import BeautifulSoup
from DrissionPage import ChromiumPage, ChromiumOptions
from openpyxl import Workbook

URL = "https://www.speedtest.net/global-index"
BASE_DIR = Path(__file__).resolve().parent
OUTPUT_DIR = BASE_DIR / "output"
CSV_OUTPUT_DIR = OUTPUT_DIR / "csv"

MIN_HTML_SIZE = 100_000

MONTH_MAP = {
    "january": "01",
    "february": "02",
    "march": "03",
    "april": "04",
    "may": "05",
    "june": "06",
    "july": "07",
    "august": "08",
    "september": "09",
    "october": "10",
    "november": "11",
    "december": "12",
    "jan": "01",
    "feb": "02",
    "mar": "03",
    "apr": "04",
    "jun": "06",
    "jul": "07",
    "aug": "08",
    "sep": "09",
    "sept": "09",
    "oct": "10",
    "nov": "11",
    "dec": "12",
}


def fetch_page(force_headed: bool = False) -> BeautifulSoup:
    """Fetch page HTML using DrissionPage to bypass Cloudflare protection."""
    mode = "headed" if force_headed else "headless"
    print(f"Fetching {URL} using DrissionPage ({mode} mode)...")

    co = ChromiumOptions()
    if not force_headed:
        co.headless()

    page = ChromiumPage(co)
    try:
        page.get(URL)

        # Wait for Cloudflare challenge to complete if present
        start_time = time.time()
        while time.time() - start_time < 20:
            if "Just a moment" not in page.title and len(page.html) >= MIN_HTML_SIZE:
                break
            time.sleep(1)

        html = page.html
        title = page.title
        print(f"  Successfully loaded page! (Title: '{title}', HTML size: {len(html):,} bytes)")
    finally:
        page.quit()

    if len(html) < MIN_HTML_SIZE:
        print(
            f"\n  ERROR: Could not pass Cloudflare verification (HTML size: {len(html)} bytes).\n"
            f"  Try running with '--headed' flag.",
            file=sys.stderr,
        )
        sys.exit(1)

    return BeautifulSoup(html, "html.parser")


def parse_yyyy_mm(soup: BeautifulSoup) -> str:
    """Extract and format the data period as 'YYYY-MM' (e.g. '2026-09') from 'Updated September 2026'."""
    months = (
        r"(?:January|February|March|April|May|June|"
        r"July|August|September|October|November|December)"
    )
    regex = re.compile(rf"(?:Updated\s+)?({months})\s+(20\d\d)", re.IGNORECASE)

    # 1. Search in visible stripped text across all elements
    page_text = soup.get_text(" ", strip=True)
    match = regex.search(page_text)
    if match:
        month = MONTH_MAP.get(match.group(1).lower(), "")
        year = match.group(2)
        if month and year:
            return f"{year}-{month}"

    # 2. Search specific elements (e.g. #measureLocationId or elements containing 'Updated')
    measure_el = soup.find(id="measureLocationId")
    if measure_el:
        match = regex.search(measure_el.get_text(" ", strip=True))
        if match:
            month = MONTH_MAP.get(match.group(1).lower(), "")
            year = match.group(2)
            if month and year:
                return f"{year}-{month}"

    for el in soup.find_all(True):
        text = el.get_text(" ", strip=True)
        if "Updated" in text:
            match = regex.search(text)
            if match:
                month = MONTH_MAP.get(match.group(1).lower(), "")
                year = match.group(2)
                if month and year:
                    return f"{year}-{month}"

    # 3. Search in raw HTML string
    html_str = str(soup)
    match = regex.search(html_str)
    if match:
        month = MONTH_MAP.get(match.group(1).lower(), "")
        year = match.group(2)
        if month and year:
            return f"{year}-{month}"

    return ""


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
        List of dicts with keys: rank, country, download_mbps, rank_change, yyyy-mm.
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
            "yyyy-mm": "",  # filled in by caller
        })

    rows.sort(key=lambda r: r["rank"] if isinstance(r["rank"], int) else 9999)
    return rows


def cleanup_non_dated_outputs() -> None:
    """Remove stale non-dated outputs so the output folder keeps only date-stamped files."""
    for folder in (OUTPUT_DIR, CSV_OUTPUT_DIR):
        for filename in ["speedtest_mobile.csv", "speedtest_fixed_broadband.csv"]:
            filepath = folder / filename
            if filepath.exists():
                filepath.unlink()
                print(f"  Removed old non-dated file: {filepath}")


def write_csv(rows: list[dict], filepath: Path) -> None:
    """Write rows to a CSV file."""
    if not rows:
        print(f"  No data to write for {filepath.name}")
        return
    fieldnames = ["rank", "country", "download_mbps", "rank_change", "yyyy-mm"]
    filepath.parent.mkdir(parents=True, exist_ok=True)
    with open(filepath, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)
    print(f"  Saved {len(rows)} rows to {filepath}")


def write_excel(
    mobile_rows: list[dict], fixed_rows: list[dict], filepath: Path
) -> None:
    """Write Mobile and Fixed Broadband rows into a single Excel file with 2 sheets."""
    if not mobile_rows and not fixed_rows:
        print(f"  No data to write for {filepath.name}")
        return
    fieldnames = ["rank", "country", "download_mbps", "rank_change", "yyyy-mm"]
    filepath.parent.mkdir(parents=True, exist_ok=True)

    wb = Workbook()
    ws_mobile = wb.active
    ws_mobile.title = "mobile"
    ws_mobile.append(fieldnames)
    for r in mobile_rows:
        ws_mobile.append([r.get(col, "") for col in fieldnames])

    ws_fixed = wb.create_sheet(title="fixed")
    ws_fixed.append(fieldnames)
    for r in fixed_rows:
        ws_fixed.append([r.get(col, "") for col in fieldnames])

    wb.save(filepath)
    print(
        f"  Saved Excel with sheets 'mobile' ({len(mobile_rows)} rows) "
        f"and 'fixed' ({len(fixed_rows)} rows) to {filepath}"
    )


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

    # Extract the yyyy-mm date period from the page
    yyyy_mm = parse_yyyy_mm(soup)
    if yyyy_mm:
        print(f"\nData period detected: '{yyyy_mm}'")
    else:
        print("\nWarning: Could not detect data period header.")

    date_str = datetime.now().strftime("%d%m%y")
    cleanup_non_dated_outputs()

    # --- Mobile ---
    print("\nParsing Mobile rankings (Median)...")
    mobile_rows = extract_country_table(
        soup, "#mobile", container_id="column-mobileMedian"
    )
    for r in mobile_rows:
        r["yyyy-mm"] = yyyy_mm
    print(f"  Found {len(mobile_rows)} countries.")
    write_csv(mobile_rows, CSV_OUTPUT_DIR / f"speedtest_mobile_{date_str}.csv")

    # --- Fixed Broadband ---
    print("\nParsing Fixed Broadband rankings (Median)...")
    fixed_rows = extract_country_table(
        soup, "#fixed", container_id="column-fixedMedian"
    )
    for r in fixed_rows:
        r["yyyy-mm"] = yyyy_mm
    print(f"  Found {len(fixed_rows)} countries.")
    write_csv(fixed_rows, CSV_OUTPUT_DIR / f"speedtest_fixed_broadband_{date_str}.csv")

    # --- Combined Excel (mobile + fixed) ---
    print("\nSaving combined Excel workbook...")
    write_excel(
        mobile_rows,
        fixed_rows,
        OUTPUT_DIR / f"speedtest_global_index_{date_str}.xlsx",
    )

    if mobile_rows:
        print(f"\nSample mobile data (top 5):")
        for r in mobile_rows[:5]:
            print(
                f"  #{r['rank']:>3}  {r['country']:<30} "
                f"{r['download_mbps']:>8} Mbps  (change: {r['rank_change']})  [{r['yyyy-mm']}]"
            )

    if fixed_rows:
        print(f"\nSample fixed broadband data (top 5):")
        for r in fixed_rows[:5]:
            print(
                f"  #{r['rank']:>3}  {r['country']:<30} "
                f"{r['download_mbps']:>8} Mbps  (change: {r['rank_change']})  [{r['yyyy-mm']}]"
            )

    print("\nDone.")


if __name__ == "__main__":
    main()
