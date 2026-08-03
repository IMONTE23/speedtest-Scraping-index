# Speedtest Global Index Scraper - Chrome Extension

Chrome Extension (Manifest V3) for extracting, viewing, and exporting **Mobile & Fixed Broadband** global internet speed rankings from [Speedtest Global Index](https://www.speedtest.net/global-index).

## Features

- ⚡ **1-Click Scraping**: Extract data directly from your active browser tab (no Cloudflare bot detection issues).
- 📊 **Dual Category Support**: Switch seamlessly between **Mobile Median** and **Fixed Broadband Median** rankings.
- 🔍 **Real-time Search**: Instant country name filtering.
- 📈 **Rank Change Indicators**: Clear visual badges (`+3` green, `-2` red, `0` gray).
- 📥 **CSV Export**: Export data matching date format (`mobile_DDMMYY.csv`, `fixed_DDMMYY.csv`).
- 🎨 **Modern Dark UI**: Designed with glassmorphism and clean typography.

---

## How to Install in Google Chrome

1. Open **Google Chrome**.
2. Navigate to `chrome://extensions` in the address bar.
3. Enable **Developer mode** toggle in the top-right corner.
4. Click **Load unpacked** in the top-left corner.
5. Select the `speedtest-chrome-extension` folder:
   ```
   d:\Code\speedtest Scraping index\speedtest-chrome-extension
   ```
6. The extension **Speedtest Global Index Scraper** is now installed!

---

## How to Use

1. Go to [https://www.speedtest.net/global-index](https://www.speedtest.net/global-index).
2. Click the **Speedtest Scraper** icon in your Chrome toolbar.
3. Click **"Scrape Page"**.
4. Browse rankings, switch between Mobile and Fixed tabs, or search for a country.
5. Click **"CSV (Mobile)"** or **"CSV (Fixed)"** to download date-stamped CSV files.

---

## File Structure

```
speedtest-chrome-extension/
├── manifest.json       # Manifest V3 extension configuration
├── popup.html          # Popup window layout
├── popup.js            # Controller script (UI, rendering, CSV download)
├── content.js          # DOM extraction logic
├── styles.css          # Modern dark styling
├── icons/              # Extension icons (16x16, 48x48, 128x128)
└── README.md           # Instructions
```
