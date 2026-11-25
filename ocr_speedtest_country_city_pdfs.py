"""
Extract Speedtest Global Index rankings (both Country Speeds and City Speeds)
from full-page PDF captures (e.g. October 2026 onwards) into a 4-sheet Excel
workbook (mobile, fixed, city_mobile, city_fixed) and CSV files.
"""

import argparse
import csv
import pathlib
import re
import time
from datetime import datetime

import cv2
import numpy as np
import pypdf
from openpyxl import Workbook
from rapidfuzz import fuzz, process
from rapidocr_onnxruntime import RapidOCR

BASE_DIR = pathlib.Path(__file__).resolve().parent
INPUT_DIR = BASE_DIR / "input" if (BASE_DIR / "input").exists() else BASE_DIR / "Speedtest Data pdf"
OUTPUT_DIR = BASE_DIR / "output"
CSV_OUTPUT_DIR = OUTPUT_DIR / "csv"

MONTH_MAP = {
    "january": "01",
    "february": "02",
    "march": "03",
    "april": "04",
    "may": "05",
    "june": "06",
    "july": "07",
    "august": "08",
    "september": "09",
    "october": "10",
    "november": "11",
    "december": "12",
    "jan": "01",
    "feb": "02",
    "mar": "03",
    "apr": "04",
    "jun": "06",
    "jul": "07",
    "aug": "08",
    "sep": "09",
    "sept": "09",
    "oct": "10",
    "nov": "11",
    "dec": "12",
}

CANONICAL_COUNTRIES = {
    "Afghanistan", "Albania", "Algeria", "Andorra", "Angola", "Antigua and Barbuda",
    "Argentina", "Armenia", "Australia", "Austria", "Azerbaijan", "Bahrain",
    "Bangladesh", "Barbados", "Belarus", "Belgium", "Belize", "Benin", "Bhutan",
    "Bolivia", "Bosnia and Herzegovina", "Botswana", "Brazil", "Brunei", "Bulgaria",
    "Burkina Faso", "Burundi", "Cabo Verde", "Cambodia", "Cameroon", "Canada",
    "Central African Republic", "Chad", "Chile", "China", "Colombia", "Comoros",
    "Costa Rica", "Côte d'Ivoire", "Croatia", "Cuba", "Cyprus", "Czechia",
    "Democratic Republic of the Congo", "Denmark", "Djibouti", "Dominica",
    "Dominican Republic", "Ecuador", "Egypt", "El Salvador", "Equatorial Guinea",
    "Eritrea", "Estonia", "Eswatini", "Ethiopia", "Fiji", "Finland", "France",
    "Gabon", "Georgia", "Germany", "Ghana", "Greece", "Grenada", "Guatemala",
    "Guinea", "Guinea-Bissau", "Guyana", "Haiti", "Honduras", "Hong Kong (SAR)",
    "Hungary", "Iceland", "India", "Indonesia", "Iran", "Iraq", "Ireland", "Israel",
    "Italy", "Jamaica", "Japan", "Jordan", "Kazakhstan", "Kenya", "Kosovo", "Kuwait",
    "Kyrgyzstan", "Laos", "Latvia", "Lebanon", "Lesotho", "Liberia", "Libya",
    "Liechtenstein", "Lithuania", "Luxembourg", "Macau (SAR)", "Madagascar",
    "Malawi", "Malaysia", "Maldives", "Mali", "Malta", "Marshall Islands",
    "Mauritania", "Mauritius", "Mexico", "Moldova", "Monaco", "Mongolia",
    "Montenegro", "Morocco", "Mozambique", "Myanmar (Burma)", "Namibia", "Nepal",
    "Netherlands", "New Zealand", "Nicaragua", "Niger", "Nigeria", "North Macedonia",
    "Norway", "Oman", "Pakistan", "Palestine", "Panama", "Papua New Guinea",
    "Paraguay", "Peru", "Philippines", "Poland", "Portugal", "Qatar",
    "Republic of the Congo", "Romania", "Russia", "Rwanda", "Saint Kitts and Nevis",
    "Saint Lucia", "Saint Vincent and the Grenadines", "Samoa", "San Marino",
    "Saudi Arabia", "Senegal", "Serbia", "Seychelles", "Sierra Leone", "Singapore",
    "Slovakia", "Slovenia", "Solomon Islands", "Somalia", "South Africa",
    "South Korea", "South Sudan", "Spain", "Sri Lanka", "Sudan", "Suriname",
    "Sweden", "Switzerland", "Syria", "Taiwan", "Tajikistan", "Tanzania", "Thailand",
    "The Bahamas", "The Gambia", "Timor-Leste", "Togo", "Tonga",
    "Trinidad and Tobago", "Tunisia", "Türkiye", "Turkmenistan", "Uganda", "Ukraine",
    "United Arab Emirates", "United Kingdom", "United States", "Uruguay",
    "Uzbekistan", "Vanuatu", "Venezuela", "Vietnam", "Yemen", "Zambia", "Zimbabwe",
}

for _csv_file in list(CSV_OUTPUT_DIR.glob("speedtest_mobile_*.csv")) + list(
    CSV_OUTPUT_DIR.glob("speedtest_fixed_broadband_*.csv")
):
    if "city" in _csv_file.name:
        continue
    with open(_csv_file, encoding="utf-8") as _fp:
        for _row in csv.DictReader(_fp):
            if _row.get("country"):
                CANONICAL_COUNTRIES.add(_row["country"].strip())

CANONICAL_COUNTRY_LIST = sorted(CANONICAL_COUNTRIES)

EXPLICIT_COUNTRY_FIXES = {
    "ira": "Iraq",
    "irag": "Iraq",
    "lraq": "Iraq",
    "lran": "Iran",
    "lsrael": "Israel",
    "srae": "Israel",
    "srae!": "Israel",
    "lceland": "Iceland",
    "lreland": "Ireland",
    "turkiye": "Türkiye",
    "türkiye": "Türkiye",
    "cote d'ivoire": "Côte d'Ivoire",
    "cote d'lvoire": "Côte d'Ivoire",
    "ei salvador": "El Salvador",
    "audi arabia": "Saudi Arabia",
    "qattr": "Qatar",
    "beigium": "Belgium",
    "ccolombia": "Colombia",
    "pilipines": "Philippines",
    "philipines": "Philippines",
    "phillipines": "Philippines",
    "tajikstan": "Tajikistan",
    "swwitzerland": "Switzerland",
    "dominican": "Dominican Republic",
}

CITIES_BY_COUNTRY = {
    "Afghanistan": ["Herat", "Kabul"],
    "Algeria": ["Algiers Province", "Oran"],
    "Angola": ["Luanda", "Lubango"],
    "Argentina": ["Buenos Aires", "Córdoba"],
    "Armenia": ["Yerevan"],
    "Australia": ["Melbourne", "Sydney"],
    "Austria": ["Vienna"],
    "Azerbaijan": ["Baku"],
    "Bahrain": ["Manama"],
    "Bangladesh": ["Chattogram", "Dhaka"],
    "Belgium": ["Antwerp", "Brussels"],
    "Benin": ["Abomey Calavi", "Cotonou"],
    "Bolivia": ["La Paz", "Santa Cruz de la Sierra"],
    "Brazil": ["Rio de Janeiro", "São Paulo"],
    "Bulgaria": ["Sofia"],
    "Burkina Faso": ["Bobo-Dioulasso", "Ouagadougou"],
    "Cambodia": ["Phnom Penh"],
    "Cameroon": ["Douala", "Yaoundé"],
    "Canada": ["Montreal", "Toronto"],
    "Chile": ["Santiago", "Valparaíso"],
    "China": ["Beijing", "Shanghai"],
    "Colombia": ["Bogotá", "Medellín"],
    "Costa Rica": ["San José"],
    "Côte d'Ivoire": ["Abidjan", "Bouaké"],
    "Croatia": ["Zagreb"],
    "Czechia": ["Prague"],
    "Democratic Republic of the Congo": ["Kinshasa", "Mbuji-Mayi"],
    "Denmark": ["Copenhagen"],
    "Dominican Republic": ["Santiago de los Caballeros", "Santo Domingo"],
    "Ecuador": ["Guayaquil", "Quito"],
    "Egypt": ["Alexandria", "Cairo"],
    "El Salvador": ["San Salvador"],
    "Ethiopia": ["Addis Ababa"],
    "Finland": ["Helsinki"],
    "France": ["Lyon", "Paris"],
    "Gabon": ["Libreville"],
    "Georgia": ["Tbilisi"],
    "Germany": ["Berlin", "Hamburg"],
    "Ghana": ["Accra", "Kumasi"],
    "Greece": ["Athens", "Thessaloniki"],
    "Guatemala": ["Guatemala City"],
    "Guinea": ["Conakry"],
    "Haiti": ["Port-au-Prince"],
    "Honduras": ["San Pedro Sula", "Tegucigalpa"],
    "Hungary": ["Budapest"],
    "India": ["Delhi", "Mumbai"],
    "Indonesia": ["Bekasi", "South Jakarta"],
    "Iraq": ["Baghdad", "Mosul"],
    "Ireland": ["Dublin"],
    "Israel": ["Haifa", "Tel Aviv-Yafo"],
    "Italy": ["Milan", "Rome"],
    "Jamaica": ["Kingston"],
    "Japan": ["Osaka", "Tokyo"],
    "Jordan": ["Amman", "Zarqa"],
    "Kazakhstan": ["Almaty", "Astana"],
    "Kenya": ["Mombasa", "Nairobi"],
    "Kuwait": ["Kuwait City"],
    "Kyrgyzstan": ["Bishkek"],
    "Laos": ["Vientiane"],
    "Latvia": ["Riga"],
    "Lebanon": ["Beirut"],
    "Libya": ["Misrata", "Tripoli"],
    "Lithuania": ["Vilnius"],
    "Madagascar": ["Antananarivo"],
    "Malaysia": ["Johor Bahru", "Kuala Lumpur"],
    "Mali": ["Bamako"],
    "Mauritania": ["Nouakchott"],
    "Mexico": ["Guadalajara", "Mexico City"],
    "Moldova": ["Chișinău"],
    "Mongolia": ["Ulaanbaatar"],
    "Morocco": ["Casablanca", "Rabat"],
    "Mozambique": ["Maputo", "Matola"],
    "Myanmar (Burma)": ["Mandalay", "Yangon"],
    "Nepal": ["Kathmandu"],
    "Netherlands": ["Amsterdam", "Rotterdam"],
    "New Zealand": ["Auckland"],
    "Nicaragua": ["Managua"],
    "Nigeria": ["Kano", "Lagos"],
    "North Macedonia": ["Skopje"],
    "Norway": ["Oslo"],
    "Oman": ["Muscat"],
    "Pakistan": ["Karachi", "Lahore"],
    "Panama": ["Panama City"],
    "Paraguay": ["Asunción"],
    "Peru": ["Arequipa", "Lima"],
    "Philippines": ["Davao City", "Manila"],
    "Poland": ["Kraków", "Warsaw"],
    "Portugal": ["Lisbon", "Porto"],
    "Qatar": ["Al-Rayyan", "Doha"],
    "Republic of the Congo": ["Brazzaville", "Pointe-Noire"],
    "Romania": ["Bucharest"],
    "Rwanda": ["Kigali"],
    "Saudi Arabia": ["Jeddah", "Riyadh"],
    "Senegal": ["Dakar"],
    "Serbia": ["Belgrade"],
    "Somalia": ["Hargeisa", "Mogadishu"],
    "South Africa": ["Cape Town", "Johannesburg"],
    "South Korea": ["Busan", "Seoul"],
    "Spain": ["Barcelona", "Madrid"],
    "Sri Lanka": ["Colombo"],
    "Sweden": ["Gothenburg", "Stockholm"],
    "Switzerland": ["Geneva", "Zürich"],
    "Taiwan": ["New Taipei", "Taipei"],
    "Tajikistan": ["Dushanbe"],
    "Tanzania": ["Dar es Salaam", "Mwanza"],
    "Thailand": ["Bangkok", "Chon Buri"],
    "Togo": ["Lomé"],
    "Trinidad and Tobago": ["Port of Spain"],
    "Tunisia": ["Sfax", "Tunis"],
    "Türkiye": ["Ankara", "Istanbul"],
    "Uganda": ["Kampala"],
    "Ukraine": ["Kharkiv", "Kyiv"],
    "United Arab Emirates": ["Abu Dhabi", "Dubai"],
    "United Kingdom": ["London", "Manchester"],
    "United States": ["Los Angeles", "New York"],
    "Uruguay": ["Montevideo"],
    "Uzbekistan": ["Samarkand", "Tashkent"],
    "Venezuela": ["Caracas", "Maracaibo"],
    "Vietnam": ["Hanoi", "Ho Chi Minh City"],
    "Yemen": ["Aden", "Sanaa"],
    "Zambia": ["Kitwe", "Lusaka"],
    "Zimbabwe": ["Bulawayo", "Harare"],
}

EXPLICIT_CITY_FIXES = {
    "beigrade": "Belgrade",
    "c6rdoba": "Córdoba",
    "cordoba": "Córdoba",
    "chisinau": "Chișinău",
    "chisinäu": "Chișinău",
    "manil": "Manila",
    "mbuj-mayi": "Mbuji-Mayi",
    "santo doming": "Santo Domingo",
    "sao paulo": "São Paulo",
    "tel aviv-afo": "Tel Aviv-Yafo",
    "tobilisi": "Tbilisi",
    "zurich": "Zürich",
    "lome": "Lomé",
    "yaounde": "Yaoundé",
    "bouake": "Bouaké",
    "bogota": "Bogotá",
    "medellin": "Medellín",
    "asuncion": "Asunción",
    "san jose": "San José",
    "valparaiso": "Valparaíso",
    "krakow": "Kraków",
}

UNIQUE_CITY_TO_COUNTRY = {}
_ambig_cities = set()
for _cnt, _cities in CITIES_BY_COUNTRY.items():
    for _ct in _cities:
        if _ct in UNIQUE_CITY_TO_COUNTRY and UNIQUE_CITY_TO_COUNTRY[_ct] != _cnt:
            _ambig_cities.add(_ct)
        else:
            UNIQUE_CITY_TO_COUNTRY[_ct] = _cnt
for _ct in _ambig_cities:
    UNIQUE_CITY_TO_COUNTRY.pop(_ct, None)

engine = RapidOCR()


def clean_ocr_text(text: str) -> str:
    text = re.sub(r"\s+", " ", text).strip()
    text = re.sub(r"^[^A-Za-zÀ-ÿ0-9]+", "", text)
    text = re.sub(r"[^A-Za-zÀ-ÿ0-9\)]+$", "", text)
    return text.strip()


def resolve_country(raw_name: str) -> str:
    cleaned = clean_ocr_text(raw_name).rstrip(".")
    low = cleaned.lower()
    if low in EXPLICIT_COUNTRY_FIXES:
        return EXPLICIT_COUNTRY_FIXES[low]
    if cleaned in CANONICAL_COUNTRIES:
        return cleaned
    match, _, _ = process.extractOne(cleaned, CANONICAL_COUNTRY_LIST, scorer=fuzz.ratio)
    return match


def resolve_city(raw_city: str, country: str) -> str:
    cleaned = clean_ocr_text(raw_city).rstrip(".")
    low = cleaned.lower()
    if low in EXPLICIT_CITY_FIXES:
        return EXPLICIT_CITY_FIXES[low]
    candidates = CITIES_BY_COUNTRY.get(country, [])
    if cleaned in candidates:
        return cleaned
    if candidates:
        match, score, _ = process.extractOne(cleaned, candidates, scorer=fuzz.WRatio)
        if score >= 82:
            return match
    if cleaned in UNIQUE_CITY_TO_COUNTRY:
        return cleaned
    all_cities = list(UNIQUE_CITY_TO_COUNTRY.keys())
    if all_cities:
        match, score, _ = process.extractOne(cleaned, all_cities, scorer=fuzz.ratio)
        if score >= 88:
            return match
    return cleaned


def split_city_country(raw_text: str) -> tuple[str, str]:
    cleaned = clean_ocr_text(raw_text)
    if "," in cleaned:
        city_part, country_part = cleaned.split(",", 1)
        country_clean = clean_ocr_text(country_part).rstrip(".")
        country = resolve_country(country_clean)
        city = resolve_city(city_part, country)
        # Cross-check if country OCR was severely truncated/corrupted
        if (
            country_clean not in CANONICAL_COUNTRIES
            and country_clean.lower() not in EXPLICIT_COUNTRY_FIXES
            and city in UNIQUE_CITY_TO_COUNTRY
        ):
            _, score, _ = process.extractOne(
                country_clean, CANONICAL_COUNTRY_LIST, scorer=fuzz.ratio
            )
            if score < 85:
                country = UNIQUE_CITY_TO_COUNTRY[city]
        return city, country

    # Fallback when OCR misses the comma (e.g. 'Helsinki Finland', 'Abu Dhabi United Arab Emirates')
    tokens = cleaned.split()
    if len(tokens) >= 2:
        # 1. Exact suffix match (longest country suffix first)
        for k in range(1, len(tokens)):
            suffix = " ".join(tokens[k:])
            low_suf = suffix.lower()
            if suffix in CANONICAL_COUNTRIES or low_suf in EXPLICIT_COUNTRY_FIXES:
                country = resolve_country(suffix)
                city = resolve_city(" ".join(tokens[:k]), country)
                return city, country

        # 2. Fuzzy suffix match (prefer highest score)
        best_k, best_country, best_score = len(tokens) - 1, "", -1.0
        for k in range(max(1, len(tokens) - 5), len(tokens)):
            suffix = " ".join(tokens[k:])
            cand, score, _ = process.extractOne(
                suffix, CANONICAL_COUNTRY_LIST, scorer=fuzz.ratio
            )
            if score > best_score:
                best_score = score
                best_k = k
                best_country = cand
        if best_country:
            city = resolve_city(" ".join(tokens[:best_k]), best_country)
            return city, best_country

    return cleaned, ""


def load_page_image(page) -> np.ndarray | None:
    """Decode embedded XObject image(s) directly to avoid pypdf's 75MB PIL buffer cap."""
    resources = page.get("/Resources")
    if not resources:
        return None
    xobjs = resources.get_object().get("/XObject")
    if not xobjs:
        return None
    xobjs = xobjs.get_object()

    arrs = []
    for _, ref in xobjs.items():
        obj = ref.get_object()
        if obj.get("/Subtype") != "/Image":
            continue
        flt = obj.get("/Filter")
        if isinstance(flt, list):
            flt = flt[0] if flt else None
        if flt == "/DCTDecode":
            arr = cv2.imdecode(np.frombuffer(obj._data, np.uint8), cv2.IMREAD_COLOR)
        else:
            raw = obj.get_data()
            arr = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR)
            if arr is None:
                h, w = int(obj["/Height"]), int(obj["/Width"])
                arr = np.frombuffer(raw, np.uint8).reshape((h, w, -1))
                if arr.shape[2] == 3:
                    arr = cv2.cvtColor(arr, cv2.COLOR_RGB2BGR)
        if arr is not None:
            arrs.append(arr)

    if not arrs:
        return None
    return np.vstack(arrs) if len(arrs) > 1 else arrs[0]


def parse_period_from_text(text: str) -> str:
    """Parse YYYY-MM from header text (normalizing OCR '2o26' -> '2026') or filename."""
    norm = re.sub(r"(?<=2)[oO](?=\d\d)", "0", text)
    norm = re.sub(r"(?<=20\d)[oO]", "0", norm)
    months_pat = "|".join(sorted(MONTH_MAP.keys(), key=len, reverse=True))
    m = re.search(rf"({months_pat})\s*(20\d\d)", norm, re.IGNORECASE)
    if m:
        mm = MONTH_MAP[m.group(1).lower()]
        return f"{m.group(2)}-{mm}"

    m_num = re.search(r"\b(\d{1,2})-(20\d\d)\b", text)
    if m_num and 1 <= int(m_num.group(1)) <= 12:
        return f"{m_num.group(2)}-{int(m_num.group(1)):02d}"
    return ""


def inspect_page_header(full: np.ndarray) -> tuple[str, str]:
    """Return (page_kind, yyyy_mm) where page_kind is 'country', 'city', or 'other'."""
    h, w, _ = full.shape
    if h < 4000:
        return "other", ""

    hdr_crop = full[int(w * 0.07) : int(w * 0.22), int(w * 0.20) : int(w * 0.80)]
    res, _ = engine(hdr_crop)
    lines = [item[1] for item in (res or [])]
    joined = " ".join(lines)
    yyyy_mm = parse_period_from_text(joined)

    for line in lines:
        compact = re.sub(r"[^a-z0-9]", "", line.lower())
        if compact.startswith("mediancountryspeeds"):
            return "country", yyyy_mm
        if compact.startswith("mediancityspeeds"):
            return "city", yyyy_mm
    return "other", yyyy_mm


def detect_table_x(full: np.ndarray) -> tuple[int, int] | tuple[None, None]:
    """Auto-detect left X coordinates of Mobile and Fixed Broadband speed bars."""
    h, _, _ = full.shape
    y1, y2 = min(h, 2500), min(h, 5000)
    if y2 <= y1 + 100:
        return None, None
    sub = full[y1:y2, :]
    b, g, rc = (
        sub[:, :, 0].astype(int),
        sub[:, :, 1].astype(int),
        sub[:, :, 2].astype(int),
    )
    teal = (b - rc > 45) & (g - rc > 30)

    starts = []
    for ry in range(teal.shape[0]):
        xs = np.where(teal[ry])[0]
        if len(xs) < 20:
            continue
        runs = np.split(xs, np.where(np.diff(xs) > 5)[0] + 1)
        for run in runs:
            if len(run) >= 20:
                starts.append(int(run[0]))
    if not starts:
        return None, None

    starts_arr = np.array(starts)
    mid = (starts_arr.min() + starts_arr.max()) / 2.0
    left_s = starts_arr[starts_arr < mid]
    right_s = starts_arr[starts_arr >= mid]
    if len(left_s) == 0 or len(right_s) == 0:
        return None, None
    return int(np.median(left_s)), int(np.median(right_s))


def find_bars(img: np.ndarray, x_start: int, width: int = 12, min_y: int = 1150) -> list[int]:
    """Find thin horizontal teal speed bars (even 2-px wide bottom rows)."""
    strip = img[:, max(0, x_start) : x_start + width]
    b, g, rc = (
        strip[:, :, 0].astype(int),
        strip[:, :, 1].astype(int),
        strip[:, :, 2].astype(int),
    )
    teal_cnt = ((b - rc > 40) & (g - rc > 25)).sum(axis=1)
    bar_ys = np.where(teal_cnt >= 2)[0]
    if len(bar_ys) == 0:
        return []
    splits = np.split(bar_ys, np.where(np.diff(bar_ys) > 15)[0] + 1)
    bars = [
        int(s.mean())
        for s in splits
        if 1 <= (s[-1] - s[0] + 1) <= 8 and int(s.mean()) > min_y
    ]
    if not bars:
        return []
    out = [bars[0]]
    for y in bars[1:]:
        if y - out[-1] <= 150:
            out.append(y)
        else:
            break
    return out


def build_templates(full: np.ndarray, bars: list[int], xr1: int, xr2: int) -> dict[str, np.ndarray]:
    templates = {}
    for d in range(1, min(10, len(bars) + 1)):
        yb = bars[d - 1]
        gray = cv2.cvtColor(full[yb - 52 : yb - 12, xr1:xr2], cv2.COLOR_BGR2GRAY)
        ys, xs = np.where(gray < 215)
        if len(ys) == 0:
            continue
        crop = 255.0 - gray[ys.min() : ys.max() + 1, xs.min() : xs.max() + 1].astype(float)
        crop = cv2.resize(crop / max(1.0, crop.max()), (16, 20))
        templates[str(d)] = crop
    return templates


def match_digit_fallback(cell_bgr: np.ndarray, sign: str, w_img: int, templates: dict) -> str:
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
    x1 = max(xs_all.min(), x2 - (11 if w_img <= 2000 else 9))
    ys = np.where(ink_mask[:, x1:x2])[0]
    if len(ys) == 0:
        ys = ys_all
    sub_ink = ink[ys.min() : ys.max() + 1, x1:x2]
    norm = cv2.resize(sub_ink / max(1.0, sub_ink.max()), (16, 20))
    best_d, best_score = "4", -1.0
    for d, tmpl in templates.items():
        score = float(
            np.sum(norm * tmpl) / (np.linalg.norm(norm) * np.linalg.norm(tmpl) + 1e-6)
        )
        if score > best_score:
            best_score = score
            best_d = d
    return best_d


def prep_single_line(line_gray: np.ndarray, upscale: float = 2.0) -> np.ndarray | None:
    if (line_gray < 205).sum() < 8:
        return None
    lx = np.where((line_gray < 230).any(axis=0))[0]
    if len(lx) == 0:
        return None
    crop = line_gray[:, max(0, lx[0] - 3) : min(line_gray.shape[1], lx[-1] + 4)]
    if upscale != 1.0:
        crop = cv2.resize(
            crop, None, fx=upscale, fy=upscale, interpolation=cv2.INTER_CUBIC
        )
    crop = np.clip(
        (crop.astype(float) - crop.min()) * 255.0 / max(1, (242 - crop.min())),
        0,
        255,
    ).astype(np.uint8)
    crop = cv2.copyMakeBorder(crop, 10, 10, 16, 16, cv2.BORDER_CONSTANT, value=255)
    return cv2.cvtColor(crop, cv2.COLOR_GRAY2BGR)


def prep_crop_lines(
    cell_bgr: np.ndarray, trim_right: bool = False, upscale: float = 2.0
) -> list[np.ndarray]:
    """Crop cell text; split 2-line cells cleanly via horizontal ink valley."""
    gray = cv2.cvtColor(cell_bgr, cv2.COLOR_BGR2GRAY)
    # Trim faint top/bottom divider borders using dark ink (< 215), keep full horizontal gray ink (< 230)
    ys_dark = np.where((gray < 215).any(axis=1))[0]
    xs_ink = np.where((gray < 230).any(axis=0))[0]
    if len(ys_dark) == 0 or len(xs_ink) == 0:
        return []
    y1 = max(0, ys_dark.min() - 3)
    y2 = min(gray.shape[0], ys_dark.max() + 4)
    x1 = max(0, xs_ink.min() - 3)
    x2 = min(gray.shape[1], xs_ink.max() + 4) if trim_right else gray.shape[1]
    crop = gray[y1:y2, x1:x2]

    h_c = crop.shape[0]
    if h_c >= 32:
        ink_frac = (crop < 215).mean(axis=1)
        mid_start, mid_end = int(h_c * 0.28), int(h_c * 0.72)
        if mid_end > mid_start:
            split_rel = mid_start + int(np.argmin(ink_frac[mid_start:mid_end]))
            top_sub = crop[: split_rel + 2, :]
            bot_sub = crop[max(0, split_rel - 1) :, :]
            if (
                ink_frac[split_rel] < 0.05
                and (top_sub < 205).sum() >= 20
                and (bot_sub < 205).sum() >= 20
            ):
                out = []
                for sub in (top_sub, bot_sub):
                    sy = np.where((sub < 220).any(axis=1))[0]
                    if len(sy) > 0 and (sy[-1] - sy[0] + 1) >= 8:
                        c = prep_single_line(
                            sub[max(0, sy[0] - 2) : min(sub.shape[0], sy[-1] + 3), :],
                            upscale=upscale,
                        )
                        if c is not None:
                            out.append(c)
                if len(out) == 2:
                    return out

    c = prep_single_line(crop, upscale=upscale)
    return [c] if c is not None else []


def prep_change(cell_bgr: np.ndarray, min_digit_h: int = 8) -> tuple[np.ndarray | None, str]:
    _, g, rc = (
        cell_bgr[:, :, 0].astype(int),
        cell_bgr[:, :, 1].astype(int),
        cell_bgr[:, :, 2].astype(int),
    )
    gray = cv2.cvtColor(cell_bgr, cv2.COLOR_BGR2GRAY)
    mask = gray < 225
    ys, xs = np.where(mask)
    if len(ys) == 0 or (ys.max() - ys.min() + 1) <= 5:
        return None, "0"
    rg_diff = (rc[mask] - g[mask]).mean()
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
    crop = np.clip(
        (crop.astype(float) - crop.min()) * 255.0 / max(1, (240 - crop.min())),
        0,
        255,
    ).astype(np.uint8)
    crop = cv2.copyMakeBorder(crop, 12, 12, 20, 20, cv2.BORDER_CONSTANT, value=255)
    return cv2.cvtColor(crop, cv2.COLOR_GRAY2BGR), sign


def make_col_bounds(x_left: int, scale: float) -> tuple[int, ...]:
    return (
        int(round(x_left - 6 * scale)),
        int(round(x_left + 32 * scale)),
        int(round(x_left + 32 * scale)),
        int(round(x_left + 70 * scale)),
        int(round(x_left + 70 * scale)),
        int(round(x_left + 342 * scale)),
        int(round(x_left + 342 * scale)),
        int(round(x_left + 420 * scale)),
    )


def extract_table(
    full: np.ndarray,
    bars: list[int],
    x_cols: tuple[int, ...],
    yyyy_mm: str,
    is_city: bool,
    min_digit_h: int = 8,
) -> list[dict]:
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

        c_rk = prep_crop_lines(full[y_top:y_bot, xr1:xr2], trim_right=True, upscale=2.5)
        chg_cell = full[y_top:y_bot, xc1:xc2]
        c_chg, sign = prep_change(chg_cell, min_digit_h=min_digit_h)
        c_nm = prep_crop_lines(
            full[y_top:y_bot, xcnt1:xcnt2], trim_right=True, upscale=2.0
        )
        c_sp = prep_crop_lines(full[y_top:y_bot, xs1:xs2], trim_right=True, upscale=2.5)

        rk_slice = (len(crops), len(crops) + len(c_rk))
        crops.extend(c_rk)
        nm_slice = (len(crops), len(crops) + len(c_nm))
        crops.extend(c_nm)
        sp_slice = (len(crops), len(crops) + len(c_sp))
        crops.extend(c_sp)
        chg_idx = None
        if c_chg is not None:
            chg_idx = len(crops)
            crops.append(c_chg)

        meta.append((idx, rk_slice, nm_slice, sp_slice, chg_idx, sign, chg_cell))

    res, _ = engine.text_rec(crops)
    rows = []
    for idx, rk_s, nm_s, sp_s, chg_i, sign, chg_cell in meta:
        rk_raw = re.sub(r"\D", "", "".join(res[i][0] for i in range(*rk_s)))
        rank_val = int(rk_raw) if rk_raw.isdigit() else (idx + 1)
        if abs(rank_val - (idx + 1)) > 1:
            rank_val = idx + 1

        nm_raw = " ".join(res[i][0].strip() for i in range(*nm_s))
        sp_raw = "".join(res[i][0] for i in range(*sp_s)).strip().rstrip(".")
        download_mbps = float(re.sub(r"[^\d\.]", "", sp_raw))

        if chg_i is None:
            rank_change = "0"
        else:
            digits_only = re.sub(r"\D", "", res[chg_i][0])
            if digits_only:
                rank_change = f"{sign}{int(digits_only)}"
            else:
                d_fb = match_digit_fallback(chg_cell, sign, w_img, templates)
                rank_change = f"{sign}{d_fb}"

        if is_city:
            city, country = split_city_country(nm_raw)
            rows.append(
                {
                    "rank": rank_val,
                    "city": city,
                    "country": country,
                    "download_mbps": download_mbps,
                    "rank_change": rank_change,
                    "yyyy-mm": yyyy_mm,
                }
            )
        else:
            country = resolve_country(nm_raw)
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


def extract_page_pair(full: np.ndarray, yyyy_mm: str, is_city: bool) -> tuple[list[dict], list[dict]]:
    x_mob, x_fix = detect_table_x(full)
    if x_mob is None or x_fix is None:
        return [], []
    scale = (x_fix - x_mob) / 465.0
    min_dh = 9 if full.shape[1] <= 2000 else 8
    min_y = int(round(1150 * scale)) if full.shape[1] <= 2000 else 1150

    mob_bars = find_bars(full, x_mob - 3, width=int(round(12 * scale)), min_y=min_y)
    fix_bars = find_bars(full, x_fix - 3, width=int(round(12 * scale)), min_y=min_y)

    mob_cols = make_col_bounds(x_mob, scale)
    fix_cols = make_col_bounds(x_fix, scale)

    mob_rows = extract_table(
        full, mob_bars, mob_cols, yyyy_mm, is_city=is_city, min_digit_h=min_dh
    )
    fix_rows = extract_table(
        full, fix_bars, fix_cols, yyyy_mm, is_city=is_city, min_digit_h=min_dh
    )
    return mob_rows, fix_rows


def process_pdf(pdf_path: pathlib.Path) -> dict | None:
    """Process a PDF containing Country Speeds and City Speeds pages."""
    t0 = time.time()
    reader = pypdf.PdfReader(pdf_path)
    fallback_period = parse_period_from_text(pdf_path.stem)

    country_img = None
    city_img = None
    detected_period = ""

    for page in reader.pages:
        img = load_page_image(page)
        if img is None or img.shape[0] < 4000:
            continue
        kind, period = inspect_page_header(img)
        if period and not detected_period:
            detected_period = period
        if kind == "country" and country_img is None:
            country_img = img
        elif kind == "city" and city_img is None:
            city_img = img

    if city_img is None and country_img is None:
        return None
    if city_img is None:
        print(f"Skipping {pdf_path.name} (Country-only PDF, no City Speeds page found).")
        return None

    yyyy_mm = detected_period or fallback_period or datetime.now().strftime("%Y-%m")
    print(f"Processing '{pdf_path.name}' -> period {yyyy_mm} ...")

    c_mob, c_fix = ([], [])
    if country_img is not None:
        c_mob, c_fix = extract_page_pair(country_img, yyyy_mm, is_city=False)

    city_mob, city_fix = extract_page_pair(city_img, yyyy_mm, is_city=True)

    elapsed = time.time() - t0
    print(
        f"  Country: {len(c_mob)} Mobile, {len(c_fix)} Fixed | "
        f"City: {len(city_mob)} Mobile, {len(city_fix)} Fixed ({elapsed:.1f}s)"
    )
    return {
        "yyyy_mm": yyyy_mm,
        "mobile": c_mob,
        "fixed": c_fix,
        "city_mobile": city_mob,
        "city_fixed": city_fix,
    }


def build_period_suffix(periods: list[str]) -> str:
    unique = sorted(set(periods))
    if not unique:
        return datetime.now().strftime("%Y_%m")
    if len(unique) == 1:
        return unique[0].replace("-", "_")
    first, last = unique[0], unique[-1]
    if first[:4] == last[:4]:
        return f"{first.replace('-', '_')}_to_{last[5:]}"
    return f"{first.replace('-', '_')}_to_{last.replace('-', '_')}"


def write_csv(rows: list[dict], fieldnames: list[str], filepath: pathlib.Path) -> None:
    filepath.parent.mkdir(parents=True, exist_ok=True)
    with open(filepath, "w", newline="", encoding="utf-8") as fp:
        writer = csv.DictWriter(fp, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)
    print(f"Saved CSV: {filepath} ({len(rows)} rows)")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="OCR Speedtest Global Index PDFs (Country Speeds + City Speeds)."
    )
    parser.add_argument(
        "--pdf",
        nargs="*",
        help="Optional path(s) to specific PDF file(s). Defaults to scanning input/ for Country+City PDFs.",
    )
    args = parser.parse_args()

    if args.pdf:
        candidate_pdfs = [pathlib.Path(p) for p in args.pdf]
    else:
        candidate_pdfs = [
            p
            for p in sorted(INPUT_DIR.glob("*.pdf"))
            if "by country" not in p.name.lower()
        ]

    if not candidate_pdfs:
        print(f"No Country+City PDF files found in {INPUT_DIR}")
        return

    results = []
    for pdf_path in candidate_pdfs:
        res = process_pdf(pdf_path)
        if res is not None:
            results.append(res)

    if not results:
        print("No PDFs with City Speeds were found to process.")
        return

    results.sort(key=lambda r: r["yyyy_mm"])

    all_mobile = []
    all_fixed = []
    all_city_mobile = []
    all_city_fixed = []
    periods = []

    for r in results:
        periods.append(r["yyyy_mm"])
        all_mobile.extend(r["mobile"])
        all_fixed.extend(r["fixed"])
        all_city_mobile.extend(r["city_mobile"])
        all_city_fixed.extend(r["city_fixed"])

    suffix = build_period_suffix(periods)
    country_fields = ["rank", "country", "download_mbps", "rank_change", "yyyy-mm"]
    city_fields = ["rank", "city", "country", "download_mbps", "rank_change", "yyyy-mm"]

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    excel_path = OUTPUT_DIR / f"speedtest_country_city_{suffix}.xlsx"

    wb = Workbook()
    sheets_spec = [
        ("mobile", all_mobile, country_fields),
        ("fixed", all_fixed, country_fields),
        ("city_mobile", all_city_mobile, city_fields),
        ("city_fixed", all_city_fixed, city_fields),
    ]
    for idx, (sheet_name, rows, fields) in enumerate(sheets_spec):
        ws = wb.active if idx == 0 else wb.create_sheet(title=sheet_name)
        ws.title = sheet_name
        ws.append(fields)
        for row in rows:
            ws.append([row[col] for col in fields])

    wb.save(excel_path)
    print(f"\nSaved combined Excel workbook to: {excel_path}")
    for sheet_name, rows, _ in sheets_spec:
        print(f"  - Sheet '{sheet_name}': {len(rows)} rows")

    csv_specs = [
        (CSV_OUTPUT_DIR / f"speedtest_mobile_{suffix}.csv", all_mobile, country_fields),
        (CSV_OUTPUT_DIR / f"speedtest_fixed_broadband_{suffix}.csv", all_fixed, country_fields),
        (CSV_OUTPUT_DIR / f"speedtest_city_mobile_{suffix}.csv", all_city_mobile, city_fields),
        (CSV_OUTPUT_DIR / f"speedtest_city_fixed_broadband_{suffix}.csv", all_city_fixed, city_fields),
    ]
    for path, rows, fields in csv_specs:
        write_csv(rows, fields, path)


if __name__ == "__main__":
    main()
