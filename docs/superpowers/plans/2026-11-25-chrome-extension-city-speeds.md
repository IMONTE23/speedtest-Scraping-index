# Chrome Extension City Speeds & 4-Sheet Excel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the Speedtest Global Index Chrome Extension to scrape both Country Speeds and City Speeds in one click, display all 4 datasets in a 4-tab popup UI, and export them into a single 4-sheet `.xlsx` workbook (removing CSV export buttons).

**Architecture:** `content.js` partitions `tr.data-result` rows inside `#column-mobileMedian` and `#column-fixedMedian` into Country rows (no `?city=`) and City rows (`?city=`), normalizing city labels to `"City, Country"`. `popup.html`, `styles.css`, and `popup.js` replace the 2-tab + CSV toolbar layout with a 2-button toolbar (`Scrape Page`, `Excel (4 Sheets)`), a 4-tab switcher, dynamic Country/City table/metric labels, and a 4-worksheet OpenXML ZIP builder.

**Tech Stack:** Vanilla JavaScript (Chrome Extension Manifest V3), HTML5, CSS3, Node.js built-in test runner (`node --test`) for unit verification.

**Spec:** `docs/superpowers/specs/2026-11-25-chrome-extension-city-speeds-design.md`

## Global Constraints

- Popup width remains `520px` (max-height `600px`) with all 4 tabs fitting on one horizontal row without wrapping.
- Manifest V3 with zero external runtime libraries; `.xlsx` is built in-memory via OpenXML + uncompressed ZIP (`createZip`).
- Toolbar contains only 2 action buttons: `Scrape Page` (`#btnScrape`) and `Excel (4 Sheets)` (`#btnExportExcel`); CSV export buttons are removed.
- Excel workbook (`speedtest_DDMMYY.xlsx`) contains 4 sheets in exact order:
  1. `mobile_country` — headers: `rank, country, download_mbps, rank_change, yyyy-mm`
  2. `fixed_country` — headers: `rank, country, download_mbps, rank_change, yyyy-mm`
  3. `mobile_city` — headers: `rank, city, download_mbps, rank_change, yyyy-mm`
  4. `fixed_city` — headers: `rank, city, download_mbps, rank_change, yyyy-mm`
- City names are stored in a single column formatted as `"City, Country"` (e.g., `"Bangkok, Thailand"`).
- Do not modify Python scripts outside `speedtest-chrome-extension/`.

## Review Focus

1. **City cell DOM variations (`td.country`):** Speedtest may render city and country inside `<a>Bangkok, Thailand</a>`, split across `<a>Bangkok</a><span>, Thailand</span>`, split without a comma `<a>Bangkok</a><span class="country-name">Thailand</span>`, or only have `<a>Bangkok</a>` with country slug in `href="/global-index/thailand?city=Bangkok#mobile"` — all must normalize cleanly to `"Bangkok, Thailand"` with no duplicate commas or whitespace artifacts.
2. **Thousands-separated speeds (`1,000+ Mbps`):** Speeds formatted like `"1,045.20"` must parse to numeric `1045.2` rather than `1` or `NaN`.
3. **XML entity escaping in `.xlsx`:** City/country names with apostrophes or ampersands (e.g., `"Xi'an, China"`, `"Côte d'Ivoire"`, `"Saint-Pierre & Miquelon"`) must produce well-formed worksheet XML.
4. **Partial dataset scraping:** If at least one of the 4 datasets has rows while another is empty, `#btnExportExcel` must be enabled and empty sheets must still contain valid header XML (`<row r="1">`).
5. **Dynamic UI state across Country vs City tabs:** Switching between Country tabs and City tabs must update `#colLocationHeader`, `#metricTotalLabel`, `#metricTopLabel`, `#searchInput.placeholder`, and filter rows using `r.country` or `r.city` respectively.

---

### Task 1: Country & City DOM Extraction in `content.js`

**Files:**
- Modify: `speedtest-chrome-extension/content.js`
- Create: `speedtest-chrome-extension/tests/content.test.js`

**Interfaces:**
- Produces:
  - `formatCityLocation(countryCell, link) -> string` (normalizes `"City, Country"`)
  - `extractRankingTable(containerId, linkFragment, mode) -> Array<Object>` where `mode` is `"country"` (produces `{ rank, country, download_mbps, rank_change, "yyyy-mm" }`) or `"city"` (produces `{ rank, city, download_mbps, rank_change, "yyyy-mm" }`)
  - `scrapeSpeedtestData() -> { mobile_country, fixed_country, mobile_city, fixed_city, yearMonth, dataPeriod, scrapedAt, pageTitle, url }`
  - CommonJS conditional export (`if (typeof module !== "undefined" && module.exports)`) for `node --test` without affecting browser execution.

- [ ] **Step 1: Write the failing unit tests in `speedtest-chrome-extension/tests/content.test.js`**

```javascript
const test = require("node:test");
const assert = require("node:assert/strict");
const { formatCityLocation, scrapeSpeedtestData } = require("../content.js");

test("formatCityLocation normalizes inline comma, split span without comma, and href slug fallback", () => {
  const makeCell = (fullText, linkText, href) => ({
    textContent: fullText,
    querySelector: () => ({ textContent: linkText, getAttribute: () => href })
  });

  const c1 = makeCell("  Bangkok ,  Thailand \n", "Bangkok", "/global-index/thailand?city=Bangkok#fixed");
  assert.equal(formatCityLocation(c1, c1.querySelector("a")), "Bangkok, Thailand");

  const c2 = makeCell("Abu Dhabi   United Arab Emirates", "Abu Dhabi", "/global-index/united-arab-emirates?city=Abu+Dhabi#mobile");
  assert.equal(formatCityLocation(c2, c2.querySelector("a")), "Abu Dhabi, United Arab Emirates");

  const c3 = makeCell("Bangkok", "Bangkok", "/global-index/thailand?city=Bangkok#mobile");
  assert.equal(formatCityLocation(c3, c3.querySelector("a")), "Bangkok, Thailand");
});

test("scrapeSpeedtestData extracts all 4 datasets with yyyy-mm, commas in speed, and sorted ranks", () => {
  const makeRow = ({ rank, href, linkText, cellText, speed, changeText, neutral = false }) => ({
    querySelector: (sel) => {
      if (sel === "td.country") {
        const a = {
          textContent: linkText,
          getAttribute: (attr) => (attr === "href" ? href : "")
        };
        return { textContent: cellText ?? linkText, querySelector: (s) => (s === "a" ? a : null) };
      }
      if (sel === "td.actual-rank") return { textContent: String(rank) };
      if (sel === "td.speed") return { textContent: String(speed) };
      if (sel === "td.rank-change") {
        return {
          querySelector: () => ({
            textContent: changeText,
            classList: { contains: (cls) => cls === "neutral" && neutral }
          })
        };
      }
      return null;
    }
  });

  const mobileContainer = {
    querySelectorAll: () => [
      makeRow({ rank: "2", href: "/global-index/qatar#mobile", linkText: "Qatar", speed: "554.73", changeText: "+1" }),
      makeRow({ rank: "1", href: "/global-index/united-arab-emirates#mobile", linkText: "United Arab Emirates", speed: "1,045.20", changeText: "-", neutral: true }),
      makeRow({ rank: "1", href: "/global-index/united-arab-emirates?city=Abu+Dhabi#mobile", linkText: "Abu Dhabi", cellText: "Abu Dhabi, United Arab Emirates", speed: "674.22", changeText: "-", neutral: true })
    ]
  };
  const fixedContainer = {
    querySelectorAll: () => [
      makeRow({ rank: "1", href: "/global-index/singapore#fixed", linkText: "Singapore", speed: "410.80", changeText: "0", neutral: true }),
      makeRow({ rank: "7", href: "/global-index/thailand?city=Bangkok#fixed", linkText: "Bangkok", cellText: "Bangkok\nThailand", speed: "323.31", changeText: "+1" })
    ]
  };

  global.window = { location: { href: "https://www.speedtest.net/global-index" } };
  global.document = {
    title: "Speedtest Global Index",
    getElementById: (id) => {
      if (id === "measureLocationId") return { textContent: "October 2026" };
      if (id === "column-mobileMedian") return mobileContainer;
      if (id === "column-fixedMedian") return fixedContainer;
      return null;
    },
    querySelector: () => null,
    querySelectorAll: () => [],
    body: { innerText: "", innerHTML: "" }
  };

  const res = scrapeSpeedtestData();
  assert.equal(res.yearMonth, "2026-10");
  assert.equal(res.mobile_country.length, 2);
  assert.deepEqual(res.mobile_country[0], {
    rank: 1,
    country: "United Arab Emirates",
    download_mbps: 1045.2,
    rank_change: "0",
    "yyyy-mm": "2026-10"
  });
  assert.deepEqual(res.mobile_city, [{
    rank: 1,
    city: "Abu Dhabi, United Arab Emirates",
    download_mbps: 674.22,
    rank_change: "0",
    "yyyy-mm": "2026-10"
  }]);
  assert.deepEqual(res.fixed_city, [{
    rank: 7,
    city: "Bangkok, Thailand",
    download_mbps: 323.31,
    rank_change: "+1",
    "yyyy-mm": "2026-10"
  }]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test speedtest-chrome-extension/tests/content.test.js`
Expected: FAIL (`ReferenceError: window is not defined` or `formatCityLocation is not a function`).

- [ ] **Step 3: Implement `formatCityLocation`, `extractRankingTable`, and updated `scrapeSpeedtestData` in `speedtest-chrome-extension/content.js`**

- Guard `window.__scrapeSpeedtestData = scrapeSpeedtestData` with `if (typeof window !== "undefined")` and export `{ formatCityLocation, extractRankingTable, scrapeSpeedtestData, parseYearMonth }` when `module.exports` exists.
- In `formatCityLocation(countryCell, link)`:
  1. Normalize whitespace in `countryCell.textContent` and `link.textContent` (`.replace(/\s+/g, " ").replace(/\s+,/g, ",").trim()`).
  2. If `fullText` contains `","`, return `fullText`.
  3. If `fullText.length > linkText.length` and starts with `linkText`, strip leading commas/spaces from the suffix and return `${linkText}, ${rest}`.
  4. Otherwise extract country slug from `href` (`/global-index/<country-slug>?city=...`), title-case hyphenated words, and return `${linkText}, ${countryFromSlug}` (or `linkText` if no slug matches).
- Replace `extractCountryTable` with `extractRankingTable(containerId, linkFragment, mode)`:
  - When `mode === "city"`, keep only rows where `href.includes("?city=")` and set `{ rank, city: formatCityLocation(countryCell, link), download_mbps, rank_change, "yyyy-mm": "" }`.
  - When `mode === "country"`, skip rows where `href.includes("?city=")` and set `{ rank, country: link.textContent.trim(), download_mbps, rank_change, "yyyy-mm": "" }`.
- Update `scrapeSpeedtestData()` to populate `mobile_country`, `fixed_country`, `mobile_city`, `fixed_city` and stamp `"yyyy-mm"` onto all 4 arrays.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test speedtest-chrome-extension/tests/content.test.js`
Expected: PASS (2 passing tests).

- [ ] **Step 5: Commit Task 1**

```bash
git add docs/superpowers/specs/2026-11-25-chrome-extension-city-speeds-design.md docs/superpowers/plans/2026-11-25-chrome-extension-city-speeds.md speedtest-chrome-extension/content.js speedtest-chrome-extension/tests/content.test.js
git commit -m "feat(extension): extract both country and city rankings in content script"
```

---

### Task 2: 4-Tab Popup UI, 4-Sheet Excel Export & Documentation

**Files:**
- Modify: `speedtest-chrome-extension/popup.html`
- Modify: `speedtest-chrome-extension/styles.css`
- Modify: `speedtest-chrome-extension/popup.js`
- Modify: `speedtest-chrome-extension/manifest.json`
- Modify: `speedtest-chrome-extension/README.md`
- Create: `speedtest-chrome-extension/tests/popup.test.js`

**Interfaces:**
- Consumes from `content.js`: `scrapeSpeedtestData()` result `{ mobile_country, fixed_country, mobile_city, fixed_city, yearMonth, dataPeriod }`.
- Produces in `popup.js`:
  - `getCategoryMeta(category) -> { isCity: boolean, locationKey: "country" | "city", totalLabel: string, topLabel: string, headerLabel: string, placeholder: string }`
  - `buildSheetXml(rows, locationKey) -> string` where `locationKey` is `"country"` or `"city"` (headers: `["rank", locationKey, "download_mbps", "rank_change", "yyyy-mm"]`)
  - `buildWorkbookFiles(scrapedData) -> Record<string, string>` producing OpenXML parts for 4 sheets (`mobile_country`, `fixed_country`, `mobile_city`, `fixed_city`)
  - `downloadExcel(scrapedData) -> void`
  - Active tab categories: `"mobile_country"`, `"fixed_country"`, `"mobile_city"`, `"fixed_city"`
  - Conditional CommonJS export (`if (typeof module !== "undefined" && module.exports)`) for unit testing `getCategoryMeta`, `buildSheetXml`, `buildWorkbookFiles`, `createZip`.

- [ ] **Step 1: Write the failing unit tests in `speedtest-chrome-extension/tests/popup.test.js`**

```javascript
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { getCategoryMeta, buildSheetXml, buildWorkbookFiles, createZip } = require("../popup.js");

test("getCategoryMeta switches labels, locationKey, and search placeholder between Country and City tabs", () => {
  assert.deepEqual(getCategoryMeta("mobile_country"), {
    isCity: false,
    locationKey: "country",
    totalLabel: "Total Countries",
    topLabel: "#1 Rank Country",
    headerLabel: "Country",
    placeholder: "Search country name..."
  });
  assert.deepEqual(getCategoryMeta("fixed_city"), {
    isCity: true,
    locationKey: "city",
    totalLabel: "Total Cities",
    topLabel: "#1 Rank City",
    headerLabel: "City",
    placeholder: "Search city or country..."
  });
});

test("buildSheetXml uses 'country' or 'city' header and escapes XML entities", () => {
  const countryXml = buildSheetXml(
    [{ rank: 1, country: "Côte d'Ivoire & Co.", download_mbps: 120.5, rank_change: "+2", "yyyy-mm": "2026-10" }],
    "country"
  );
  assert.match(countryXml, /<c r="B1" t="inlineStr"><is><t>country<\/t><\/is><\/c>/);
  assert.match(countryXml, /Côte d&apos;Ivoire &amp; Co\./);
  assert.match(countryXml, /<c r="C2"><v>120\.5<\/v><\/c>/);

  const cityXml = buildSheetXml(
    [{ rank: 7, city: "Bangkok, Thailand", download_mbps: 323.31, rank_change: "+1", "yyyy-mm": "2026-10" }],
    "city"
  );
  assert.match(cityXml, /<c r="B1" t="inlineStr"><is><t>city<\/t><\/is><\/c>/);
  assert.match(cityXml, /Bangkok, Thailand/);
});

test("buildWorkbookFiles creates valid 4-sheet OpenXML structure even when some sheets are empty", () => {
  const files = buildWorkbookFiles({
    mobile_country: [{ rank: 1, country: "UAE", download_mbps: 600, rank_change: "0", "yyyy-mm": "2026-10" }],
    fixed_country: [],
    mobile_city: [{ rank: 1, city: "Abu Dhabi, UAE", download_mbps: 674.22, rank_change: "0", "yyyy-mm": "2026-10" }],
    fixed_city: []
  });

  assert.match(files["xl/workbook.xml"], /name="mobile_country" sheetId="1" r:id="rId1"/);
  assert.match(files["xl/workbook.xml"], /name="fixed_country" sheetId="2" r:id="rId2"/);
  assert.match(files["xl/workbook.xml"], /name="mobile_city" sheetId="3" r:id="rId3"/);
  assert.match(files["xl/workbook.xml"], /name="fixed_city" sheetId="4" r:id="rId4"/);
  assert.match(files["[Content_Types].xml"], /sheet4\.xml/);
  assert.match(files["xl/_rels/workbook.xml.rels"], /Id="rId4".*worksheets\/sheet4\.xml/);
  assert.match(files["xl/worksheets/sheet2.xml"], /<row r="1">.*country.*<\/row>/);
  assert.match(files["xl/worksheets/sheet4.xml"], /<row r="1">.*city.*<\/row>/);

  const zipBytes = createZip(files);
  assert.equal(zipBytes[0], 0x50); // 'P'
  assert.equal(zipBytes[1], 0x4b); // 'K'
});

test("popup.html has 4 tabs, Excel (4 Sheets) button, dynamic label IDs, and no CSV buttons", () => {
  const html = fs.readFileSync(path.join(__dirname, "../popup.html"), "utf8");
  assert.doesNotMatch(html, /btnExportMobile/);
  assert.doesNotMatch(html, /btnExportFixed/);
  assert.match(html, /id="btnExportExcel"/);
  assert.match(html, /Excel \(4 Sheets\)/);
  for (const id of ["tabMobileCountry", "tabFixedCountry", "tabMobileCity", "tabFixedCity"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  for (const id of ["metricTotalLabel", "metricTopLabel", "colLocationHeader"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test speedtest-chrome-extension/tests/popup.test.js`
Expected: FAIL (`document is not defined` in `popup.js` and missing exports/elements).

- [ ] **Step 3: Update `popup.html`, `styles.css`, `popup.js`, `manifest.json`, and `README.md`**

- **`popup.html`:**
  - In `.actions-bar`: keep only `#btnScrape` (`⚡ Scrape Page`) and `#btnExportExcel` (`📊 Excel (4 Sheets)`).
  - In `.tabs-header`: replace 2 tabs with 4 tabs:
    - `#tabMobileCountry` (`📱 Mob Country` + `#countMobileCountry`)
    - `#tabFixedCountry` (`🌐 Fix Country` + `#countFixedCountry`)
    - `#tabMobileCity` (`📱 Mob City` + `#countMobileCity`)
    - `#tabFixedCity` (`🌐 Fix City` + `#countFixedCity`)
  - Add `id="metricTotalLabel"` (`Total Countries`), `id="metricTopLabel"` (`#1 Rank Country`), and `id="colLocationHeader"` (`Country`).
- **`styles.css`:**
  - Adjust `.tab-btn` padding (`6px 4px`), font-size (`11px`), gap (`4px`), `white-space: nowrap`, and `.tab-btn .badge-count` padding (`1px 5px`) so all 4 tabs and 3-digit counts (`180`) fit comfortably inside `520px`.
- **`popup.js`:**
  - Remove `generateCSV` and `downloadCSV` and CSV button references.
  - Maintain `scrapedData = { mobile_country: [], fixed_country: [], mobile_city: [], fixed_city: [], yearMonth: "" }` and `activeCategory = "mobile_country"`.
  - Update `buildSheetXml(rows, locationKey = "country")` to output `["rank", locationKey, "download_mbps", "rank_change", "yyyy-mm"]` and read `r[locationKey]`.
  - Extract `buildWorkbookFiles(data)` returning the OpenXML file map for `sheet1.xml` (`mobile_country`, `"country"`), `sheet2.xml` (`fixed_country`, `"country"`), `sheet3.xml` (`mobile_city`, `"city"`), `sheet4.xml` (`fixed_city`, `"city"`), and call it from `downloadExcel(data)`.
  - Add `getCategoryMeta(category)` returning `{ isCity, locationKey, totalLabel, topLabel, headerLabel, placeholder }`; in `renderTable()`, use `getCategoryMeta(activeCategory)` to update `metricTotalLabel`, `metricTopLabel`, `colLocationHeader`, `searchInput.placeholder`, and filter rows; enable `#btnExportExcel` whenever any of the 4 arrays is non-empty.
  - In `handleScrapedResult(data)`: populate all 4 arrays, stamp `"yyyy-mm"` onto every row across all 4 arrays, and show combined total count in `setStatus("ready", ...)`.
  - Guard DOM initialization / listeners behind `if (typeof document !== "undefined")` and export `{ getCategoryMeta, buildSheetXml, buildWorkbookFiles, createZip, escapeXml }` when `module.exports` exists.
- **`manifest.json` & `speedtest-chrome-extension/README.md`:**
  - Bump version to `1.1.0` (and footer in `popup.html` to `v1.1.0`), update description and README instructions to document Country + City scraping and 4-sheet Excel export.

- [ ] **Step 4: Run full test suite to verify all tests pass**

Run: `node --test speedtest-chrome-extension/tests/*.test.js`
Expected: PASS (all 6 tests in `content.test.js` and `popup.test.js` pass).

- [ ] **Step 5: Commit Task 2**

```bash
git add speedtest-chrome-extension/popup.html speedtest-chrome-extension/styles.css speedtest-chrome-extension/popup.js speedtest-chrome-extension/manifest.json speedtest-chrome-extension/README.md speedtest-chrome-extension/tests/popup.test.js
git commit -m "feat(extension): add 4-tab Country/City UI and 4-sheet Excel export"
```
