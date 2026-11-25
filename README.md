# Speedtest Global Index — Scraper & PDF OCR Toolkit

ชุดเครื่องมือสำหรับดึงและแปลงข้อมูลอันดับความเร็วอินเทอร์เน็ตโลกจาก [Speedtest Global Index](https://www.speedtest.net/global-index) ทั้งในระดับประเทศ (**Country Speeds**) และระดับเมือง (**City Speeds**) รองรับทั้งการ Scrape จากหน้าเว็บโดยตรง, การใช้ Chrome Extension และการใช้ OCR แปลงข้อมูลจากไฟล์ PDF

---

## โครงสร้างโปรเจกต์

```text
speedtest-Scraping-index/
├── scrape_speedtest_global_index.py    # ดึงข้อมูล Country Speeds ล่าสุดจากหน้าเว็บ (DrissionPage + BS4)
├── ocr_speedtest_country_city_pdfs.py  # อ่าน PDF รูปแบบใหม่ (Country Speeds + City Speeds) ด้วย OCR
├── ocr_speedtest_pdfs.py               # อ่าน PDF ย้อนหลังแบบ Country-only (2026-02 ถึง 08) รวมกับ 2026-09
├── debug_period.py                     # สคริปต์ช่วยตรวจสอบตำแหน่งข้อความเดือน/ปีใน HTML หน้าเว็บ
├── speedtest-chrome-extension/         # Chrome Extension (Manifest V3) สำหรับดึงข้อมูลจากหน้าเว็บ 1-Click
├── input/                              # โฟลเดอร์เก็บไฟล์ PDF ต้นฉบับสำหรับงาน OCR
├── output/                             # โฟลเดอร์ผลลัพธ์ไฟล์ Excel (.xlsx) และ Dashboard
│   └── csv/                            # โฟลเดอร์ผลลัพธ์ไฟล์ CSV แยกตามประเภท
└── README.md                           # คู่มือการใช้งานฉบับนี้
```

---

## 1. การเตรียมสภาพแวดล้อมตั้งแต่เริ่มต้น (Setup)

### สิ่งที่ต้องมีในเครื่อง
1. **Python 3.11 ขึ้นไป** (แนะนำ Python 3.12)
2. **Google Chrome** (จำเป็นสำหรับ `scrape_speedtest_global_index.py`, `debug_period.py` และ Chrome Extension)
3. **ตัวจัดการแพ็กเกจ** เลือกใช้แบบใดแบบหนึ่งด้านล่าง:
   - **แบบที่ A: ใช้ `uv` (แนะนำ — ไม่ต้องสร้าง venv เอง รันได้ทันที)**
     ติดตั้ง `uv` (Windows PowerShell):
     ```powershell
     winget install --id=astral-sh.uv -e
     ```
   - **แบบที่ B: ใช้ Python `venv` + `pip` ปกติ**
     ```powershell
     # 1. สร้างและเปิดใช้งาน virtual environment
     python -m venv .venv
     .\.venv\Scripts\Activate.ps1

     # 2. ติดตั้งแพ็กเกจทั้งหมดที่ใช้ในโปรเจกต์
     pip install DrissionPage beautifulsoup4 openpyxl pypdf opencv-python numpy rapidocr-onnxruntime rapidfuzz
     ```
     > สำหรับ macOS/Linux ให้ใช้ `source .venv/bin/activate` แทน `.\.venv\Scripts\Activate.ps1`

---

## 2. วิธีการใช้งานแต่ละเครื่องมือ

### วิธีที่ 1: ดึงข้อมูล Country Speeds ล่าสุดจากหน้าเว็บ (`scrape_speedtest_global_index.py`)
เหมาะสำหรับดึงข้อมูล **เดือนล่าสุด** ของอันดับประเทศ (Mobile และ Fixed Broadband) จากหน้าเว็บ Speedtest โดยตรง

1. **รันในโหมดปกติ (Headless Browser):**
   - กรณีใช้ `uv`:
     ```powershell
     uv run --with DrissionPage --with beautifulsoup4 --with openpyxl python scrape_speedtest_global_index.py
     ```
   - กรณีใช้ `venv` ที่ติดตั้งแพ็กเกจแล้ว:
     ```powershell
     python scrape_speedtest_global_index.py
     ```
2. **หากติดหน้าตรวจสอบ Cloudflare** ให้เพิ่ม flag `--headed` เพื่อเปิดหน้าต่าง Chrome จริงขึ้นมาช่วยผ่านการตรวจสอบ:
   ```powershell
   python scrape_speedtest_global_index.py --headed
   ```
3. **ผลลัพธ์ที่ได้:**
   - Excel รวม 2 ชีต (`mobile`, `fixed`): `output/speedtest_global_index_<ddmmyy>.xlsx`
   - CSV แยก 2 ไฟล์: `output/csv/speedtest_mobile_<ddmmyy>.csv` และ `output/csv/speedtest_fixed_broadband_<ddmmyy>.csv`
   - คอลัมน์: `rank`, `country`, `download_mbps`, `rank_change`, `yyyy-mm`

---

### วิธีที่ 2: แปลงไฟล์ PDF ที่มีทั้ง Country Speeds และ City Speeds (`ocr_speedtest_country_city_pdfs.py`)
เหมาะสำหรับไฟล์ PDF ที่แคปหน้าเว็บเต็มหน้า (Full-page Screenshot -> PDF) โดยมีทั้งหน้า **Median Country Speeds** และ **Median City Speeds** (เช่น `input/Speedtest index October (Global,City,Thailand).pdf`)

1. **เตรียมไฟล์ PDF ต้นฉบับ:**
   - นำไฟล์ PDF มาวางในโฟลเดอร์ `input/` (สคริปต์จะข้ามไฟล์ที่ชื่อมีคำว่า `by country` เพื่อไม่ให้ชนกับไฟล์รูปแบบเก่า)
   - ตัวอย่างหน้า PDF ที่รองรับ: หน้าแสดงตาราง `Median Country Speeds` และ `Median City Speeds` (หากใน PDF มีหน้าการ์ดสรุปรายเมือง เช่น หน้า 3 ของ Bangkok สคริปต์จะข้ามหน้าการ์ดนั้นให้โดยอัตโนมัติ)
2. **สั่งรันสคริปต์:**
   - สแกนทุกไฟล์ PDF รูปแบบใหม่ใน `input/` อัตโนมัติ:
     ```powershell
     uv run --with pypdf --with opencv-python --with openpyxl --with rapidocr-onnxruntime --with rapidfuzz python ocr_speedtest_country_city_pdfs.py
     ```
   - หรือระบุไฟล์ PDF เฉพาะเจาะจงด้วย `--pdf`:
     ```powershell
     uv run --with pypdf --with opencv-python --with openpyxl --with rapidocr-onnxruntime --with rapidfuzz python ocr_speedtest_country_city_pdfs.py --pdf "input/Speedtest index October (Global,City,Thailand).pdf"
     ```
   *(หากใช้ `venv` สามารถรัน `python ocr_speedtest_country_city_pdfs.py` ได้เลย)*
3. **ผลลัพธ์ที่ได้:**
   - **Excel รวม 4 ชีต:** `output/speedtest_country_city_<YYYY_MM>.xlsx`
     - ชีต `mobile` และ `fixed`: `rank`, `country`, `download_mbps`, `rank_change`, `yyyy-mm`
     - ชีต `city_mobile` และ `city_fixed`: `rank`, `city`, `country`, `download_mbps`, `rank_change`, `yyyy-mm`
   - **CSV แยก 4 ไฟล์ใน `output/csv/`:**
     - `speedtest_mobile_<YYYY_MM>.csv`
     - `speedtest_fixed_broadband_<YYYY_MM>.csv`
     - `speedtest_city_mobile_<YYYY_MM>.csv`
     - `speedtest_city_fixed_broadband_<YYYY_MM>.csv`

---

### วิธีที่ 3: แปลงไฟล์ PDF ย้อนหลังเฉพาะ Country Speeds (`ocr_speedtest_pdfs.py`)
ใช้สำหรับประมวลผลชุดไฟล์ PDF ย้อนหลังรูปแบบเก่า (เช่น `2-2026 ...pdf` ถึง `8-2026 ...pdf`) แล้วนำไปรวมกับข้อมูลเดือน `2026-09`

1. **เตรียมโฟลเดอร์และไฟล์ก่อนรัน:**
   - สคริปต์นี้อ่าน PDF จากโฟลเดอร์ `Speedtest Data pdf/` (ชื่อไฟล์ต้องขึ้นต้นด้วย `<เลขเดือน>-<ปี>` เช่น `2-2026 ...pdf`)
   - หากไฟล์ PDF ปัจจุบันอยู่ใน `input/` ให้คัดลอกไฟล์ `2-2026` ถึง `8-2026` ไปไว้ที่ `Speedtest Data pdf/` ก่อน
   - (ทางเลือก) หากต้องการรวมข้อมูลเดือน `2026-09` ด้วย ต้องมีไฟล์ `speedtest_mobile_271026.csv` และ `speedtest_fixed_broadband_271026.csv` อยู่ใน `output/csv/` หรือ `output/`
2. **สั่งรันสคริปต์:**
   ```powershell
   uv run --with pypdf --with opencv-python --with openpyxl --with rapidocr-onnxruntime --with rapidfuzz python ocr_speedtest_pdfs.py
   ```
3. **ผลลัพธ์ที่ได้:**
   - `output/speedtest_global_index_2026_02_to_09.xlsx` (ชีต `mobile`, `fixed`)
   - `output/csv/speedtest_mobile_2026_02_to_09.csv`
   - `output/csv/speedtest_fixed_broadband_2026_02_to_09.csv`

---

### วิธีที่ 4: ดึงข้อมูลผ่าน Chrome Extension (`speedtest-chrome-extension/`)
เหมาะสำหรับดึงข้อมูลแบบกดปุ่มเดียวในเบราว์เซอร์ที่เปิดใช้งานอยู่ (ไม่ติดปัญหา Cloudflare)

1. เปิด Google Chrome แล้วไปที่ `chrome://extensions`
2. เปิดสวิตช์ **Developer mode** (มุมขวาบน)
3. กด **Load unpacked** (มุมซ้ายบน) แล้วเลือกโฟลเดอร์ `speedtest-chrome-extension` ในโปรเจกต์นี้
4. เปิดเว็บ [https://www.speedtest.net/global-index](https://www.speedtest.net/global-index)
5. กดไอคอน **Speedtest Global Index Scraper** บนแถบ Extension แล้วกด **"Scrape Page"** จากนั้นเลือกส่งออกเป็น CSV (`mobile_DDMMYY.csv`, `fixed_DDMMYY.csv`)

---

### เครื่องมือเสริม: ตรวจสอบตำแหน่งเดือน/ปีใน HTML (`debug_period.py`)
ใช้สำหรับ debug กรณีหน้าเว็บ Speedtest มีการปรับโครงสร้าง HTML ทำให้ `scrape_speedtest_global_index.py` ตรวจจับ `yyyy-mm` ไม่ได้:
```powershell
uv run --with DrissionPage --with beautifulsoup4 python debug_period.py
```

---

## 3. การแก้ไขปัญหาที่พบบ่อย (Troubleshooting)

- **รัน `scrape_speedtest_global_index.py` แล้วค้างหรือ HTML size น้อยกว่า 100,000 bytes:**
  มักเกิดจาก Cloudflare บล็อกโหมด Headless ให้รันใหม่พร้อม `--headed` หรือใช้ Chrome Extension แทน
- **ขึ้น `ModuleNotFoundError: No module named ...`:**
  ตรวจสอบว่าได้เปิดใช้งาน `.venv` แล้ว หรือใช้คำสั่ง `uv run --with ...` ตามตัวอย่างในแต่ละหัวข้อ
- **รัน `ocr_speedtest_country_city_pdfs.py` แล้วใช้เวลาประมาณ 5–7 นาที:**
  เป็นปกติ เนื่องจากไฟล์ PDF มีความละเอียดสูง (สูงเกิน `11,000–14,000 px`) และต้องทำ OCR แยกทุกช่องข้อมูลเกือบ 600 แถว
