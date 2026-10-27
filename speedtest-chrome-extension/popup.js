/**
 * Speedtest Global Index Scraper - Popup Controller
 */

let scrapedData = {
  mobile: [],
  fixed: [],
  yearMonth: ""
};

let activeCategory = "mobile"; // 'mobile' or 'fixed'
let searchQuery = "";

// DOM Elements
const btnScrape = document.getElementById("btnScrape");
const btnOpenPage = document.getElementById("btnOpenPage");
const btnExportMobile = document.getElementById("btnExportMobile");
const btnExportFixed = document.getElementById("btnExportFixed");
const btnExportExcel = document.getElementById("btnExportExcel");

const tabMobile = document.getElementById("tabMobile");
const tabFixed = document.getElementById("tabFixed");
const countMobile = document.getElementById("countMobile");
const countFixed = document.getElementById("countFixed");

const metricTotal = document.getElementById("metricTotal");
const metricTop = document.getElementById("metricTop");
const metricTopSpeed = document.getElementById("metricTopSpeed");
const metricAvg = document.getElementById("metricAvg");

const searchInput = document.getElementById("searchInput");
const tableBody = document.getElementById("tableBody");
const emptyState = document.getElementById("emptyState");
const statusBadge = document.getElementById("statusBadge");
const statusText = document.getElementById("statusText");
const timestampText = document.getElementById("timestampText");

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
 * Update UI Status Badge
 */
function setStatus(type, message) {
  statusBadge.className = `status-badge ${type}`;
  statusText.textContent = message;
}

/**
 * Convert rows to CSV string with yyyy-mm column
 */
function generateCSV(rows) {
  const headers = ["rank", "country", "download_mbps", "rank_change", "yyyy-mm"];
  const csvLines = [headers.join(",")];

  rows.forEach((r) => {
    const countryEscaped = r.country.includes(",") || r.country.includes('"')
      ? `"${r.country.replace(/"/g, '""')}"`
      : r.country;
    const yyyyMm = (r["yyyy-mm"] || "").includes(",")
      ? `"${r["yyyy-mm"]}"`
      : (r["yyyy-mm"] || "");
    
    csvLines.push(`${r.rank},${countryEscaped},${r.download_mbps},${r.rank_change},${yyyyMm}`);
  });

  return csvLines.join("\n");
}

/**
 * Download CSV File using HTML5 Blob link download (guarantees exact filename like mobile_030826.csv)
 */
function downloadCSV(rows, prefix) {
  if (!rows || rows.length === 0) return;

  const csvContent = generateCSV(rows);
  const dateStr = getDateString(); // e.g. "030826"
  const filename = `${prefix}_${dateStr}.csv`;

  // Create Blob with UTF-8 BOM (\uFEFF) for Excel compatibility
  const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
  const blobUrl = URL.createObjectURL(blob);

  // HTML5 anchor element guarantees Chrome respects the download filename attribute
  const a = document.createElement("a");
  a.style.display = "none";
  a.href = blobUrl;
  a.download = filename;

  document.body.appendChild(a);
  a.click();

  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(blobUrl);
  }, 1000);
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

/**
 * Build OpenXML worksheet XML from rows with yyyy-mm column
 */
function buildSheetXml(rows) {
  const headers = ["rank", "country", "download_mbps", "rank_change", "yyyy-mm"];
  const cols = ["A", "B", "C", "D", "E"];
  const xmlRows = [];

  const headerCells = headers
    .map((h, i) => `<c r="${cols[i]}1" t="inlineStr"><is><t>${escapeXml(h)}</t></is></c>`)
    .join("");
  xmlRows.push(`<row r="1">${headerCells}</row>`);

  rows.forEach((r, idx) => {
    const rowNum = idx + 2;
    const values = [r.rank, r.country, r.download_mbps, r.rank_change, r["yyyy-mm"] || ""];
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
    lv.setUint32(0, 0x04034b50, true); // Local file header signature
    lv.setUint16(4, 20, true);         // Version needed to extract
    lv.setUint16(6, 0, true);          // Flags
    lv.setUint16(8, 0, true);          // Compression method (0 = store)
    lv.setUint16(10, 0, true);         // Mod time
    lv.setUint16(12, 0, true);         // Mod date
    lv.setUint32(14, crc, true);       // CRC-32
    lv.setUint32(18, size, true);      // Compressed size
    lv.setUint32(22, size, true);      // Uncompressed size
    lv.setUint16(26, nameBytes.length, true); // File name length
    lv.setUint16(28, 0, true);         // Extra field length
    localHeader.set(nameBytes, 30);

    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(centralHeader.buffer);
    cv.setUint32(0, 0x02014b50, true); // Central directory signature
    cv.setUint16(4, 20, true);         // Version made by
    cv.setUint16(6, 20, true);         // Version needed
    cv.setUint16(8, 0, true);          // Flags
    cv.setUint16(10, 0, true);         // Compression method (0 = store)
    cv.setUint16(12, 0, true);         // Mod time
    cv.setUint16(14, 0, true);         // Mod date
    cv.setUint32(16, crc, true);       // CRC-32
    cv.setUint32(20, size, true);      // Compressed size
    cv.setUint24 ? cv.setUint24 : null;
    cv.setUint32(24, size, true);      // Uncompressed size
    cv.setUint16(28, nameBytes.length, true); // File name length
    cv.setUint16(30, 0, true);         // Extra field length
    cv.setUint16(32, 0, true);         // File comment length
    cv.setUint16(34, 0, true);         // Disk number
    cv.setUint16(36, 0, true);         // Internal attributes
    cv.setUint32(38, 0, true);         // External attributes
    cv.setUint32(42, offset, true);    // Relative offset of local header
    centralHeader.set(nameBytes, 46);

    localParts.push(localHeader, dataBytes);
    centralParts.push(centralHeader);
    offset += localHeader.length + dataBytes.length;
  }

  const centralSize = centralParts.reduce((s, p) => s + p.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  const count = centralParts.length;
  ev.setUint32(0, 0x06054b50, true); // End of central directory signature
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
 * Download combined Excel (.xlsx) file with 2 sheets: mobile, fixed
 */
function downloadExcel(mobileRows, fixedRows) {
  if ((!mobileRows || mobileRows.length === 0) && (!fixedRows || fixedRows.length === 0)) {
    return;
  }

  const files = {
    "[Content_Types].xml":
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
      `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
      `<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
      `</Types>`,
    "_rels/.rels":
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
      `</Relationships>`,
    "xl/workbook.xml":
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
      `<sheets>` +
      `<sheet name="mobile" sheetId="1" r:id="rId1"/>` +
      `<sheet name="fixed" sheetId="2" r:id="rId2"/>` +
      `</sheets>` +
      `</workbook>`,
    "xl/_rels/workbook.xml.rels":
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
      `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>` +
      `</Relationships>`,
    "xl/worksheets/sheet1.xml": buildSheetXml(mobileRows || []),
    "xl/worksheets/sheet2.xml": buildSheetXml(fixedRows || [])
  };

  const xlsxBytes = createZip(files);
  const dateStr = getDateString();
  const filename = `speedtest_${dateStr}.xlsx`;

  const blob = new Blob([xlsxBytes], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  });
  const blobUrl = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.style.display = "none";
  a.href = blobUrl;
  a.download = filename;

  document.body.appendChild(a);
  a.click();

  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(blobUrl);
  }, 1000);
}

/**
 * Render Data Table & Summary Metrics
 */
function renderTable() {
  const dataset = scrapedData[activeCategory] || [];
  
  // Filter dataset by search query
  const filtered = dataset.filter((item) =>
    item.country.toLowerCase().includes(searchQuery.toLowerCase())
  );

  countMobile.textContent = scrapedData.mobile.length;
  countFixed.textContent = scrapedData.fixed.length;
  const hasAnyData = scrapedData.mobile.length > 0 || scrapedData.fixed.length > 0;

  if (dataset.length === 0) {
    tableBody.innerHTML = "";
    emptyState.style.display = "flex";
    metricTotal.textContent = "-";
    metricTop.textContent = "-";
    metricTopSpeed.textContent = "";
    metricAvg.textContent = "-";
    searchInput.disabled = true;
    btnExportMobile.disabled = scrapedData.mobile.length === 0;
    btnExportFixed.disabled = scrapedData.fixed.length === 0;
    btnExportExcel.disabled = !hasAnyData;
    return;
  }

  emptyState.style.display = "none";
  searchInput.disabled = false;
  btnExportMobile.disabled = scrapedData.mobile.length === 0;
  btnExportFixed.disabled = scrapedData.fixed.length === 0;
  btnExportExcel.disabled = !hasAnyData;

  // Calculate Metrics
  metricTotal.textContent = dataset.length;
  const topRanked = dataset[0];
  if (topRanked) {
    metricTop.textContent = topRanked.country;
    metricTopSpeed.textContent = `${topRanked.download_mbps} Mbps`;
  }

  const validSpeeds = dataset.filter(r => typeof r.download_mbps === 'number');
  if (validSpeeds.length > 0) {
    const avgSpeed = validSpeeds.reduce((sum, r) => sum + r.download_mbps, 0) / validSpeeds.length;
    metricAvg.textContent = `${avgSpeed.toFixed(2)} Mbps`;
  } else {
    metricAvg.textContent = "-";
  }

  // Render Table Rows
  tableBody.innerHTML = filtered.map((r) => {
    let changeClass = "neutral";
    let changeDisplay = "0";
    if (r.rank_change && r.rank_change !== "0") {
      if (r.rank_change.startsWith("+")) {
        changeClass = "positive";
        changeDisplay = r.rank_change;
      } else if (r.rank_change.startsWith("-")) {
        changeClass = "negative";
        changeDisplay = r.rank_change;
      } else {
        changeDisplay = r.rank_change;
      }
    }

    return `
      <tr>
        <td class="col-rank">#${r.rank}</td>
        <td class="col-country">${escapeHtml(r.country)}</td>
        <td class="col-speed">${r.download_mbps ? r.download_mbps.toFixed(2) : '-'}</td>
        <td class="col-change">
          <span class="change-badge ${changeClass}">${changeDisplay}</span>
        </td>
      </tr>
    `;
  }).join("");
}

function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Trigger DOM Scraping on Active Speedtest Tab
 */
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
      alert("Please navigate to https://www.speedtest.net/global-index before scraping!");
      btnScrape.disabled = false;
      return;
    }

    // Always inject the latest content.js script directly into the tab first
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
      // Fallback: try messaging content script
      chrome.tabs.sendMessage(tab.id, { action: "SCRAPE_DATA" }, (response) => {
        if (response && response.success) {
          handleScrapedResult(response.data);
        } else {
          setStatus("error", "Failed");
          alert(`Scraping failed: ${injectErr.message || "Unknown error"}`);
        }
      });
    }

  } catch (err) {
    setStatus("error", "Error");
    alert(`Scraping error: ${err.message}`);
  } finally {
    btnScrape.disabled = false;
  }
}

function handleScrapedResult(data) {
  scrapedData.mobile = data.mobile || [];
  scrapedData.fixed = data.fixed || [];
  scrapedData.yearMonth = data.yearMonth || data.dataPeriod || "";

  // Stamp each row with yyyy-mm so it appears in CSV/Excel
  const ym = scrapedData.yearMonth;
  scrapedData.mobile.forEach(r => { r["yyyy-mm"] = ym; });
  scrapedData.fixed.forEach(r => { r["yyyy-mm"] = ym; });

  const totalCount = scrapedData.mobile.length + scrapedData.fixed.length;
  if (totalCount === 0) {
    setStatus("error", "No data found");
    alert("No data tables found on page. Make sure the page is fully loaded.");
    return;
  }

  setStatus("ready", `Scraped (${totalCount})`);
  const periodLabel = ym ? ` · ${ym}` : "";
  timestampText.textContent = `Scraped at ${new Date().toLocaleTimeString()}${periodLabel}`;
  renderTable();
}

// Event Listeners
btnScrape.addEventListener("click", triggerScrape);

btnOpenPage.addEventListener("click", () => {
  chrome.tabs.create({ url: "https://www.speedtest.net/global-index" });
});

btnExportMobile.addEventListener("click", () => {
  downloadCSV(scrapedData.mobile, "mobile");
});

btnExportFixed.addEventListener("click", () => {
  downloadCSV(scrapedData.fixed, "fixed");
});

btnExportExcel.addEventListener("click", () => {
  downloadExcel(scrapedData.mobile, scrapedData.fixed);
});

tabMobile.addEventListener("click", () => {
  activeCategory = "mobile";
  tabMobile.classList.add("active");
  tabFixed.classList.remove("active");
  renderTable();
});

tabFixed.addEventListener("click", () => {
  activeCategory = "fixed";
  tabFixed.classList.add("active");
  tabMobile.classList.remove("active");
  renderTable();
});

searchInput.addEventListener("input", (e) => {
  searchQuery = e.target.value;
  renderTable();
});

// Auto-check active tab on load
document.addEventListener("DOMContentLoaded", async () => {
  if (typeof chrome !== "undefined" && chrome.tabs) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url && tab.url.includes("speedtest.net/global-index")) {
      setStatus("ready", "Ready to scrape");
    } else {
      setStatus("idle", "Not on Speedtest");
    }
  }
});
