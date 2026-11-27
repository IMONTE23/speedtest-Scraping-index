/**
 * Speedtest Global Index Scraper - Minimal Fast Popup Controller
 */

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function getDateString() {
  const d = new Date();
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = String(d.getFullYear()).slice(-2);
  return `${day}${month}${year}`;
}

function escapeXml(val) {
  return String(val ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function buildSheetXml(rows, locationKey = "country") {
  const headers = ["rank", locationKey, "download_mbps", "rank_change", "yyyy-mm"];
  const cols = ["A", "B", "C", "D", "E"];
  const xmlRows = new Array((rows ? rows.length : 0) + 1);

  let headerCells = "";
  for (let i = 0; i < headers.length; i++) {
    headerCells += `<c r="${cols[i]}1" t="inlineStr"><is><t>${escapeXml(headers[i])}</t></is></c>`;
  }
  xmlRows[0] = `<row r="1">${headerCells}</row>`;

  if (rows) {
    for (let idx = 0; idx < rows.length; idx++) {
      const r = rows[idx];
      const rowNum = idx + 2;
      const values = [r.rank, r[locationKey] ?? "", r.download_mbps, r.rank_change, r["yyyy-mm"] || ""];
      let rowCells = "";
      for (let i = 0; i < 5; i++) {
        const v = values[i];
        const ref = `${cols[i]}${rowNum}`;
        if (typeof v === "number" && Number.isFinite(v)) {
          rowCells += `<c r="${ref}"><v>${v}</v></c>`;
        } else {
          rowCells += `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(v)}</t></is></c>`;
        }
      }
      xmlRows[idx + 1] = `<row r="${rowNum}">${rowCells}</row>`;
    }
  }

  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetData>${xmlRows.join("")}</sheetData>` +
    `</worksheet>`
  );
}

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC32_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

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

  const out = new Uint8Array(offset + centralSize + eocd.length);
  let pos = 0;
  for (const part of [...localParts, ...centralParts, eocd]) {
    out.set(part, pos);
    pos += part.length;
  }
  return out;
}

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

  for (let i = 0; i < sheets.length; i++) {
    files[`xl/worksheets/sheet${i + 1}.xml`] = buildSheetXml(sheets[i].rows, sheets[i].key);
  }

  return files;
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

  const btnOpenPage = doc.getElementById("btnOpenPage");
  const btnScrape = doc.getElementById("btnScrape");
  const btnExportExcel = doc.getElementById("btnExportExcel");
  const statusBadge = doc.getElementById("statusBadge");
  const statusText = doc.getElementById("statusText");
  const summaryText = doc.getElementById("summaryText");

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
    const filename = `speedtest_${getDateString()}.xlsx`;

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

  function handleScrapedResult(data) {
    scrapedData.mobile_country = data.mobile_country || [];
    scrapedData.fixed_country = data.fixed_country || [];
    scrapedData.mobile_city = data.mobile_city || [];
    scrapedData.fixed_city = data.fixed_city || [];
    scrapedData.yearMonth = data.yearMonth || data.dataPeriod || "";

    const ym = scrapedData.yearMonth;
    for (const key of CATEGORY_KEYS) {
      for (let i = 0; i < scrapedData[key].length; i++) {
        scrapedData[key][i]["yyyy-mm"] = ym;
      }
    }

    const totalCount = CATEGORY_KEYS.reduce((sum, key) => sum + scrapedData[key].length, 0);
    btnExportExcel.disabled = totalCount === 0;

    if (totalCount === 0) {
      setStatus("error", "No data");
      summaryText.textContent = "No ranking tables found on this page.";
      alertFn("No data tables found on page. Make sure https://www.speedtest.net/global-index is loaded.");
      return;
    }

    setStatus("ready", `Ready (${totalCount})`);
    const periodPrefix = ym ? `${ym} · ` : "";
    summaryText.textContent =
      `${periodPrefix}Country: ${scrapedData.mobile_country.length}M / ${scrapedData.fixed_country.length}F · ` +
      `City: ${scrapedData.mobile_city.length}M / ${scrapedData.fixed_city.length}F`;
  }

  async function triggerScrape() {
    setStatus("idle", "Scraping...");
    btnScrape.disabled = true;

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (!tab || !tab.url || !tab.url.includes("speedtest.net/global-index")) {
        setStatus("error", "Wrong page");
        summaryText.textContent = "Open https://www.speedtest.net/global-index first.";
        alertFn("Please navigate to https://www.speedtest.net/global-index before scraping!");
        return;
      }

      const [execResult] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content.js"],
        injectImmediately: true
      });

      if (execResult && execResult.result) {
        handleScrapedResult(execResult.result);
      } else {
        throw new Error("Failed to extract DOM data from Speedtest page");
      }
    } catch (err) {
      setStatus("error", "Error");
      alertFn(`Scraping error: ${err.message}`);
    } finally {
      btnScrape.disabled = false;
    }
  }

  if (btnOpenPage) {
    btnOpenPage.addEventListener("click", () => {
      chrome.tabs.create({ url: "https://www.speedtest.net/global-index" });
    });
  }
  btnScrape.addEventListener("click", triggerScrape);
  btnExportExcel.addEventListener("click", () => downloadExcel(scrapedData));

  doc.addEventListener("DOMContentLoaded", async () => {
    if (typeof chrome !== "undefined" && chrome.tabs) {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && tab.url && tab.url.includes("speedtest.net/global-index")) {
        setStatus("ready", "Ready");
      } else {
        setStatus("idle", "Not on page");
      }
    }
  });

  return { triggerScrape, handleScrapedResult };
}

if (typeof document !== "undefined") {
  initPopupController(document);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    buildSheetXml,
    buildWorkbookFiles,
    createZip,
    escapeXml,
    crc32,
    initPopupController
  };
}
