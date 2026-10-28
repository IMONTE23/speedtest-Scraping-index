"""
Extract Speedtest Global Index rankings from saved PDFs (2-2026 to 8-2026)
and combine with existing 9-2026 scraped data into Excel (mobile, fixed sheets)
and CSV files.
"""

import csv
import pathlib
import re
import time
import cv2
import numpy as np
import pypdf
from openpyxl import Workbook
from rapidocr_onnxruntime import RapidOCR
from rapidfuzz import process, fuzz

BASE_DIR = pathlib.Path(__file__).resolve().parent
PDF_DIR = BASE_DIR / "Speedtest Data pdf"
OUTPUT_DIR = BASE_DIR / "output"
CSV_OUTPUT_DIR = OUTPUT_DIR / "csv"

engine = RapidOCR()

# Load canonical countries from 2026-09 CSVs + known Speedtest countries
CANONICAL_COUNTRIES = set()
for f in list(CSV_OUTPUT_DIR.glob("*.csv")) + list(OUTPUT_DIR.glob("*.csv")):
    with open(f, encoding="utf-8") as fp:
        for row in csv.DictReader(fp):
            if row.get("country"):
                CANONICAL_COUNTRIES.add(row["country"].strip())

EXTRA_COUNTRIES = [
    "Democratic Republic of the Congo",
    "Republic of the Congo",
    "Côte d'Ivoire",
    "Cabo Verde",
    "Bosnia and Herzegovina",
    "Trinidad and Tobago",
    "Antigua and Barbuda",
    "Saint Kitts and Nevis",
    "Saint Vincent and the Grenadines",
    "Saint Lucia",
    "Dominican Republic",
    "United Arab Emirates",
    "United Kingdom",
    "United States",
    "North Macedonia",
    "Papua New Guinea",
    "Hong Kong (SAR)",
    "Macau (SAR)",
    "Myanmar (Burma)",
    "The Bahamas",
    "The Gambia",
    "Brunei",
    "Türkiye",
    "Czechia",
    "Eswatini",
    "Timor-Leste",
    "Equatorial Guinea",
    "Central African Republic",
    "Sierra Leone",
    "Burkina Faso",
    "Guinea-Bissau",
    "Solomon Islands",
    "Marshall Islands",
    "San Marino",
    "Liechtenstein",
    "Monaco",
    "Andorra",
    "Djibouti",
    "Comoros",
    "Seychelles",
    "Lesotho",
    "Botswana",
    "Namibia",
    "Zimbabwe",
    "Zambia",
    "Malawi",
    "Mozambique",
    "Madagascar",
    "Mauritius",
    "Mauritania",
    "Senegal",
    "Mali",
    "Niger",
    "Chad",
    "Sudan",
    "South Sudan",
    "Eritrea",
    "Ethiopia",
    "Somalia",
    "Kenya",
    "Uganda",
    "Rwanda",
    "Burundi",
    "Tanzania",
    "Angola",
    "Gabon",
    "Cameroon",
    "Nigeria",
    "Benin",
    "Togo",
    "Ghana",
    "Liberia",
    "Guinea",
    "Algeria",
    "Tunisia",
    "Libya",
    "Egypt",
    "Morocco",
    "Syria",
    "Lebanon",
    "Israel",
    "Palestine",
    "Jordan",
    "Iraq",
    "Kuwait",
    "Bahrain",
    "Qatar",
    "Saudi Arabia",
    "Yemen",
    "Oman",
    "Iran",
    "Afghanistan",
    "Pakistan",
    "India",
    "Sri Lanka",
    "Maldives",
    "Nepal",
    "Bhutan",
    "Bangladesh",
    "Thailand",
    "Laos",
    "Cambodia",
    "Vietnam",
    "Malaysia",
    "Singapore",
    "Indonesia",
    "Philippines",
    "Taiwan",
    "China",
    "Mongolia",
    "South Korea",
    "Japan",
    "Kazakhstan",
    "Uzbekistan",
    "Turkmenistan",
    "Kyrgyzstan",
    "Tajikistan",
    "Armenia",
    "Azerbaijan",
    "Georgia",
    "Russia",
    "Ukraine",
    "Belarus",
    "Moldova",
    "Romania",
    "Bulgaria",
    "Greece",
    "Albania",
    "Montenegro",
    "Kosovo",
    "Serbia",
    "Croatia",
    "Slovenia",
    "Hungary",
    "Slovakia",
    "Poland",
    "Lithuania",
    "Latvia",
    "Estonia",
    "Finland",
    "Sweden",
    "Norway",
    "Iceland",
    "Denmark",
    "Germany",
    "Netherlands",
    "Belgium",
    "Luxembourg",
    "France",
    "Spain",
    "Portugal",
    "Italy",
    "Malta",
    "Cyprus",
    "Switzerland",
    "Austria",
    "Ireland",
    "Canada",
    "Mexico",
    "Guatemala",
    "Belize",
    "El Salvador",
    "Honduras",
    "Nicaragua",
    "Costa Rica",
    "Panama",
    "Cuba",
    "Jamaica",
    "Haiti",
    "Barbados",
    "Grenada",
    "Dominica",
    "Suriname",
    "Guyana",
    "Venezuela",
    "Colombia",
    "Ecuador",
    "Peru",
    "Bolivia",
    "Brazil",
    "Paraguay",
    "Uruguay",
    "Argentina",
    "Chile",
    "Australia",
    "New Zealand",
    "Fiji",
    "Vanuatu",
    "Samoa",
    "Tonga",
]
for c in EXTRA_COUNTRIES:
    CANONICAL_COUNTRIES.add(c)
CANONICAL_LIST = sorted(CANONICAL_COUNTRIES)

EXPLICIT_COUNTRY_FIXES = {
    "irag": "Iraq",
    "lraq": "Iraq",
    "lran": "Iran",
    "turkiye": "Türkiye",
    "türkiye": "Türkiye",
    "cote d'ivoire": "Côte d'Ivoire",
    "cote d'lvoire": "Côte d'Ivoire",
    "cote d'lvoire.": "Côte d'Ivoire",
    "cote d'ivoire.": "Côte d'Ivoire",
}


def resolve_country(raw_name: str) -> str:
    cleaned = raw_name.strip().rstrip(".")
    low = cleaned.lower()
    if low in EXPLICIT_COUNTRY_FIXES:
        return EXPLICIT_COUNTRY_FIXES[low]
    if cleaned in CANONICAL_COUNTRIES:
        return cleaned
    match, score, _ = process.extractOne(cleaned, CANONICAL_LIST, scorer=fuzz.WRatio)
    return match


def find_bars(img, x_start, width=10):
    strip = img[:, x_start : x_start + width]
    b, g, r = (
        strip[:, :, 0].astype(int),
        strip[:, :, 1].astype(int),
        strip[:, :, 2].astype(int),
    )
    is_teal = (b - r > 50) & (g - r > 35)
    frac = is_teal.mean(axis=1)
    bar_ys = np.where(frac > 0.25)[0]
    if len(bar_ys) == 0:
        return []
    splits = np.split(bar_ys, np.where(np.diff(bar_ys) > 15)[0] + 1)
    return [int(s.mean()) for s in splits if 1 <= (s[-1] - s[0] + 1) <= 8]


def filter_consecutive(bars, max_gap=150):
    if not bars:
        return []
    out = [bars[0]]
    for y in bars[1:]:
        if y - out[-1] <= max_gap:
            out.append(y)
        else:
            break
    return out


def build_templates(full, bars, xr1, xr2):
    templates = {}
    for d in range(1, 10):
        yb = bars[d - 1]
        gray = cv2.cvtColor(full[yb - 52 : yb - 12, xr1:xr2], cv2.COLOR_BGR2GRAY)
        ys, xs = np.where(gray < 215)
        crop = 255.0 - gray[ys.min() : ys.max() + 1, xs.min() : xs.max() + 1].astype(float)
        crop = cv2.resize(crop / max(1.0, crop.max()), (16, 20))
        templates[str(d)] = crop
    return templates


def match_digit_fallback(cell_bgr, sign, w_img, templates):
    b, g, r_ch = (
        cell_bgr[:, :, 0].astype(float),
        cell_bgr[:, :, 1].astype(float),
        cell_bgr[:, :, 2].astype(float),
    )
    ink = (255.0 - g) if sign == "-" else (255.0 - r_ch)
    ink_mask = ink > 35
    ys_all, xs_all = np.where(ink_mask)
    if len(xs_all) == 0:
        return "1"
    x2 = xs_all.max() + 1
    x1 = max(xs_all.min(), x2 - (11 if w_img == 1920 else 9))
    ys = np.where(ink_mask[:, x1:x2])[0]
    if len(ys) == 0:
        ys = ys_all
    sub_ink = ink[ys.min() : ys.max() + 1, x1:x2]
    norm = cv2.resize(sub_ink / max(1.0, sub_ink.max()), (16, 20))
    best_d, best_score = "4", -1.0
    for d, tmpl in templates.items():
        score = float(np.sum(norm * tmpl) / (np.linalg.norm(norm) * np.linalg.norm(tmpl) + 1e-6))
        if score > best_score:
            best_score = score
            best_d = d
    return best_d


def prep_crop(cell_bgr, trim_right=False, upscale=2.0):
    gray = cv2.cvtColor(cell_bgr, cv2.COLOR_BGR2GRAY)
    mask = gray < 230
    ys, xs = np.where(mask)
    if len(ys) == 0:
        return None
    y1 = max(0, ys.min() - 3)
    y2 = min(gray.shape[0], ys.max() + 4)
    x1 = max(0, xs.min() - 3)
    x2 = min(gray.shape[1], xs.max() + 4) if trim_right else gray.shape[1]
    crop = gray[y1:y2, x1:x2]

    row_ink = (crop < 225).any(axis=1)
    ink_ys = np.where(row_ink)[0]
    line_splits = np.split(ink_ys, np.where(np.diff(ink_ys) > 3)[0] + 1)
    if len(line_splits) >= 2 and (ink_ys[-1] - ink_ys[0]) > 20:
        parts = []
        max_h = max(len(s) + 6 for s in line_splits)
        for s in line_splits:
            ly1 = max(0, s[0] - 2)
            ly2 = min(crop.shape[0], s[-1] + 3)
            line_img = crop[ly1:ly2, :]
            lx = np.where((line_img < 230).any(axis=0))[0]
            if len(lx) > 0:
                line_img = line_img[:, max(0, lx[0] - 2) : min(line_img.shape[1], lx[-1] + 3)]
            pad_b = max_h - line_img.shape[0]
            line_img = cv2.copyMakeBorder(line_img, 0, pad_b, 0, 12, cv2.BORDER_CONSTANT, value=255)
            parts.append(line_img)
        crop = np.hstack(parts)

    if upscale != 1.0:
        crop = cv2.resize(crop, None, fx=upscale, fy=upscale, interpolation=cv2.INTER_CUBIC)
    crop = np.clip((crop.astype(float) - crop.min()) * 255.0 / max(1, (242 - crop.min())), 0, 255).astype(np.uint8)
    crop = cv2.copyMakeBorder(crop, 10, 10, 16, 16, cv2.BORDER_CONSTANT, value=255)
    return cv2.cvtColor(crop, cv2.COLOR_GRAY2BGR)


def prep_change(cell_bgr, min_digit_h=8):
    b, g, r = (
        cell_bgr[:, :, 0].astype(int),
        cell_bgr[:, :, 1].astype(int),
        cell_bgr[:, :, 2].astype(int),
    )
    gray = cv2.cvtColor(cell_bgr, cv2.COLOR_BGR2GRAY)
    mask = gray < 225
    ys, xs = np.where(mask)
    if len(ys) == 0 or (ys.max() - ys.min() + 1) <= 5:
        return None, "0"
    rg_diff = (r[mask] - g[mask]).mean()
    if abs(rg_diff) < 3.0 and (ys.max() - ys.min() + 1) <= 6:
        return None, "0"
    sign = "-" if rg_diff > 0 else "+"
    col_heights = []
    for x in range(gray.shape[1]):
        yk = np.where(gray[:, x] < 215)[0]
        col_heights.append(yk.max() - yk.min() + 1 if len(yk) > 0 else 0)
    digit_xs = [x for x, h in enumerate(col_heights) if h >= min_digit_h]
    x1 = max(0, digit_xs[0] - 2) if digit_xs else max(0, xs.min())
    x2 = min(gray.shape[1], xs.max() + 3)
    y1 = max(0, ys.min() - 2)
    y2 = min(gray.shape[0], ys.max() + 3)
    crop = gray[y1:y2, x1:x2]
    crop = cv2.resize(crop, None, fx=3.0, fy=3.0, interpolation=cv2.INTER_CUBIC)
    crop = np.clip((crop.astype(float) - crop.min()) * 255.0 / max(1, (240 - crop.min())), 0, 255).astype(np.uint8)
    crop = cv2.copyMakeBorder(crop, 12, 12, 20, 20, cv2.BORDER_CONSTANT, value=255)
    return cv2.cvtColor(crop, cv2.COLOR_GRAY2BGR), sign


def extract_table(full, bars, x_cols, yyyy_mm, min_digit_h=8):
    xr1, xr2, xc1, xc2, xcnt1, xcnt2, xs1, xs2 = x_cols
    w_img = full.shape[1]
    templates = build_templates(full, bars, xr1, xr2)
    crops = []
    meta = []
    prev_yb = None
    for idx, yb in enumerate(bars):
        gap = (yb - prev_yb) if prev_yb is not None else 70
        y_top = yb - min(gap - 8, 72)
        y_bot = yb - 10
        prev_yb = yb

        c_rank = prep_crop(full[y_top:y_bot, xr1:xr2], trim_right=True, upscale=2.5)
        chg_cell = full[y_top:y_bot, xc1:xc2]
        c_chg, sign = prep_change(chg_cell, min_digit_h=min_digit_h)
        c_cnt = prep_crop(full[y_top:y_bot, xcnt1:xcnt2], trim_right=True, upscale=2.0)
        c_spd = prep_crop(full[y_top:y_bot, xs1:xs2], trim_right=True, upscale=2.5)

        meta.append((idx, len(crops), sign, c_chg is not None, chg_cell))
        crops.extend([c_rank, c_cnt, c_spd])
        if c_chg is not None:
            crops.append(c_chg)

    res, _ = engine.text_rec(crops)
    rows = []
    for idx, pos, sign, has_chg, chg_cell in meta:
        rk_raw = re.sub(r"\D", "", res[pos][0])
        rank_val = int(rk_raw) if rk_raw.isdigit() else (idx + 1)
        # In case of tied ranks (e.g. two #62s followed by #64), trust OCR rank if within 1 of idx+1
        if abs(rank_val - (idx + 1)) > 1:
            rank_val = idx + 1

        cnt_raw = res[pos + 1][0].strip()
        country = resolve_country(cnt_raw)

        spd_raw = res[pos + 2][0].strip().rstrip(".")
        download_mbps = float(spd_raw)

        if not has_chg:
            rank_change = "0"
        else:
            chg_raw = res[pos + 3][0].strip().rstrip(".")
            digits_only = re.sub(r"\D", "", chg_raw)
            if digits_only:
                rank_change = f"{sign}{int(digits_only)}"
            else:
                d_fb = match_digit_fallback(chg_cell, sign, w_img, templates)
                rank_change = f"{sign}{d_fb}"

        rows.append(
            {
                "rank": rank_val,
                "country": country,
                "download_mbps": download_mbps,
                "rank_change": rank_change,
                "yyyy-mm": yyyy_mm,
            }
        )
    return rows


def main():
    all_mobile = []
    all_fixed = []

    pdf_files = sorted(
        PDF_DIR.glob("*.pdf"),
        key=lambda p: int(re.match(r"^(\d+)-", p.name).group(1)),
    )

    for f in pdf_files:
        t0 = time.time()
        m_match = re.match(r"^(\d+)-(20\d\d)", f.name)
        month_num = int(m_match.group(1))
        year_num = int(m_match.group(2))
        yyyy_mm = f"{year_num}-{month_num:02d}"

        print(f"Processing {f.name} -> period {yyyy_mm} ...")
        r = pypdf.PdfReader(f)
        imgs = [
            cv2.imdecode(np.frombuffer(im.data, np.uint8), cv2.IMREAD_COLOR)
            for im in r.pages[0].images
        ]
        full = np.vstack(imgs)
        w = full.shape[1]

        if w == 1920:
            mob_bars = filter_consecutive([y for y in find_bars(full, 272, 10) if y > 1400])
            fix_bars = filter_consecutive([y for y in find_bars(full, 854, 10) if y > 1400])
            mob_cols = (265, 315, 315, 360, 362, 695, 700, 785)
            fix_cols = (848, 898, 898, 942, 944, 1275, 1280, 1368)
            min_dh = 9
        else:
            mob_bars = filter_consecutive([y for y in find_bars(full, 738, 8) if y > 1000])
            fix_bars = filter_consecutive([y for y in find_bars(full, 1207, 8) if y > 1000])
            mob_cols = (730, 768, 768, 805, 808, 1075, 1080, 1150)
            fix_cols = (1200, 1238, 1238, 1274, 1276, 1545, 1550, 1622)
            min_dh = 8

        mob_rows = extract_table(full, mob_bars, mob_cols, yyyy_mm, min_digit_h=min_dh)
        fix_rows = extract_table(full, fix_bars, fix_cols, yyyy_mm, min_digit_h=min_dh)
        print(
            f"  Extracted {len(mob_rows)} Mobile rows and {len(fix_rows)} Fixed rows in {time.time() - t0:.1f}s"
        )
        all_mobile.extend(mob_rows)
        all_fixed.extend(fix_rows)

    # Append 2026-09 data if present in output/speedtest_mobile_271026.csv and speedtest_fixed_broadband_271026.csv
    mob_sep_csv = CSV_OUTPUT_DIR / "speedtest_mobile_271026.csv"
    if not mob_sep_csv.exists():
        mob_sep_csv = OUTPUT_DIR / "speedtest_mobile_271026.csv"
    fix_sep_csv = CSV_OUTPUT_DIR / "speedtest_fixed_broadband_271026.csv"
    if not fix_sep_csv.exists():
        fix_sep_csv = OUTPUT_DIR / "speedtest_fixed_broadband_271026.csv"
    if mob_sep_csv.exists():
        with open(mob_sep_csv, encoding="utf-8") as fp:
            sep_mob = []
            for r in csv.DictReader(fp):
                sep_mob.append(
                    {
                        "rank": int(r["rank"]),
                        "country": r["country"],
                        "download_mbps": float(r["download_mbps"]),
                        "rank_change": r["rank_change"],
                        "yyyy-mm": r["yyyy-mm"],
                    }
                )
            print(f"Appending {len(sep_mob)} Mobile rows from {mob_sep_csv.name} (2026-09)")
            all_mobile.extend(sep_mob)

    if fix_sep_csv.exists():
        with open(fix_sep_csv, encoding="utf-8") as fp:
            sep_fix = []
            for r in csv.DictReader(fp):
                sep_fix.append(
                    {
                        "rank": int(r["rank"]),
                        "country": r["country"],
                        "download_mbps": float(r["download_mbps"]),
                        "rank_change": r["rank_change"],
                        "yyyy-mm": r["yyyy-mm"],
                    }
                )
            print(f"Appending {len(sep_fix)} Fixed rows from {fix_sep_csv.name} (2026-09)")
            all_fixed.extend(sep_fix)

    # Save combined Excel file and CSV files
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    fieldnames = ["rank", "country", "download_mbps", "rank_change", "yyyy-mm"]

    excel_path = OUTPUT_DIR / "speedtest_global_index_2026_02_to_09.xlsx"
    wb = Workbook()
    ws_mob = wb.active
    ws_mob.title = "mobile"
    ws_mob.append(fieldnames)
    for r in all_mobile:
        ws_mob.append([r[col] for col in fieldnames])

    ws_fix = wb.create_sheet(title="fixed")
    ws_fix.append(fieldnames)
    for r in all_fixed:
        ws_fix.append([r[col] for col in fieldnames])

    wb.save(excel_path)
    print(f"\nSaved combined Excel workbook to: {excel_path}")
    print(f"  - Sheet 'mobile': {len(all_mobile)} rows")
    print(f"  - Sheet 'fixed':  {len(all_fixed)} rows")

    # Also update/write combined CSVs for convenience
    CSV_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    mob_csv_out = CSV_OUTPUT_DIR / "speedtest_mobile_2026_02_to_09.csv"
    fix_csv_out = CSV_OUTPUT_DIR / "speedtest_fixed_broadband_2026_02_to_09.csv"
    for path, rows in [(mob_csv_out, all_mobile), (fix_csv_out, all_fixed)]:
        with open(path, "w", newline="", encoding="utf-8") as fp:
            writer = csv.DictWriter(fp, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(rows)
        print(f"Saved CSV: {path} ({len(rows)} rows)")


if __name__ == "__main__":
    main()
