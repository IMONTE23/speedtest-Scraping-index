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

function titleCaseSlug(slug) {
  const minorWords = new Set(["of", "and", "the", "in"]);
  return slug
    .split("-")
    .filter(Boolean)
    .map((word, idx) => {
      const lower = word.toLowerCase();
      if (idx > 0 && minorWords.has(lower)) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

function normalizeLocationText(str) {
  return String(str || "")
    .replace(/\s+/g, " ")
    .replace(/(?:\s*,\s*)+/g, ", ")
    .replace(/^,\s*|,\s*$/g, "")
    .trim();
}

function formatCityLocation(countryCell, link) {
  const fullText = normalizeLocationText(countryCell && countryCell.textContent);
  const linkText = normalizeLocationText(link && link.textContent);

  if (linkText && fullText.length > linkText.length && fullText.startsWith(linkText)) {
    const rest = normalizeLocationText(fullText.slice(linkText.length));
    if (rest) return `${linkText}, ${rest}`;
  }

  if (fullText.includes(",")) {
    return fullText;
  }

  const href = link && link.getAttribute ? link.getAttribute("href") || "" : "";
  const slugMatch = href.match(/\/global-index\/([^/?#]+)\?city=/i);
  if (slugMatch && slugMatch[1].toLowerCase() !== "city") {
    let rawSlug = slugMatch[1];
    try {
      rawSlug = decodeURIComponent(rawSlug);
    } catch (_) {
      // Keep raw slug if malformed URI component
    }
    const countryName = titleCaseSlug(rawSlug);
    if (countryName && linkText) {
      return `${linkText}, ${countryName}`;
    }
  }

  return fullText || linkText;
}

function extractRankingTable(containerId, linkFragment, mode = "country") {
  const container = containerId ? document.getElementById(containerId) : document;
  if (!container) return [];

  const isCityMode = mode === "city";
  const rows = [];
  const trElements = container.querySelectorAll("tr.data-result");

  trElements.forEach((tr) => {
    const countryCell = tr.querySelector("td.country");
    if (!countryCell) return;
    const link = countryCell.querySelector("a");
    if (!link) return;

    const href = link.getAttribute("href") || "";
    const isCityRow = href.includes("?city=");
    if (isCityMode !== isCityRow) return;
    if (linkFragment && !href.endsWith(linkFragment)) return;

    const rankCell = tr.querySelector("td.actual-rank");
    const changeCell = tr.querySelector("td.rank-change");
    const speedCell = tr.querySelector("td.speed");

    const rawRank = rankCell ? rankCell.textContent.trim() : "";
    const rawSpeed = speedCell ? speedCell.textContent.trim().replace(/,/g, "") : "";
    const change = parseRankChange(changeCell);

    const rank = /^\d+$/.test(rawRank) ? parseInt(rawRank, 10) : rawRank;
    const parsedSpeed = rawSpeed ? parseFloat(rawSpeed) : NaN;
    const downloadMbps = !Number.isNaN(parsedSpeed) ? parsedSpeed : "";

    if (isCityMode) {
      rows.push({
        rank: rank,
        city: formatCityLocation(countryCell, link),
        download_mbps: downloadMbps,
        rank_change: change,
        "yyyy-mm": ""
      });
    } else {
      rows.push({
        rank: rank,
        country: link.textContent.replace(/\s+/g, " ").trim(),
        download_mbps: downloadMbps,
        rank_change: change,
        "yyyy-mm": ""
      });
    }
  });

  rows.sort((a, b) => {
    const rankA = typeof a.rank === "number" ? a.rank : 9999;
    const rankB = typeof b.rank === "number" ? b.rank : 9999;
    return rankA - rankB;
  });

  return rows;
}

function scrapeSpeedtestData() {
  const mobileCountryRows = extractRankingTable("column-mobileMedian", "#mobile", "country");
  const fixedCountryRows = extractRankingTable("column-fixedMedian", "#fixed", "country");
  const mobileCityRows = extractRankingTable("column-mobileMedian", "#mobile", "city");
  const fixedCityRows = extractRankingTable("column-fixedMedian", "#fixed", "city");
  const yyyyMm = parseYearMonth();

  for (const list of [mobileCountryRows, fixedCountryRows, mobileCityRows, fixedCityRows]) {
    list.forEach((r) => {
      r["yyyy-mm"] = yyyyMm;
    });
  }

  return {
    mobile_country: mobileCountryRows,
    fixed_country: fixedCountryRows,
    mobile_city: mobileCityRows,
    fixed_city: fixedCityRows,
    yearMonth: yyyyMm,
    dataPeriod: yyyyMm,
    scrapedAt: new Date().toISOString(),
    pageTitle: typeof document !== "undefined" ? document.title : "",
    url: typeof window !== "undefined" && window.location ? window.location.href : ""
  };
}

// Global exposure for scripting execution
if (typeof window !== "undefined") {
  window.__scrapeSpeedtestData = scrapeSpeedtestData;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    formatCityLocation,
    extractRankingTable,
    scrapeSpeedtestData,
    parseYearMonth
  };
}

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
