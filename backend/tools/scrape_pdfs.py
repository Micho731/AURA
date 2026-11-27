"""Scrape the engineering course-flowchart / study-plan PDFs into plain text.

Many faculty sites publish program curricula as downloadable PDFs (e.g. MTE-Flow-2024.pdf), not as
text on the page — so the normal HTML scraper only captures the nav menu, never the courses.
This tool visits each program page, finds the linked PDF(s), extracts their text with pypdf, and
writes one .txt per PDF into data/knowledge/raw/ so `tools.ingest` can embed them.

Usage (from backend/ with the venv active):
    python -m tools.scrape_pdfs
"""
import io
import os
import re
import urllib.request

from pypdf import PdfReader

from tools.sources import load as load_sources

RAW_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "data", "knowledge", "raw")
UA = {"User-Agent": "Mozilla/5.0 (AURA FOE knowledge crawler)"}

# Program pages whose linked PDF flowcharts hold the actual course lists (see tools/sources.py).
PROGRAM_PAGES = load_sources("program_pages")


def find_pdf_urls(page_url: str) -> list[str]:
    """Render the page and collect any linked/embedded PDF URLs."""
    from playwright.sync_api import sync_playwright
    urls: list[str] = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        pg = browser.new_page(user_agent=UA["User-Agent"])
        try:
            pg.goto(page_url, wait_until="networkidle", timeout=30000)
            pg.wait_for_timeout(2000)
            urls = pg.evaluate(
                """() => Array.from(document.querySelectorAll('a[href$=".pdf"],iframe[src*=".pdf"],embed[src*=".pdf"],object[data*=".pdf"]'))
                        .map(e => e.href || e.src || e.data).filter(Boolean)"""
            )
        except Exception as e:
            print(f"[pdf] could not load {page_url}: {str(e)[:80]}")
        browser.close()
    # de-dupe, preserve order
    seen, out = set(), []
    for u in urls:
        if u not in seen:
            seen.add(u); out.append(u)
    return out


def pdf_to_text(pdf_url: str) -> str:
    data = urllib.request.urlopen(urllib.request.Request(pdf_url, headers=UA), timeout=40).read()
    reader = PdfReader(io.BytesIO(data))
    text = "\n".join((p.extract_text() or "") for p in reader.pages)
    # tidy whitespace
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def slug(label: str) -> str:
    s = re.sub(r"[^A-Za-z0-9]+", "-", label).strip("-").lower()
    return f"_curriculum_{s}.txt"


def main():
    os.makedirs(RAW_DIR, exist_ok=True)
    saved = 0
    for label, page in PROGRAM_PAGES:
        pdfs = find_pdf_urls(page)
        if not pdfs:
            print(f"[pdf] no PDF found on: {label}")
            continue
        chunks = []
        for u in pdfs:
            try:
                txt = pdf_to_text(u)
                if len(txt) > 100:
                    chunks.append(f"[{u}]\n{txt}")
                    print(f"[pdf] {label}: extracted {len(txt)} chars from {u.split('/')[-1]}")
            except Exception as e:
                print(f"[pdf] failed {u}: {str(e)[:80]}")
        if not chunks:
            continue
        body = (
            f"SOURCE: {page}\n\n"
            f"FACULTY OF ENGINEERING — COURSE FLOWCHART / STUDY PLAN\n"
            f"Program: {label}\n"
            f"(The following are the courses in this program's official study plan, with course codes and credit hours.)\n\n"
            + "\n\n".join(chunks)
        )
        with open(os.path.join(RAW_DIR, slug(label)), "w", encoding="utf-8") as f:
            f.write(body)
        saved += 1
    print(f"[pdf] done — {saved} curriculum file(s) written to {RAW_DIR}")


if __name__ == "__main__":
    main()
