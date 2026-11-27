/**
 * Speedtest Global Index Scraper - On-Demand Content Script
 * Wrapped in an IIFE so repeated chrome.scripting.executeScript injections
 * never collide on top-level identifiers and return scraped data in 1 call.
 */
(function () {
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

  const PERIOD_REGEX =
    /(?:Updated\s+)?(January|February|March|April|May|June|July|August|September|October|November|December)\s+(20\d{2})/i;

  const MINOR_WORDS = new Set(["of", "and", "the", "in"]);

  function formatYearMonth(monthStr, yearStr) {
    if (!monthStr || !yearStr) return "";
    const m = MONTH_MAP[monthStr.trim().toLowerCase()];
    if (!m) return "";
    return `${yearStr.trim()}-${m}`;
  }

  /**
   * Fast data period extraction ("YYYY-MM") without layout reflow (never reads innerText or innerHTML).
   */
  function parseYearMonth() {
    const measureEl = document.getElementById("measureLocationId");
    if (measureEl && measureEl.textContent) {
      const m = measureEl.textContent.match(PERIOD_REGEX);
      if (m) return formatYearMonth(m[1], m[2]);
    }

    const titleEl = document.querySelector(".page-header-title");
    if (titleEl && titleEl.textContent) {
      const m = titleEl.textContent.match(PERIOD_REGEX);
      if (m) return formatYearMonth(m[1], m[2]);
    }

    const headings = document.querySelectorAll("h1, h2, h3, h4");
    for (let i = 0; i < headings.length; i++) {
      const text = headings[i].textContent;
      if (text && text.length < 250) {
        const m = text.match(PERIOD_REGEX);
        if (m) return formatYearMonth(m[1], m[2]);
      }
    }

    if (document.body && document.body.textContent) {
      const m = document.body.textContent.match(PERIOD_REGEX);
      if (m) return formatYearMonth(m[1], m[2]);
    }

    return "";
  }

  function parseRankChange(changeCell) {
    if (!changeCell) return "";
    const tooltip = changeCell.querySelector("span.tooltip");
    if (!tooltip) return "";
    if (tooltip.classList.contains("neutral")) return "0";
    return tooltip.textContent.trim();
  }

  function titleCaseSlug(slug) {
    return slug
      .split("-")
      .filter(Boolean)
      .map((word, idx) => {
        const lower = word.toLowerCase();
        if (idx > 0 && MINOR_WORDS.has(lower)) return lower;
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
      } catch (_) {}
      const countryName = titleCaseSlug(rawSlug);
      if (countryName && linkText) {
        return `${linkText}, ${countryName}`;
      }
    }

    return fullText || linkText;
  }

  function sortByRank(rows) {
    rows.sort((a, b) => {
      const rankA = typeof a.rank === "number" ? a.rank : 9999;
      const rankB = typeof b.rank === "number" ? b.rank : 9999;
      return rankA - rankB;
    });
    return rows;
  }

  /**
   * Single-pass extraction of both Country and City rankings from one container.
   */
  function extractContainerTables(containerId, linkFragment, yyyyMm) {
    const container = containerId ? document.getElementById(containerId) : document;
    const countryRows = [];
    const cityRows = [];
    if (!container) return { country: countryRows, city: cityRows };

    const trElements = container.querySelectorAll("tr.data-result");
    for (let i = 0; i < trElements.length; i++) {
      const tr = trElements[i];
      const countryCell = tr.querySelector("td.country");
      if (!countryCell) continue;
      const link = countryCell.querySelector("a");
      if (!link) continue;

      const href = link.getAttribute("href") || "";
      if (linkFragment && !href.endsWith(linkFragment)) continue;

      const rankCell = tr.querySelector("td.actual-rank");
      const changeCell = tr.querySelector("td.rank-change");
      const speedCell = tr.querySelector("td.speed");

      const rawRank = rankCell ? rankCell.textContent.trim() : "";
      const rawSpeed = speedCell ? speedCell.textContent.trim().replace(/,/g, "") : "";
      const change = parseRankChange(changeCell);

      const rank = /^\d+$/.test(rawRank) ? parseInt(rawRank, 10) : rawRank;
      const parsedSpeed = rawSpeed ? parseFloat(rawSpeed) : NaN;
      const downloadMbps = Number.isFinite(parsedSpeed) ? parsedSpeed : "";

      if (href.includes("?city=")) {
        cityRows.push({
          rank: rank,
          city: formatCityLocation(countryCell, link),
          download_mbps: downloadMbps,
          rank_change: change,
          "yyyy-mm": yyyyMm
        });
      } else {
        countryRows.push({
          rank: rank,
          country: link.textContent.replace(/\s+/g, " ").trim(),
          download_mbps: downloadMbps,
          rank_change: change,
          "yyyy-mm": yyyyMm
        });
      }
    }

    return {
      country: sortByRank(countryRows),
      city: sortByRank(cityRows)
    };
  }

  function scrapeSpeedtestData() {
    const yyyyMm = parseYearMonth();
    const mobile = extractContainerTables("column-mobileMedian", "#mobile", yyyyMm);
    const fixed = extractContainerTables("column-fixedMedian", "#fixed", yyyyMm);

    return {
      mobile_country: mobile.country,
      fixed_country: fixed.country,
      mobile_city: mobile.city,
      fixed_city: fixed.city,
      yearMonth: yyyyMm,
      dataPeriod: yyyyMm,
      scrapedAt: new Date().toISOString(),
      pageTitle: typeof document !== "undefined" ? document.title : "",
      url: typeof window !== "undefined" && window.location ? window.location.href : ""
    };
  }

  if (typeof window !== "undefined") {
    window.__scrapeSpeedtestData = scrapeSpeedtestData;
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      formatCityLocation,
      extractContainerTables,
      scrapeSpeedtestData,
      parseYearMonth
    };
    return;
  }

  if (typeof document !== "undefined") {
    return scrapeSpeedtestData();
  }
})();
