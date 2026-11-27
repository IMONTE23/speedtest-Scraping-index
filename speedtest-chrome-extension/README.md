# Speedtest Global Index Scraper - Chrome Extension

Lightweight Chrome Extension (Manifest V3) for 1-click scraping and 4-sheet Excel export of **Country & City** internet speed rankings (**Mobile & Fixed Broadband**) from [Speedtest Global Index](https://www.speedtest.net/global-index).

## Features

- ⚡ **Instant On-Demand Scraping**: Runs with `injectImmediately: true` only when clicked (zero background content script overhead on Speedtest.net).
- 📥 **4-Sheet Excel Export**: Downloads `speedtest_DDMMYY.xlsx` containing:
  1. `mobile_country` (`rank, country, download_mbps, rank_change, yyyy-mm`)
  2. `fixed_country` (`rank, country, download_mbps, rank_change, yyyy-mm`)
  3. `mobile_city` (`rank, city, download_mbps, rank_change, yyyy-mm`)
  4. `fixed_city` (`rank, city, download_mbps, rank_change, yyyy-mm`)
- 🪶 **Minimal UI**: Only **Scrape Page** and **Excel** buttons — no heavy table rendering or lag.

## How to Use

1. Load unpacked `speedtest-chrome-extension` in `chrome://extensions` (or click **Reload 🔄** if already installed).
2. Open [https://www.speedtest.net/global-index](https://www.speedtest.net/global-index).
3. Click **"Scrape Page"**, then click **"Excel"**.
