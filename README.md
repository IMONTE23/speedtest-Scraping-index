# Speedtest Global Index Scraper

This project scrapes the Speedtest Global Index rankings for:

- Mobile (Median)
- Fixed Broadband (Median)

It writes the results to the `output/` folder as date-stamped CSV files.

## Requirements

Install dependencies:

```bash
pip install DrissionPage beautifulsoup4
```

## Run

```bash
python scrape_speedtest_global_index.py
```

Optional headed mode:

```bash
python scrape_speedtest_global_index.py --headed
```

## Output

Each run generates two date-stamped files in `output/`:

- `speedtest_mobile_YYMMDD.csv`
- `speedtest_fixed_broadband_YYMMDD.csv`
