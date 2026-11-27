const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { formatCityLocation, scrapeSpeedtestData, parseYearMonth } = require("../content.js");

test("content.js can be evaluated multiple times in the same window context without SyntaxError", () => {
  const code = fs.readFileSync(path.join(__dirname, "../content.js"), "utf8");
  const sandbox = {
    window: { location: { href: "https://www.speedtest.net/global-index" } },
    document: {
      title: "Speedtest",
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
      body: { textContent: "Updated October 2026" }
    }
  };
  vm.createContext(sandbox);
  assert.doesNotThrow(() => {
    vm.runInContext(code, sandbox);
    vm.runInContext(code, sandbox);
  });
  assert.equal(typeof sandbox.window.__scrapeSpeedtestData, "function");
});

test("parseYearMonth never triggers layout reflow via innerText or serializes innerHTML", () => {
  let innerTextAccessed = false;
  let innerHtmlAccessed = false;

  global.document = {
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    body: {
      get innerText() {
        innerTextAccessed = true;
        return "October 2026";
      },
      get innerHTML() {
        innerHtmlAccessed = true;
        return "<div>October 2026</div>";
      },
      textContent: "October 2026"
    }
  };

  assert.equal(parseYearMonth(), "2026-10");
  assert.equal(innerTextAccessed, false);
  assert.equal(innerHtmlAccessed, false);
});

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

  const c4 = makeCell("Bangkok, , Thailand", "Bangkok,", "/global-index/thailand?city=Bangkok#mobile");
  assert.equal(formatCityLocation(c4, c4.querySelector("a")), "Bangkok, Thailand");

  const c5 = makeCell("Washington, D.C.United States", "Washington, D.C.", "/global-index/united-states?city=Washington#mobile");
  assert.equal(formatCityLocation(c5, c5.querySelector("a")), "Washington, D.C., United States");
});

test("scrapeSpeedtestData extracts all 4 datasets in a single pass per container", () => {
  let mobileQueryCount = 0;
  let fixedQueryCount = 0;

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
    querySelectorAll: () => {
      mobileQueryCount++;
      return [
        makeRow({ rank: "2", href: "/global-index/qatar#mobile", linkText: "Qatar", speed: "554.73", changeText: "+1" }),
        makeRow({ rank: "1", href: "/global-index/united-arab-emirates#mobile", linkText: "United Arab Emirates", speed: "1,045.20", changeText: "-", neutral: true }),
        makeRow({ rank: "1", href: "/global-index/united-arab-emirates?city=Abu+Dhabi#mobile", linkText: "Abu Dhabi", cellText: "Abu Dhabi, United Arab Emirates", speed: "674.22", changeText: "-", neutral: true })
      ];
    }
  };
  const fixedContainer = {
    querySelectorAll: () => {
      fixedQueryCount++;
      return [
        makeRow({ rank: "1", href: "/global-index/singapore#fixed", linkText: "Singapore", speed: "410.80", changeText: "0", neutral: true }),
        makeRow({ rank: "7", href: "/global-index/thailand?city=Bangkok#fixed", linkText: "Bangkok", cellText: "Bangkok\nThailand", speed: "323.31", changeText: "+1" })
      ];
    }
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
    body: { textContent: "" }
  };

  const res = scrapeSpeedtestData();
  assert.equal(mobileQueryCount, 1, "mobile container should only be queried once");
  assert.equal(fixedQueryCount, 1, "fixed container should only be queried once");
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
