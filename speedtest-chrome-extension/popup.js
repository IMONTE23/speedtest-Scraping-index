/**
 * Speedtest Global Index Scraper - Popup Controller
 */

let scrapedData = {
  mobile: [],
  fixed: []
};

let activeCategory = "mobile"; // 'mobile' or 'fixed'
let searchQuery = "";

// DOM Elements
const btnScrape = document.getElementById("btnScrape");
const btnOpenPage = document.getElementById("btnOpenPage");
const btnExportMobile = document.getElementById("btnExportMobile");
const btnExportFixed = document.getElementById("btnExportFixed");

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
 * Convert rows to CSV string
 */
function generateCSV(rows) {
  const headers = ["rank", "country", "download_mbps", "rank_change"];
  const csvLines = [headers.join(",")];

  rows.forEach((r) => {
    const countryEscaped = r.country.includes(",") || r.country.includes('"')
      ? `"${r.country.replace(/"/g, '""')}"`
      : r.country;
    
    csvLines.push(`${r.rank},${countryEscaped},${r.download_mbps},${r.rank_change}`);
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
    return;
  }

  emptyState.style.display = "none";
  searchInput.disabled = false;
  btnExportMobile.disabled = scrapedData.mobile.length === 0;
  btnExportFixed.disabled = scrapedData.fixed.length === 0;

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

    // Try messaging content script first
    chrome.tabs.sendMessage(tab.id, { action: "SCRAPE_DATA" }, async (response) => {
      if (chrome.runtime.lastError || !response || !response.success) {
        // Content script might not be injected yet, inject dynamically
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ["content.js"]
          });

          // Execute scraping function directly
          const [execResult] = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => window.__scrapeSpeedtestData ? window.__scrapeSpeedtestData() : null
          });

          if (execResult && execResult.result) {
            handleScrapedResult(execResult.result);
          } else {
            throw new Error("Failed to extract DOM data from Speedtest page");
          }
        } catch (err) {
          setStatus("error", "Failed");
          alert(`Scraping failed: ${err.message}`);
        }
      } else {
        handleScrapedResult(response.data);
      }
      btnScrape.disabled = false;
    });

  } catch (err) {
    setStatus("error", "Error");
    alert(`Scraping error: ${err.message}`);
    btnScrape.disabled = false;
  }
}

function handleScrapedResult(data) {
  scrapedData.mobile = data.mobile || [];
  scrapedData.fixed = data.fixed || [];

  const totalCount = scrapedData.mobile.length + scrapedData.fixed.length;
  if (totalCount === 0) {
    setStatus("error", "No data found");
    alert("No data tables found on page. Make sure the page is fully loaded.");
    return;
  }

  setStatus("ready", `Scraped (${totalCount})`);
  timestampText.textContent = `Scraped at ${new Date().toLocaleTimeString()}`;
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
