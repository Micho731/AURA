"""Where the knowledge-base tools read from.

Edit tools/sources.json (copy it from sources.example.json) to point AURA at your own
faculty website: program pages that link curriculum PDFs, and flowchart PDFs with
prerequisite arrows. The example file uses placeholder example.edu addresses.
"""
import json
import os

_HERE = os.path.dirname(__file__)


def load(key: str) -> list[tuple[str, str]]:
    path = os.path.join(_HERE, "sources.json")
    if not os.path.exists(path):
        path = os.path.join(_HERE, "sources.example.json")
    with open(path, encoding="utf-8") as f:
        return [(item["name"], item["url"]) for item in json.load(f).get(key, [])]
