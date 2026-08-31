/**
 * Speedtest Global Index Scraper - Content Script
 * Extracts Mobile & Fixed Broadband rankings directly from Speedtest.net.
 */

function parseRankChange(changeCell) {
  if (!changeCell) return "";
  const tooltip = changeCell.querySelector("span.tooltip");
  if (!tooltip) return "";

  if (tooltip.classList.contains("neutral")) {
    return "0";
  }
  return tooltip.textContent.trim();
}

/**
 * Extract the data period label, e.g. "Median Country Speeds Updated July 2026".
 * The month/year is rendered by JS into <span id="measureLocationId">.
 */
function parseDataPeriod() {
  const titleEl = document.querySelector(".page-header-title");
  const label = titleEl ? titleEl.textContent.trim() : "";

  // <span id="measureLocationId"> holds JS-rendered month+year
  const monthSpan = document.getElementById("measureLocationId");
  const monthYear = monthSpan ? monthSpan.textContent.trim() : "";

  if (label && monthYear) return `${label} ${monthYear}`;
  if (label) return label;
  return "";
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
      rank_change: change
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
  const dataPeriod = parseDataPeriod();

  return {
    mobile: mobileRows,
    fixed: fixedRows,
    dataPeriod: dataPeriod,
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
