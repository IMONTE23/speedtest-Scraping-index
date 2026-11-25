/**
 * Speedtest Global Index Scraper - Popup Controller
 */

/**
 * Format current date as DDMMYY string (e.g. "030826")
 */
function getDateString() {
  const d = new Date();
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = String(d.getFullYear()).slice(-2);
  return `${day}${month}${year}`;
}

/**
 * Return UI and schema metadata for a given category key
 */
function getCategoryMeta(category) {
  const isCity = String(category || "").endsWith("_city");
  return {
    isCity,
    locationKey: isCity ? "city" : "country",
    totalLabel: isCity ? "Total Cities" : "Total Countries",
    topLabel: isCity ? "#1 Rank City" : "#1 Rank Country",
    headerLabel: isCity ? "City" : "Country",
    placeholder: isCity ? "Search city or country..." : "Search country name..."
  };
}

/**
 * Escape XML special characters
 */
function escapeXml(val) {
  return String(val ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Build OpenXML worksheet XML from rows with locationKey ('country' or 'city') and yyyy-mm column
 */
function buildSheetXml(rows, locationKey = "country") {
  const headers = ["rank", locationKey, "download_mbps", "rank_change", "yyyy-mm"];
  const cols = ["A", "B", "C", "D", "E"];
  const xmlRows = [];

  const headerCells = headers
    .map((h, i) => `<c r="${cols[i]}1" t="inlineStr"><is><t>${escapeXml(h)}</t></is></c>`)
    .join("");
  xmlRows.push(`<row r="1">${headerCells}</row>`);

  (rows || []).forEach((r, idx) => {
    const rowNum = idx + 2;
    const values = [r.rank, r[locationKey] ?? "", r.download_mbps, r.rank_change, r["yyyy-mm"] || ""];
    const cells = values
      .map((v, i) => {
        const ref = `${cols[i]}${rowNum}`;
        if (typeof v === "number" && !Number.isNaN(v)) {
          return `<c r="${ref}"><v>${v}</v></c>`;
        }
        return `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(v)}</t></is></c>`;
      })
      .join("");
    xmlRows.push(`<row r="${rowNum}">${cells}</row>`);
  });

  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetData>${xmlRows.join("")}</sheetData>` +
    `</worksheet>`
  );
}

/**
 * Compute CRC32 for Uint8Array
 */
function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c ^= bytes[i];
    for (let k = 0; k < 8; k++) {
      c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Create an uncompressed ZIP archive (Uint8Array) from a map of filename -> string content
 */
function createZip(files) {
  const encoder = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const [name, content] of Object.entries(files)) {
    const nameBytes = encoder.encode(name);
    const dataBytes = encoder.encode(content);
    const crc = crc32(dataBytes);
    const size = dataBytes.length;

    const localHeader = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(localHeader.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0, true);
    lv.setUint16(8, 0, true);
    lv.setUint16(10, 0, true);
    lv.setUint16(12, 0, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true);
    lv.setUint32(22, size, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    localHeader.set(nameBytes, 30);

    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(centralHeader.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);
    centralHeader.set(nameBytes, 46);

    localParts.push(localHeader, dataBytes);
    centralParts.push(centralHeader);
    offset += localHeader.length + dataBytes.length;
  }

  const centralSize = centralParts.reduce((s, p) => s + p.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  const count = centralParts.length;
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, count, true);
  ev.setUint16(10, count, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true);

  const totalSize = offset + centralSize + eocd.length;
  const out = new Uint8Array(totalSize);
  let pos = 0;
  for (const part of [...localParts, ...centralParts, eocd]) {
    out.set(part, pos);
    pos += part.length;
  }
  return out;
}

/**
 * Build OpenXML file map for 4 sheets: mobile_country, fixed_country, mobile_city, fixed_city
 */
function buildWorkbookFiles(data) {
  const sheets = [
    { name: "mobile_country", rows: data.mobile_country || [], key: "country" },
    { name: "fixed_country", rows: data.fixed_country || [], key: "country" },
    { name: "mobile_city", rows: data.mobile_city || [], key: "city" },
    { name: "fixed_city", rows: data.fixed_city || [], key: "city" }
  ];

  const overrides = sheets
    .map(
      (_, i) =>
        `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
    )
    .join("");

  const sheetDefs = sheets
    .map((s, i) => `<sheet name="${s.name}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
    .join("");

  const relDefs = sheets
    .map(
      (_, i) =>
        `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`
    )
    .join("");

  const files = {
    "[Content_Types].xml":
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
      overrides +
      `</Types>`,
    "_rels/.rels":
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
      `</Relationships>`,
    "xl/workbook.xml":
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
      `<sheets>${sheetDefs}</sheets>` +
      `</workbook>`,
    "xl/_rels/workbook.xml.rels":
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      relDefs +
      `</Relationships>`
  };

  sheets.forEach((s, i) => {
    files[`xl/worksheets/sheet${i + 1}.xml`] = buildSheetXml(s.rows, s.key);
  });

  return files;
}

/**
 * Render a single table row with escaped values
 */
function renderRowHtml(r, locationKey = "country") {
  let changeClass = "neutral";
  let changeDisplay = "0";
  const rawChange = String(r.rank_change ?? "");
  if (rawChange && rawChange !== "0") {
    if (rawChange.startsWith("+")) {
      changeClass = "positive";
      changeDisplay = rawChange;
    } else if (rawChange.startsWith("-")) {
      changeClass = "negative";
      changeDisplay = rawChange;
    } else {
      changeDisplay = rawChange;
    }
  }

  const speedDisplay = Number.isFinite(r.download_mbps) ? r.download_mbps.toFixed(2) : "-";

  return `
          <tr>
            <td class="col-rank">#${escapeHtml(r.rank)}</td>
            <td class="col-country">${escapeHtml(r[locationKey] || "")}</td>
            <td class="col-speed">${speedDisplay}</td>
            <td class="col-change">
              <span class="change-badge ${changeClass}">${escapeHtml(changeDisplay)}</span>
            </td>
          </tr>
        `;
}

function initPopupController(doc, alertFn = (msg) => alert(msg)) {
  const CATEGORY_KEYS = ["mobile_country", "fixed_country", "mobile_city", "fixed_city"];

  let scrapedData = {
    mobile_country: [],
    fixed_country: [],
    mobile_city: [],
    fixed_city: [],
    yearMonth: ""
  };

  let activeCategory = "mobile_country";
  let searchQuery = "";

  const btnScrape = doc.getElementById("btnScrape");
  const btnOpenPage = doc.getElementById("btnOpenPage");
  const btnExportExcel = doc.getElementById("btnExportExcel");

  const tabButtons = {
    mobile_country: doc.getElementById("tabMobileCountry"),
    fixed_country: doc.getElementById("tabFixedCountry"),
    mobile_city: doc.getElementById("tabMobileCity"),
    fixed_city: doc.getElementById("tabFixedCity")
  };

  const countBadges = {
    mobile_country: doc.getElementById("countMobileCountry"),
    fixed_country: doc.getElementById("countFixedCountry"),
    mobile_city: doc.getElementById("countMobileCity"),
    fixed_city: doc.getElementById("countFixedCity")
  };

  const metricTotalLabel = doc.getElementById("metricTotalLabel");
  const metricTopLabel = doc.getElementById("metricTopLabel");
  const metricTotal = doc.getElementById("metricTotal");
  const metricTop = doc.getElementById("metricTop");
  const metricTopSpeed = doc.getElementById("metricTopSpeed");
  const metricAvg = doc.getElementById("metricAvg");

  const colLocationHeader = doc.getElementById("colLocationHeader");
  const searchInput = doc.getElementById("searchInput");
  const tableBody = doc.getElementById("tableBody");
  const emptyState = doc.getElementById("emptyState");
  const statusBadge = doc.getElementById("statusBadge");
  const statusText = doc.getElementById("statusText");
  const timestampText = doc.getElementById("timestampText");

  function setStatus(type, message) {
    statusBadge.className = `status-badge ${type}`;
    statusText.textContent = message;
  }

  function hasAnyScrapedData(data) {
    return CATEGORY_KEYS.some((key) => Array.isArray(data[key]) && data[key].length > 0);
  }

  function downloadExcel(data) {
    if (!hasAnyScrapedData(data)) return;

    const files = buildWorkbookFiles(data);
    const xlsxBytes = createZip(files);
    const dateStr = getDateString();
    const filename = `speedtest_${dateStr}.xlsx`;

    const blob = new Blob([xlsxBytes], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    });
    const blobUrl = URL.createObjectURL(blob);

    const a = doc.createElement("a");
    a.style.display = "none";
    a.href = blobUrl;
    a.download = filename;

    doc.body.appendChild(a);
    a.click();

    setTimeout(() => {
      doc.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    }, 1000);
  }

  function renderTable() {
    const dataset = scrapedData[activeCategory] || [];
    const meta = getCategoryMeta(activeCategory);

    metricTotalLabel.textContent = meta.totalLabel;
    metricTopLabel.textContent = meta.topLabel;
    colLocationHeader.textContent = meta.headerLabel;
    searchInput.placeholder = meta.placeholder;

    for (const key of CATEGORY_KEYS) {
      countBadges[key].textContent = (scrapedData[key] || []).length;
    }

    const hasAnyData = hasAnyScrapedData(scrapedData);
    btnExportExcel.disabled = !hasAnyData;

    const filtered = dataset.filter((item) =>
      String(item[meta.locationKey] || "")
        .toLowerCase()
        .includes(searchQuery.toLowerCase())
    );

    if (dataset.length === 0) {
      tableBody.innerHTML = "";
      emptyState.style.display = "flex";
      metricTotal.textContent = "-";
      metricTop.textContent = "-";
      metricTopSpeed.textContent = "";
      metricAvg.textContent = "-";
      searchInput.disabled = true;
      return;
    }

    emptyState.style.display = "none";
    searchInput.disabled = false;

    metricTotal.textContent = dataset.length;
    const topRanked = dataset[0];
    if (topRanked) {
      metricTop.textContent = topRanked[meta.locationKey] || "-";
      metricTopSpeed.textContent = Number.isFinite(topRanked.download_mbps)
        ? `${topRanked.download_mbps} Mbps`
        : "";
    }

    const validSpeeds = dataset.filter((r) => Number.isFinite(r.download_mbps));
    if (validSpeeds.length > 0) {
      const avgSpeed = validSpeeds.reduce((sum, r) => sum + r.download_mbps, 0) / validSpeeds.length;
      metricAvg.textContent = `${avgSpeed.toFixed(2)} Mbps`;
    } else {
      metricAvg.textContent = "-";
    }

    tableBody.innerHTML = filtered.map((r) => renderRowHtml(r, meta.locationKey)).join("");
  }

  async function triggerScrape() {
    setStatus("idle", "Scraping...");
    btnScrape.disabled = true;

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (!tab) {
        throw new Error("No active tab found");
      }

      if (!tab.url || !tab.url.includes("speedtest.net/global-index")) {
        setStatus("error", "Not on Speedtest page");
        alertFn("Please navigate to https://www.speedtest.net/global-index before scraping!");
        return;
      }

      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ["content.js"]
        });

        const [execResult] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => (window.__scrapeSpeedtestData ? window.__scrapeSpeedtestData() : null)
        });

        if (execResult && execResult.result) {
          handleScrapedResult(execResult.result);
        } else {
          throw new Error("Failed to extract DOM data from Speedtest page");
        }
      } catch (injectErr) {
        chrome.tabs.sendMessage(tab.id, { action: "SCRAPE_DATA" }, (response) => {
          if (response && response.success) {
            handleScrapedResult(response.data);
          } else {
            setStatus("error", "Failed");
            alertFn(`Scraping failed: ${injectErr.message || "Unknown error"}`);
          }
        });
      }
    } catch (err) {
      setStatus("error", "Error");
      alertFn(`Scraping error: ${err.message}`);
    } finally {
      btnScrape.disabled = false;
    }
  }

  function handleScrapedResult(data) {
    scrapedData.mobile_country = data.mobile_country || data.mobile || [];
    scrapedData.fixed_country = data.fixed_country || data.fixed || [];
    scrapedData.mobile_city = data.mobile_city || [];
    scrapedData.fixed_city = data.fixed_city || [];
    scrapedData.yearMonth = data.yearMonth || data.dataPeriod || "";

    const ym = scrapedData.yearMonth;
    for (const key of CATEGORY_KEYS) {
      scrapedData[key].forEach((r) => {
        r["yyyy-mm"] = ym;
      });
    }

    const totalCount = CATEGORY_KEYS.reduce((sum, key) => sum + scrapedData[key].length, 0);
    if (totalCount === 0) {
      renderTable();
      setStatus("error", "No data found");
      alertFn("No data tables found on page. Make sure the page is fully loaded.");
      return;
    }

    setStatus("ready", `Scraped (${totalCount})`);
    const periodLabel = ym ? ` · ${ym}` : "";
    timestampText.textContent = `Scraped at ${new Date().toLocaleTimeString()}${periodLabel}`;
    renderTable();
  }

  btnScrape.addEventListener("click", triggerScrape);

  btnOpenPage.addEventListener("click", () => {
    chrome.tabs.create({ url: "https://www.speedtest.net/global-index" });
  });

  btnExportExcel.addEventListener("click", () => {
    downloadExcel(scrapedData);
  });

  for (const [key, btn] of Object.entries(tabButtons)) {
    btn.addEventListener("click", () => {
      activeCategory = key;
      for (const [otherKey, otherBtn] of Object.entries(tabButtons)) {
        otherBtn.classList.toggle("active", otherKey === key);
      }
      renderTable();
    });
  }

  searchInput.addEventListener("input", (e) => {
    searchQuery = e.target.value;
    renderTable();
  });

  doc.addEventListener("DOMContentLoaded", async () => {
    if (typeof chrome !== "undefined" && chrome.tabs) {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && tab.url && tab.url.includes("speedtest.net/global-index")) {
        setStatus("ready", "Ready to scrape");
      } else {
        setStatus("idle", "Not on Speedtest");
      }
    }
  });

  return { handleScrapedResult, renderTable };
}

if (typeof document !== "undefined") {
  initPopupController(document);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    getCategoryMeta,
    buildSheetXml,
    buildWorkbookFiles,
    createZip,
    escapeXml,
    renderRowHtml,
    initPopupController
  };
}
