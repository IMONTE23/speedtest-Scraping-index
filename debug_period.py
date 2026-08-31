"""Debug script: find where month/year is in the Speedtest Global Index HTML."""
import re
import time

from bs4 import BeautifulSoup
from DrissionPage import ChromiumPage, ChromiumOptions

URL = "https://www.speedtest.net/global-index"
MIN_HTML_SIZE = 100_000

co = ChromiumOptions()
page = ChromiumPage(co)
page.get(URL)
start = time.time()
while time.time() - start < 20:
    if "Just a moment" not in page.title and len(page.html) >= MIN_HTML_SIZE:
        break
    time.sleep(1)
html = page.html
page.quit()
print(f"HTML size: {len(html):,}")

soup = BeautifulSoup(html, "html.parser")

# 1) Elements containing "Updated"
print("\n=== Elements containing 'Updated' ===")
for tag in soup.find_all(True):
    text = tag.get_text(" ", strip=True)
    if "Updated" in text and len(text) < 200:
        cls = tag.get("class", [])
        print(f"  <{tag.name} class={cls}> : {repr(text[:150])}")

# 2) Raw month+year patterns in HTML
months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
]
print("\n=== Raw month+year patterns ===")
for m in months:
    hits = re.findall(rf"{m}\s+20\d\d", html)
    if hits:
        print(f"  {hits[:5]}")

# 3) Context around 'Updated' in raw HTML
print("\n=== Raw HTML context around 'Updated' ===")
for match in re.finditer(r".{0,80}Updated.{0,80}", html):
    snippet = match.group()
    if len(snippet) < 200:
        print(f"  {repr(snippet)}")
