# Speedtest Global Index Scraper

Scrapes country-level internet speed rankings (Mobile & Fixed Broadband) from [Speedtest Global Index](https://www.speedtest.net/global-index).

This project contains two tools:
1. **Chrome Extension (Manifest V3)** — Extract and view rankings interactively inside Chrome with 1-click CSV exports (`mobile_DDMMYY.csv`, `fixed_DDMMYY.csv`).
2. **Python Scraper Script** — Automated headless browser scraper (`scrape_speedtest_global_index.py`) using DrissionPage and BeautifulSoup.

---

## 1. Chrome Extension (Manifest V3)

Located in [`speedtest-chrome-extension/`](./speedtest-chrome-extension).

### Features
- ⚡ **1-Click Scraping**: Extract data directly from your active browser tab (no Cloudflare bot detection issues).
- 📊 **Dual Category Support**: Switch between **Mobile Median** and **Fixed Broadband Median** rankings.
- 🔍 **Real-time Search**: Instant country name filtering.
- 📈 **Rank Change Indicators**: Clear visual badges (`+3` green, `-2` red, `0` gray).
- 📥 **CSV Export**: Export formatted CSV files (`mobile_DDMMYY.csv`, `fixed_DDMMYY.csv`).
- 🎨 **Modern Dark UI**: Glassmorphic styling with quick-access **Open Speedtest** header button.

### Installation in Google Chrome
1. Open **Google Chrome** and navigate to `chrome://extensions`.
2. Enable **Developer mode** (top-right toggle).
3. Click **Load unpacked** (top-left button).
4. Select the `speedtest-chrome-extension` directory.
5. Go to [https://www.speedtest.net/global-index](https://www.speedtest.net/global-index), click the extension icon, and click **"Scrape Page"**.

---

## 2. Python Scraper Script (`scrape_speedtest_global_index.py`)

### Requirements

Install dependencies:
```bash
pip install DrissionPage beautifulsoup4
```

### Usage

Run headless scraper:
```bash
python scrape_speedtest_global_index.py
```

Run in headed (visible browser) mode if Cloudflare blocks headless:
```bash
python scrape_speedtest_global_index.py --headed
```

### Output

Output files are written to `output/`:
- `speedtest_mobile_DDMMYY.csv`
- `speedtest_fixed_broadband_DDMMYY.csv`

---

## Project Structure

```
.
├── README.md                           # Main project documentation
├── scrape_speedtest_global_index.py   # Python DrissionPage scraper
├── output/                             # Saved Python CSV outputs
└── speedtest-chrome-extension/         # Chrome Extension (Manifest V3)
    ├── manifest.json
    ├── popup.html
    ├── popup.js
    ├── content.js
    ├── styles.css
    ├── icons/
    └── README.md
```
