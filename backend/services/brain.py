"""The brain — a lightweight local vector store over OpenAI embeddings.

Stores everything (scraped knowledge chunks + image captions) as a single numpy matrix plus
aligned JSON metadata. Cosine similarity in-process. No external vector DB.

Files:
  data/brain/index.npy   float32 matrix [N, D] of L2-normalized embeddings
  data/brain/meta.json   list[ {id, kind, text, source, meta} ] aligned row-for-row
"""
import json
import os

import numpy as np
from openai import OpenAI

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "data")
BRAIN_DIR = os.path.join(DATA_DIR, "brain")
INDEX_PATH = os.path.join(BRAIN_DIR, "index.npy")
META_PATH = os.path.join(BRAIN_DIR, "meta.json")

EMBED_MODEL = os.getenv("OPENAI_EMBED_MODEL", "text-embedding-3-small")

_client = None
_matrix = None          # np.ndarray [N, D] normalized
_meta = None            # list[dict]
_loaded_mtime = None


def _get_client() -> OpenAI:
    global _client
    if _client is None:
        _client = OpenAI()  # reads OPENAI_API_KEY from env
    return _client


def embed_texts(texts: list[str]) -> np.ndarray:
    """Return an L2-normalized [len(texts), D] float32 matrix of embeddings."""
    if not texts:
        return np.zeros((0, 1536), dtype=np.float32)
    client = _get_client()
    vectors: list[list[float]] = []
    # OpenAI allows batching; chunk to stay well under limits
    BATCH = 100
    for i in range(0, len(texts), BATCH):
        batch = texts[i:i + BATCH]
        resp = client.embeddings.create(model=EMBED_MODEL, input=batch)
        vectors.extend([d.embedding for d in resp.data])
    arr = np.array(vectors, dtype=np.float32)
    norms = np.linalg.norm(arr, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    return arr / norms


def ingest(records: list[dict]) -> int:
    """Embed and persist records. Each record: {id, kind, text, source?, meta?}.

    Replaces the whole index (idempotent rebuild). Returns the number stored.
    """
    os.makedirs(BRAIN_DIR, exist_ok=True)
    texts = [r["text"] for r in records]
    matrix = embed_texts(texts)
    meta = [
        {
            "id": r["id"],
            "kind": r.get("kind", "knowledge"),
            "text": r["text"],
            "source": r.get("source", ""),
            "meta": r.get("meta", {}),
        }
        for r in records
    ]
    np.save(INDEX_PATH, matrix)
    with open(META_PATH, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)
    # Invalidate cache so the next search reloads
    global _matrix, _meta, _loaded_mtime
    _matrix, _meta, _loaded_mtime = None, None, None
    return len(records)


def _ensure_loaded():
    global _matrix, _meta, _loaded_mtime
    if not (os.path.exists(INDEX_PATH) and os.path.exists(META_PATH)):
        _matrix, _meta = None, None
        return
    mtime = os.path.getmtime(INDEX_PATH)
    if _matrix is not None and _loaded_mtime == mtime:
        return
    _matrix = np.load(INDEX_PATH)
    with open(META_PATH, "r", encoding="utf-8") as f:
        _meta = json.load(f)
    _loaded_mtime = mtime


def is_ready() -> bool:
    _ensure_loaded()
    return _matrix is not None and len(_meta or []) > 0


def embed_query(query: str) -> np.ndarray:
    """Embed a single query string into a normalized vector (one API call)."""
    return embed_texts([query])[0]


def search_vec(qvec: np.ndarray, k: int = 5, kinds: list[str] | None = None, min_score: float = 0.0) -> list[dict]:
    """Rank against a precomputed query vector — no embedding API call here."""
    _ensure_loaded()
    if _matrix is None or not _meta:
        return []

    sims = _matrix @ qvec  # cosine since both normalized

    idxs = range(len(_meta))
    if kinds:
        idxs = [i for i in idxs if _meta[i]["kind"] in kinds]
    else:
        idxs = list(idxs)

    scored = sorted(idxs, key=lambda i: sims[i], reverse=True)
    hits = []
    for i in scored[:k]:
        score = float(sims[i])
        if score < min_score:
            continue
        m = _meta[i]
        hits.append({
            "score": score,
            "id": m["id"],
            "kind": m["kind"],
            "text": m["text"],
            "source": m["source"],
            "meta": m["meta"],
        })
    return hits


def search(query: str, k: int = 5, kinds: list[str] | None = None, min_score: float = 0.0) -> list[dict]:
    """Return up to k hits: [{score, id, kind, text, source, meta}], best first."""
    _ensure_loaded()
    if _matrix is None or not _meta:
        return []
    return search_vec(embed_query(query), k=k, kinds=kinds, min_score=min_score)
