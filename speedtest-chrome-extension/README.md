# Speedtest Global Index Scraper - Chrome Extension

Chrome Extension (Manifest V3) for extracting, viewing, and exporting **Country & City** internet speed rankings (**Mobile & Fixed Broadband**) from [Speedtest Global Index](https://www.speedtest.net/global-index).

## Features

- ⚡ **1-Click Full Scraping**: Extract both Country Speeds and City Speeds directly from your active browser tab in one click (no need to toggle tabs on Speedtest first).
- 📊 **4-Tab Ranking View**: Switch across **Mobile Country**, **Fixed Country**, **Mobile City**, and **Fixed City** rankings.
- 🔍 **Real-time Search**: Instant country or city name filtering (`"Bangkok, Thailand"`).
- 📈 **Rank Change Indicators**: Clear visual badges (`+3` green, `-2` red, `0` gray).
- 📥 **4-Sheet Excel Export**: Export a single `.xlsx` workbook (`speedtest_DDMMYY.xlsx`) containing 4 sheets: `mobile_country`, `fixed_country`, `mobile_city`, and `fixed_city`.
- 🎨 **Modern Dark UI**: Designed with glassmorphism and clean typography.

---

## How to Install in Google Chrome

1. Open **Google Chrome**.
2. Navigate to `chrome://extensions` in the address bar.
3. Enable **Developer mode** toggle in the top-right corner.
4. Click **Load unpacked** in the top-left corner.
5. Select the `speedtest-chrome-extension` folder:
   ```
   d:\Code\speedtest-Scraping-index\speedtest-chrome-extension
   ```
6. The extension **Speedtest Global Index Scraper** is now installed!

---

## How to Use

1. Go to [https://www.speedtest.net/global-index](https://www.speedtest.net/global-index).
2. Click the **Speedtest Scraper** icon in your Chrome toolbar.
3. Click **"Scrape Page"**.
4. Browse rankings across the 4 tabs (`Mob Country`, `Fix Country`, `Mob City`, `Fix City`) or search for a country/city.
5. Click **"Excel (4 Sheets)"** to download a date-stamped `.xlsx` workbook (`speedtest_DDMMYY.xlsx`).

---

## File Structure

```
speedtest-chrome-extension/
├── manifest.json       # Manifest V3 extension configuration
├── popup.html          # Popup window layout (4-tab UI)
├── popup.js            # Controller script (UI, rendering, 4-sheet XLSX builder)
├── content.js          # DOM extraction logic (Country & City speeds)
├── styles.css          # Modern dark styling
├── tests/              # Node.js built-in unit tests (node --test)
├── icons/              # Extension icons (16x16, 48x48, 128x128)
└── README.md           # Instructions
```
