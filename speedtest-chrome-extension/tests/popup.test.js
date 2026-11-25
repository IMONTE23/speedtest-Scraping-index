const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { getCategoryMeta, buildSheetXml, buildWorkbookFiles, createZip, renderRowHtml, initPopupController } = require("../popup.js");

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

test("renderRowHtml escapes HTML entities in rank, location, and rank_change", () => {
  const html = renderRowHtml(
    { rank: "<script>", city: "Bangkok & <Co>", download_mbps: 100, rank_change: "+1<b>" },
    "city"
  );
  assert.doesNotMatch(html, /<script>|<b>|<Co>/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /Bangkok &amp; &lt;Co&gt;/);
  assert.match(html, /\+1&lt;b&gt;/);
});

test("handleScrapedResult resets table UI and disables Excel button when re-scrape returns 0 rows, and styles.css uses flex: 1 1 auto", () => {
  const css = fs.readFileSync(path.join(__dirname, "../styles.css"), "utf8");
  assert.match(css, /\.tab-btn\s*\{[^}]*flex:\s*1\s+1\s+auto;/);

  const elements = {};
  const makeEl = () => ({
    textContent: "",
    innerHTML: "",
    disabled: false,
    placeholder: "",
    className: "",
    style: {},
    classList: { toggle: () => {} },
    addEventListener: () => {}
  });
  for (const id of [
    "btnScrape", "btnOpenPage", "btnExportExcel",
    "tabMobileCountry", "tabFixedCountry", "tabMobileCity", "tabFixedCity",
    "countMobileCountry", "countFixedCountry", "countMobileCity", "countFixedCity",
    "metricTotalLabel", "metricTopLabel", "metricTotal", "metricTop", "metricTopSpeed", "metricAvg",
    "colLocationHeader", "searchInput", "tableBody", "emptyState", "statusBadge", "statusText", "timestampText"
  ]) {
    elements[id] = makeEl();
  }
  const mockDoc = {
    getElementById: (id) => elements[id],
    addEventListener: () => {}
  };
  const ctrl = initPopupController(mockDoc, () => {});
  ctrl.handleScrapedResult({
    mobile_country: [{ rank: 1, country: "Thailand", download_mbps: 180, rank_change: "0" }],
    fixed_country: [],
    mobile_city: [],
    fixed_city: [],
    yearMonth: "2026-10"
  });
  assert.equal(elements.btnExportExcel.disabled, false);
  assert.equal(elements.countMobileCountry.textContent, 1);

  // Re-scrape returns 0 rows
  ctrl.handleScrapedResult({ mobile_country: [], fixed_country: [], mobile_city: [], fixed_city: [] });
  assert.equal(elements.btnExportExcel.disabled, true);
  assert.equal(elements.countMobileCountry.textContent, 0);
  assert.equal(elements.tableBody.innerHTML, "");
});
