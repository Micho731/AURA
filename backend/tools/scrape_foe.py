"""Scrape the AUST / Faculty of Engineering site into plain-text files.

The AUST site is an AngularJS app — content is rendered by JavaScript, so a plain HTTP
fetch returns an empty shell. This scraper drives a headless Chromium (Playwright) to render
each page, then extracts the visible text.

It pulls page URLs from the site's sitemap.xml, keeps the engineering-relevant ones, renders
each, and writes one .txt per page to data/knowledge/raw/ (with a "SOURCE: <url>" header).

Usage (from backend/ with the venv active):
    python -m tools.scrape_foe                 # uses the keyword filter below
    python -m tools.scrape_foe --all           # scrape every page in the sitemap
    python -m tools.scrape_foe <url> [<url>..] # scrape only these exact pages

Then run:  python -m tools.ingest
"""
import os
import re
import sys
import time

import requests
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

RAW_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "data", "knowledge", "raw")
SITEMAP_URL = os.getenv("FOE_SITEMAP", "https://www.aust.edu.lb/sitemap.xml")

MAX_PAGES = int(os.getenv("SCRAPE_MAX_PAGES", "120"))
NAV_TIMEOUT_MS = int(os.getenv("SCRAPE_NAV_TIMEOUT", "30000"))
SETTLE_MS = int(os.getenv("SCRAPE_SETTLE_MS", "2500"))  # wait after networkidle for Angular to finish painting

# Keep pages whose URL hints at engineering / academics / admissions content.
KEEP_RE = re.compile(
    r"engineer|faculty-of-engineering|mechatron|biomed|cce|computer-communications|"
    r"program|admission|accredit|laborator|research|department|academic|about",
    re.I,
)


def get_sitemap_urls() -> list[str]:
    r = requests.get(SITEMAP_URL, headers={"User-Agent": "Mozilla/5.0"}, timeout=20)
    return re.findall(r"<loc>(.*?)</loc>", r.text)


def slug(url: str) -> str:
    s = re.sub(r"^https?://", "", url).strip("/").replace("/", "_")
    s = re.sub(r"[^A-Za-z0-9_.-]", "-", s)
    return (s[:80] or "index") + ".txt"


def scrape(urls: list[str]):
    from playwright.sync_api import sync_playwright

    os.makedirs(RAW_DIR, exist_ok=True)
    saved = 0
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(user_agent="Mozilla/5.0 (AURA FOE knowledge crawler)")
        for url in urls:
            if saved >= MAX_PAGES:
                break
            out_path = os.path.join(RAW_DIR, slug(url))
            if os.path.exists(out_path):
                saved += 1
                continue
            try:
                page.goto(url, timeout=NAV_TIMEOUT_MS, wait_until="networkidle")
                page.wait_for_timeout(SETTLE_MS)  # let Angular finish rendering
                text = page.evaluate(
                    """() => {
                        const el = document.querySelector('main, .main-content, #main, article') || document.body;
                        return el ? el.innerText : '';
                    }"""
                )
            except Exception as e:
                print(f"[scrape] skip {url}: {str(e)[:80]}")
                continue

            text = "\n".join(ln.strip() for ln in (text or "").splitlines() if ln.strip())
            if len(text) < 200:
                print(f"[scrape] thin  {url} ({len(text)} chars) — skipped")
                continue

            with open(out_path, "w", encoding="utf-8") as f:
                f.write(f"SOURCE: {url}\n\n{text}")
            saved += 1
            print(f"[scrape] saved ({saved}) {url}  [{len(text)} chars]")
            time.sleep(0.3)

        browser.close()
    print(f"[scrape] done — {saved} page(s) written to {RAW_DIR}")


def main():
    args = sys.argv[1:]
    if args and args[0] == "--file":
        with open(args[1], "r", encoding="utf-8-sig") as f:  # utf-8-sig strips any BOM
            urls = [ln.strip().lstrip("﻿") for ln in f if ln.strip() and not ln.startswith("#")]
        urls = [u for u in urls if u.startswith("http")]
        print(f"[scrape] {len(urls)} urls from {args[1]}")
    elif args and args[0] != "--all":
        urls = args
    else:
        all_urls = get_sitemap_urls()
        print(f"[scrape] sitemap has {len(all_urls)} urls")
        if args == ["--all"]:
            urls = all_urls
        else:
            urls = [u for u in all_urls if KEEP_RE.search(u)]
            print(f"[scrape] {len(urls)} match the engineering/academics filter")
    scrape(urls)


if __name__ == "__main__":
    main()
