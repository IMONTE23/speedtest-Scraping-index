# Chrome Extension: City Speeds Scraping & 4-Sheet Excel Export — Design Spec

- **Date:** 2026-11-25
- **Scope:** Small change (`speedtest-chrome-extension/`)

## 1. Intent & Why
เพิ่มการดึงข้อมูล **City Speeds** (ทั้ง Mobile และ Fixed Broadband) ใน Chrome Extension ควบคู่กับ **Country Speeds** เดิมในการกด Scrape ครั้งเดียว เพื่อให้สามารถดูอันดับความเร็วระดับเมืองและส่งออกเป็นไฟล์ Excel เดียวครบทั้ง 4 ตารางได้ทันที

## 2. Goals & Non-Goals
- **Goals:**
  - ดึงข้อมูลครบ 4 ชุด (`mobile_country`, `fixed_country`, `mobile_city`, `fixed_city`) จากหน้า `https://www.speedtest.net/global-index` ในคลิกเดียว
  - เก็บชื่อเมืองคู่ประเทศในคอลัมน์เดียว (เช่น `"Bangkok, Thailand"`)
  - แสดงผลใน Popup แบบ 4 แท็บในแถบเดียว พร้อมการ์ดสรุปผลและช่องค้นหาที่เปลี่ยนตามแท็บที่เลือก
  - ส่งออกเป็นไฟล์ `.xlsx` ไฟล์เดียวที่มี 4 ชีต (`mobile_country`, `fixed_country`, `mobile_city`, `fixed_city`) โดยตัดปุ่มดาวน์โหลด CSV ออก
- **Non-Goals:**
  - ไม่แยกคอลัมน์ชื่อเมืองและชื่อประเทศออกจากกัน
  - ไม่ต้องสลับปุ่ม Country/City บนหน้าเว็บ Speedtest ก่อนกด Scrape
  - ไม่แก้ไขสคริปต์ Python นอกโฟลเดอร์ `speedtest-chrome-extension/`

## 3. Constraints
- ความกว้างหน้าต่าง Popup คงเดิมที่ `520px` (สูงไม่เกิน `600px`)
- ใช้ Manifest V3 และสร้างไฟล์ `.xlsx` ด้วยฟังก์ชัน OpenXML + ZIP ในตัวเดิมโดยไม่พึ่งพาไลบรารีภายนอก

## 4. Approaches Considered
1. **สวิตช์สลับโหมด `Country` / `City` แยกชั้นกับแท็บ `Mobile` / `Fixed`:** ประหยัดพื้นที่แนวนอน แต่ต้องกดสลับ 2 ชั้นเวลาเปลี่ยนข้ามหมวดหมู่และไม่เห็นจำนวนรายการทั้ง 4 ชุดพร้อมกัน
2. **4 แท็บเรียงในแถบเดียว + เฉพาะปุ่ม Scrape และ Excel (เลือกแนวทางนี้):** เห็นจำนวนแถวครบทั้ง 4 ชุดพร้อมกัน สลับดูได้ในคลิกเดียว และเมื่อตัดปุ่ม CSV ออกแล้ว แถบปุ่มด้านบนเหลือเพียง `Scrape Page` และ `Excel (4 Sheets)` ที่สะอาดตาและตรงกับการใช้งานจริง

## 5. Design Decisions
- **DOM Extraction (`content.js`):**
  - คิวรี `tr.data-result` จาก `#column-mobileMedian` (`#mobile`) และ `#column-fixedMedian` (`#fixed`)
  - แยกข้อมูลด้วย `href.includes("?city=")`:
    - **Country rows** (ไม่มี `?city=`): `{ rank, country, download_mbps, rank_change, "yyyy-mm" }`
    - **City rows** (มี `?city=`): `{ rank, city, download_mbps, rank_change, "yyyy-mm" }` โดยดึงข้อความรวม `"City, Country"` จาก `td.country` (และรองรับ fallback กรณีข้อความแยกโหนด)
- **Popup UI (`popup.html`, `styles.css`, `popup.js`):**
  - **Toolbar:** เหลือ 2 ปุ่ม คือ `[⚡ Scrape Page]` และ `[📊 Excel (4 Sheets)]`
  - **Tabs:** 4 แท็บในแถวเดียว (`📱 Mob Country`, `🌐 Fix Country`, `📱 Mob City`, `🌐 Fix City`) พร้อมตัวเลขจำนวนรายการในแต่ละแท็บ
  - **Metrics / Search / Table Header:** ปรับป้ายกำกับอัตโนมัติระหว่าง `Country` / `Countries` และ `City` / `Cities` ตามแท็บที่เปิดอยู่
- **Excel Export (`popup.js`):**
  - ไฟล์ `speedtest_DDMMYY.xlsx` ประกอบด้วย 4 ชีตตามลำดับ:
    1. `mobile_country` — headers: `rank, country, download_mbps, rank_change, yyyy-mm`
    2. `fixed_country` — headers: `rank, country, download_mbps, rank_change, yyyy-mm`
    3. `mobile_city` — headers: `rank, city, download_mbps, rank_change, yyyy-mm`
    4. `fixed_city` — headers: `rank, city, download_mbps, rank_change, yyyy-mm`

## 6. Left to Builder
- ปรับขนาดฟอนต์และ padding ของแถบ 4 แท็บใน `styles.css` ให้พอดีความกว้าง `520px` โดยไม่ตัดขึ้นบรรทัดใหม่
- อัปเดตคำอธิบายใน `manifest.json` และ `speedtest-chrome-extension/README.md` ให้สอดคล้องกับฟีเจอร์ใหม่
