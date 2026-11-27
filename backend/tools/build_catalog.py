"""Build a course catalog (codes, names, credits, PREREQUISITES, descriptions) from the program
flowchart PDFs using gpt-4o vision.

Faculty sites often don't publish course descriptions or prerequisite lists as text — but the flowchart
PDFs encode prerequisites visually (arrows from one course to the next). gpt-4o vision reads those
arrows into an explicit prerequisite map, and writes a short, clearly-generic description from each
course title. Output is saved as a searchable knowledge file per program so AURA can answer:
"what are the prerequisites of CCE 320?" / "describe MAT 201" / "what should I take before X?".

Run (from backend/, venv active):  python -m tools.build_catalog
Then:  python -m tools.ingest
"""
import io
import os
import json
import re
import urllib.request

import fitz  # pymupdf
import base64
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
from openai import OpenAI  # noqa: E402

from tools.sources import load as load_sources  # noqa: E402

INSTITUTION = os.getenv("INSTITUTION_NAME", "Example University")
RAW_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "data", "knowledge", "raw")
UA = {"User-Agent": "Mozilla/5.0"}
client = OpenAI()

# Program flowchart PDFs (the ones with prerequisite arrows), listed in tools/sources.json.
PROGRAMS = load_sources("flowchart_pdfs")

PROMPT = (
    "This image is an official university ENGINEERING/CS program flowchart. Arrows between course "
    "boxes indicate prerequisites (an arrow from A to B means A is a prerequisite of B). "
    "Extract EVERY course as JSON: an array of objects with keys: "
    "code (e.g. 'CCE 320'), name (full course title), credits (number or string), "
    "prerequisites (array of course codes that point INTO this course; [] if none), "
    "description (one concise, general sentence describing the course based on its title — phrase it "
    "as general guidance, do not invent specific syllabus details). "
    "Return ONLY the JSON array, no markdown, no commentary."
)


def pdf_to_pngs(url: str) -> list[bytes]:
    data = urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60).read()
    doc = fitz.open(stream=data, filetype="pdf")
    return [pg.get_pixmap(dpi=200).tobytes("png") for pg in doc]


def extract_courses(program: str, url: str) -> list[dict]:
    pngs = pdf_to_pngs(url)
    content = [{"type": "text", "text": PROMPT}]
    for png in pngs:
        content.append({"type": "image_url",
                        "image_url": {"url": "data:image/png;base64," + base64.b64encode(png).decode()}})
    resp = client.chat.completions.create(
        model="gpt-4o", messages=[{"role": "user", "content": content}],
        temperature=0, max_tokens=4000,
    )
    txt = resp.choices[0].message.content.strip()
    txt = re.sub(r"^```(json)?|```$", "", txt, flags=re.MULTILINE).strip()
    try:
        return json.loads(txt)
    except json.JSONDecodeError:
        m = re.search(r"\[.*\]", txt, re.DOTALL)
        return json.loads(m.group(0)) if m else []


def slug(label: str) -> str:
    return "_catalog_" + re.sub(r"[^a-z0-9]+", "-", label.lower()).strip("-") + ".txt"


def main():
    os.makedirs(RAW_DIR, exist_ok=True)
    for program, url in PROGRAMS:
        try:
            courses = extract_courses(program, url)
        except Exception as e:
            print(f"[catalog] FAILED {program}: {str(e)[:100]}")
            continue
        if not courses:
            print(f"[catalog] no courses parsed for {program}")
            continue
        lines = [f"SOURCE: {INSTITUTION} {program} official flowchart (prerequisites read from the diagram)",
                 "", f"COURSE CATALOG — {program}",
                 "(Each course: code, name, credits, prerequisites, and a general description.)", ""]
        for c in courses:
            code = c.get("code", "?"); name = c.get("name", "")
            cr = c.get("credits", ""); pre = c.get("prerequisites") or []
            desc = c.get("description", "")
            pre_s = ", ".join(pre) if pre else "none"
            lines.append(f"{code} — {name} ({cr} cr). Prerequisites: {pre_s}. {desc}")
        path = os.path.join(RAW_DIR, slug(program))
        with open(path, "w", encoding="utf-8") as f:
            f.write("\n".join(lines))
        print(f"[catalog] {program}: {len(courses)} courses -> {os.path.basename(path)}")


if __name__ == "__main__":
    main()
