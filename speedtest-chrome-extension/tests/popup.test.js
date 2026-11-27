const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { buildSheetXml, buildWorkbookFiles, createZip, initPopupController } = require("../popup.js");

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

test("popup.html and manifest.json are minimal with Open Link button, Scrape, Excel, and git YYYY-MM-DD HH:MM version", () => {
  const html = fs.readFileSync(path.join(__dirname, "../popup.html"), "utf8");
  assert.match(html, /id="btnOpenPage"/);
  assert.match(html, /id="btnScrape"/);
  assert.match(html, /id="btnExportExcel"/);
  assert.match(html, /id="versionText"/);
  assert.match(html, /20\d{2}-\d{2}-\d{2} \d{2}:\d{2}/);

  // Must NOT contain any category tabs, table, or search bar
  for (const removedId of [
    "tabMobileCountry", "tabFixedCountry", "tabMobileCity", "tabFixedCity",
    "dataTable", "tableBody", "searchInput", "btnExportMobile", "btnExportFixed"
  ]) {
    assert.doesNotMatch(html, new RegExp(`id="${removedId}"`));
  }

  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "../manifest.json"), "utf8"));
  assert.equal(manifest.content_scripts, undefined, "manifest should not auto-inject content_scripts on page load");
  assert.match(manifest.version_name, /^20\d{2}-\d{2}-\d{2} \d{2}:\d{2}$/);
});

test("initPopupController opens Speedtest link, uses injectImmediately: true, and updates Excel button state", async () => {
  const elements = {};
  const makeEl = () => ({
    textContent: "",
    disabled: true,
    className: "",
    style: {},
    addEventListener: function (ev, fn) {
      this[`on_${ev}`] = fn;
    }
  });
  for (const id of ["btnOpenPage", "btnScrape", "btnExportExcel", "statusBadge", "statusText", "summaryText"]) {
    elements[id] = makeEl();
  }
  elements.btnOpenPage.disabled = false;
  elements.btnScrape.disabled = false;

  const mockDoc = {
    getElementById: (id) => elements[id],
    addEventListener: () => {}
  };

  const executeCalls = [];
  const createdTabs = [];
  global.chrome = {
    tabs: {
      query: async () => [{ id: 42, url: "https://www.speedtest.net/global-index" }],
      create: (opts) => createdTabs.push(opts)
    },
    scripting: {
      executeScript: async (opts) => {
        executeCalls.push(opts);
        return [{
          result: {
            mobile_country: [{ rank: 1, country: "Thailand", download_mbps: 180, rank_change: "0" }],
            fixed_country: [{ rank: 2, country: "Singapore", download_mbps: 410, rank_change: "0" }],
            mobile_city: [{ rank: 48, city: "Bangkok, Thailand", download_mbps: 182.53, rank_change: "+2" }],
            fixed_city: [{ rank: 7, city: "Bangkok, Thailand", download_mbps: 323.31, rank_change: "+1" }],
            yearMonth: "2026-10"
          }
        }];
      }
    }
  };

  const ctrl = initPopupController(mockDoc, () => {});

  // Test Open Link button
  elements.btnOpenPage.on_click();
  assert.deepEqual(createdTabs, [{ url: "https://www.speedtest.net/global-index" }]);

  await ctrl.triggerScrape();

  assert.equal(executeCalls.length, 1, "should scrape in a single executeScript call");
  assert.equal(executeCalls[0].injectImmediately, true, "must use injectImmediately: true to avoid waiting for slow ad scripts");
  assert.equal(elements.btnExportExcel.disabled, false);
  assert.match(elements.summaryText.textContent, /2026-10/);

  // Re-scrape with 0 rows disables Excel button
  ctrl.handleScrapedResult({ mobile_country: [], fixed_country: [], mobile_city: [], fixed_city: [] });
  assert.equal(elements.btnExportExcel.disabled, true);
});
