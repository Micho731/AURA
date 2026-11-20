"""Build the brain: embed scraped knowledge + FAQ + image captions into the vector store.

Usage (from backend/ with venv active):
    python -m tools.ingest

Reads:
  data/knowledge/raw/*.txt   (scraped pages; first line "SOURCE: <url>")
  data/faq.json              (curated Q&A)
  data/media/manifest.json   (image captions/tags)
Writes the embedded index via services.brain.ingest().
"""
import os
import glob

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

import db                       # noqa: E402
from services import brain      # noqa: E402

RAW_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "data", "knowledge", "raw")

CHUNK_CHARS = 1200      # ~ a few hundred tokens per chunk
CHUNK_OVERLAP = 150


def _chunk(text: str) -> list[str]:
    text = text.strip()
    if len(text) <= CHUNK_CHARS:
        return [text]
    chunks = []
    start = 0
    while start < len(text):
        end = min(start + CHUNK_CHARS, len(text))
        chunks.append(text[start:end])
        if end == len(text):
            break
        start = end - CHUNK_OVERLAP
    return chunks


def collect_records() -> list[dict]:
    records: list[dict] = []

    # 1. Scraped pages
    for path in glob.glob(os.path.join(RAW_DIR, "*.txt")):
        with open(path, "r", encoding="utf-8") as f:
            content = f.read()
        source = ""
        if content.startswith("SOURCE:"):
            first, _, rest = content.partition("\n")
            source = first.replace("SOURCE:", "").strip()
            content = rest.strip()
        base = os.path.splitext(os.path.basename(path))[0]
        for i, ch in enumerate(_chunk(content)):
            records.append({
                "id": f"page::{base}::{i}",
                "kind": "knowledge",
                "text": ch,
                "source": source or base,
            })

    # 2. Curated FAQ
    for i, faq in enumerate(db.get_faqs()):
        records.append({
            "id": f"faq::{i}",
            "kind": "knowledge",
            "text": f"Q: {faq['question']}\nA: {faq['answer']}",
            "source": "FAQ",
        })

    # 3. Image manifest → searchable by caption + tags
    for m in db.list_media():
        caption = m.get("caption", "")
        tags = ", ".join(m.get("tags", []))
        category = m.get("category", "")
        records.append({
            "id": m["file"],            # id == filename, so chat.py can resolve the URL
            "kind": "media",
            "text": f"{caption}. Category: {category}. Tags: {tags}",
            "source": "media",
            "meta": {"caption": caption, "file": m["file"], "tags": m.get("tags", []), "category": category},
        })

    # 4. Info board (events / deadlines / hours / notices) → searchable knowledge
    for it in db.list_info():
        when = " ".join(x for x in [it.get("date", ""), it.get("end_date", "")] if x)
        where = it.get("location", "")
        campus = it.get("campus", "") or "all campuses"
        records.append({
            "id": f"info::{it['id']}",
            "kind": "knowledge",
            "text": (f"[{it.get('kind','notice').upper()}] {it.get('title','')}. {it.get('detail','')}"
                     f"{(' Date: ' + when) if when else ''}{(' Location: ' + where) if where else ''}"
                     f" Campus: {campus}."),
            "source": "info-board",
        })

    # 5. Offices (who/where routing) → searchable knowledge
    for o in db.list_offices():
        campus = o.get("campus", "") or "all campuses"
        extra = " ".join(x for x in [
            ("Hours: " + o["hours"]) if o.get("hours") else "",
            ("Phone: " + o["phone"]) if o.get("phone") else "",
            ("Email: " + o["email"]) if o.get("email") else "",
        ] if x)
        records.append({
            "id": f"office::{o['id']}",
            "kind": "knowledge",
            "text": (f"OFFICE: {o.get('name','')}. Handles: {o.get('purpose','')}. "
                     f"Location: {o.get('location','')}. {extra} Campus: {campus}."),
            "source": "offices",
        })

    return records


def run() -> dict:
    """Re-embed everything (pages + FAQ + media) into the brain. Returns a small summary.

    Callable from the API (e.g. after a media upload) so the index stays in sync without a subprocess.
    """
    records = collect_records()
    if not records:
        return {"records": 0, "knowledge": 0, "media": 0}
    knowledge = sum(1 for r in records if r["kind"] == "knowledge")
    media = sum(1 for r in records if r["kind"] == "media")
    n = brain.ingest(records)
    return {"records": n, "knowledge": knowledge, "media": media}


if __name__ == "__main__":
    records = collect_records()
    if not records:
        print("[ingest] nothing to ingest — scrape pages or add FAQ/media first.")
        raise SystemExit(0)
    knowledge = sum(1 for r in records if r["kind"] == "knowledge")
    media = sum(1 for r in records if r["kind"] == "media")
    print(f"[ingest] embedding {len(records)} records ({knowledge} knowledge, {media} media)…")
    n = brain.ingest(records)
    print(f"[ingest] done — {n} records embedded into the brain.")
