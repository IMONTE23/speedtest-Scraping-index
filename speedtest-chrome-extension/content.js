/**
 * Speedtest Global Index Scraper - Content Script
 * Extracts Mobile & Fixed Broadband rankings directly from Speedtest.net.
 */

const MONTH_MAP = {
  january: "01",
  february: "02",
  march: "03",
  april: "04",
  may: "05",
  june: "06",
  july: "07",
  august: "08",
  september: "09",
  october: "10",
  november: "11",
  december: "12",
  jan: "01",
  feb: "02",
  mar: "03",
  apr: "04",
  jun: "06",
  jul: "07",
  aug: "08",
  sep: "09",
  sept: "09",
  oct: "10",
  nov: "11",
  dec: "12"
};

function formatYearMonth(monthStr, yearStr) {
  if (!monthStr || !yearStr) return "";
  const m = MONTH_MAP[monthStr.trim().toLowerCase()];
  if (!m) return "";
  return `${yearStr.trim()}-${m}`;
}

/**
 * Extract data period as "YYYY-MM" (e.g. "2026-09" from "Median Country Speeds Updated September 2026").
 */
function parseYearMonth() {
  const months = (
    "January|February|March|April|May|June|" +
    "July|August|September|October|November|December"
  );
  const regex = new RegExp(`(?:Updated\\s+)?(${months})\\s+(20\\d{2})`, "i");

  // 1. Check specific known elements
  const measureEl = document.getElementById("measureLocationId");
  if (measureEl && measureEl.textContent) {
    const m = measureEl.textContent.match(regex);
    if (m) {
      const res = formatYearMonth(m[1], m[2]);
      if (res) return res;
    }
  }

  const titleEl = document.querySelector(".page-header-title");
  if (titleEl && titleEl.textContent) {
    const m = titleEl.textContent.match(regex);
    if (m) {
      const res = formatYearMonth(m[1], m[2]);
      if (res) return res;
    }
  }

  // 2. Elements containing "Updated"
  const elements = document.querySelectorAll("h1, h2, h3, h4, span, div, p");
  for (const el of elements) {
    const text = el.textContent;
    if (text && text.includes("Updated")) {
      const m = text.match(regex);
      if (m) {
        const res = formatYearMonth(m[1], m[2]);
        if (res) return res;
      }
    }
  }

  // 3. Visible body text
  if (document.body && document.body.innerText) {
    const m = document.body.innerText.match(regex);
    if (m) {
      const res = formatYearMonth(m[1], m[2]);
      if (res) return res;
    }
  }

  // 4. Fallback: regex search on cleaned HTML
  if (document.body && document.body.innerHTML) {
    const cleaned = document.body.innerHTML
      .replace(/&nbsp;/g, " ")
      .replace(/<[^>]+>/g, " ");
    const m = cleaned.match(regex);
    if (m) {
      const res = formatYearMonth(m[1], m[2]);
      if (res) return res;
    }
  }

  return "";
}

function parseRankChange(changeCell) {
  if (!changeCell) return "";
  const tooltip = changeCell.querySelector("span.tooltip");
  if (!tooltip) return "";

  if (tooltip.classList.contains("neutral")) {
    return "0";
  }
  return tooltip.textContent.trim();
}

function extractCountryTable(containerId, linkFragment) {
  const container = containerId ? document.getElementById(containerId) : document;
  if (!container) return [];

  const rows = [];
  const trElements = container.querySelectorAll("tr.data-result");

  trElements.forEach((tr) => {
    const countryCell = tr.querySelector("td.country");
    if (!countryCell) return;
    const link = countryCell.querySelector("a");
    if (!link) return;

    const href = link.getAttribute("href") || "";
    // Skip city-level rows (contain '?city=')
    if (href.includes("?city=")) return;
    if (linkFragment && !href.endsWith(linkFragment)) return;

    const rankCell = tr.querySelector("td.actual-rank");
    const changeCell = tr.querySelector("td.rank-change");
    const speedCell = tr.querySelector("td.speed");

    const rawRank = rankCell ? rankCell.textContent.trim() : "";
    const country = link.textContent.trim();
    const rawSpeed = speedCell ? speedCell.textContent.trim().replace(/,/g, "") : "";
    const change = parseRankChange(changeCell);

    const rank = /^\d+$/.test(rawRank) ? parseInt(rawRank, 10) : rawRank;
    const downloadMbps = rawSpeed ? parseFloat(rawSpeed) : "";

    rows.push({
      rank: rank,
      country: country,
      download_mbps: downloadMbps,
      rank_change: change,
      "yyyy-mm": ""
    });
  });

  rows.sort((a, b) => {
    const rankA = typeof a.rank === "number" ? a.rank : 9999;
    const rankB = typeof b.rank === "number" ? b.rank : 9999;
    return rankA - rankB;
  });

  return rows;
}

function scrapeSpeedtestData() {
  const mobileRows = extractCountryTable("column-mobileMedian", "#mobile");
  const fixedRows = extractCountryTable("column-fixedMedian", "#fixed");
  const yyyyMm = parseYearMonth();

  mobileRows.forEach((r) => { r["yyyy-mm"] = yyyyMm; });
  fixedRows.forEach((r) => { r["yyyy-mm"] = yyyyMm; });

  return {
    mobile: mobileRows,
    fixed: fixedRows,
    yearMonth: yyyyMm,
    dataPeriod: yyyyMm,
    scrapedAt: new Date().toISOString(),
    pageTitle: document.title,
    url: window.location.href
  };
}

// Global exposure for scripting execution
window.__scrapeSpeedtestData = scrapeSpeedtestData;

// Listen for popup messages
if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "SCRAPE_DATA") {
      try {
        const data = scrapeSpeedtestData();
        sendResponse({ success: true, data: data });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    }
    return true; // Keep channel open for async response
  });
}
