"""Admin endpoints — manage faculty roster + media/flowchart library + knowledge documents."""
import os
import re
import uuid
import asyncio
from datetime import datetime

from fastapi import APIRouter, HTTPException, UploadFile, File, Form

from pydantic import BaseModel

import db

router = APIRouter()

MEDIA_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "data", "media")
RAW_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "data", "knowledge", "raw")
ALLOWED_EXT = {".jpg", ".jpeg", ".png", ".webp", ".gif"}


def _safe_filename(name: str) -> str:
    base = os.path.basename(name or "image")
    base = re.sub(r"[^A-Za-z0-9._-]", "-", base).strip("-") or "image"
    return base[:100]


async def _reingest():
    """Rebuild the brain so newly added/removed media is searchable. Runs off the event loop."""
    from tools import ingest
    return await asyncio.to_thread(ingest.run)


class AddFacultyRequest(BaseModel):
    name: str
    dept: str
    office: str
    title: str = ""


class HomeCampusUpdate(BaseModel):
    campus: str


@router.get("/settings")
async def get_settings():
    return {"home_campus": db.get_home_campus(), "campuses": db.VALID_CAMPUSES}


@router.post("/settings/home-campus")
async def set_home_campus(req: HomeCampusUpdate):
    if not db.set_home_campus(req.campus):
        raise HTTPException(status_code=400, detail=f"Campus must be one of {db.VALID_CAMPUSES}")
    return {"success": True, "home_campus": req.campus}


@router.get("/faculty")
async def list_all():
    return {"faculty": db.list_faculty(include_password=True)}


@router.post("/faculty")
async def add(req: AddFacultyRequest):
    record = db.add_faculty(req.name, req.dept, req.office, req.title)
    return {"success": True, "faculty": record}


@router.delete("/faculty/{faculty_id}")
async def delete(faculty_id: str):
    if not db.get_faculty(faculty_id):
        raise HTTPException(status_code=404, detail="Faculty not found")
    db.delete_faculty(faculty_id)
    return {"success": True}


# ------- Media / flowchart library -------------------------------------------

@router.get("/media")
async def list_media():
    """List media entries; each gets a /media/<file> URL for preview."""
    items = [{**m, "url": f"/media/{m['file']}"} for m in db.list_media()]
    return {"media": items}


@router.post("/media")
async def upload_media(
    image: UploadFile = File(...),
    caption: str = Form(...),
    tags: str = Form(""),
    category: str = Form(""),
):
    """Save an uploaded image/flowchart, record it in the manifest, and re-ingest the brain."""
    ext = os.path.splitext(image.filename or "")[1].lower()
    if ext not in ALLOWED_EXT:
        raise HTTPException(status_code=400, detail=f"Unsupported file type {ext or '?'}")

    os.makedirs(MEDIA_DIR, exist_ok=True)
    fname = _safe_filename(image.filename)
    # avoid clobbering a different existing file with the same name
    stem, dot, e = fname.rpartition(".")
    n = 1
    while os.path.exists(os.path.join(MEDIA_DIR, fname)) and not db.get_media(fname):
        fname = f"{stem}-{n}{dot}{e}"
        n += 1

    data = await image.read()
    with open(os.path.join(MEDIA_DIR, fname), "wb") as f:
        f.write(data)

    tag_list = [t.strip() for t in tags.split(",") if t.strip()]
    entry = db.add_media(fname, caption.strip(), tag_list, category.strip())
    summary = await _reingest()
    return {"success": True, "media": {**entry, "url": f"/media/{fname}"}, "ingest": summary}


@router.delete("/media/{file}")
async def delete_media(file: str):
    safe = _safe_filename(file)
    if not db.delete_media(safe):
        raise HTTPException(status_code=404, detail="Media not found")
    path = os.path.join(MEDIA_DIR, safe)
    if os.path.exists(path):
        try:
            os.remove(path)
        except OSError:
            pass
    summary = await _reingest()
    return {"success": True, "ingest": summary}


# ------- Info board (calendar / deadlines / events / hours / notices) --------

class InfoEntry(BaseModel):
    kind: str = "notice"        # event | deadline | hours | notice
    title: str
    detail: str = ""
    date: str = ""              # YYYY-MM-DD (optional)
    end_date: str = ""
    location: str = ""
    campus: str = ""           # "" = all campuses


@router.get("/info")
async def list_info():
    return {"info": db.list_info()}


@router.post("/info")
async def add_info(req: InfoEntry):
    if not req.title.strip():
        raise HTTPException(status_code=400, detail="Title is required")
    entry = db.add_info(req.kind.strip() or "notice", req.title.strip(), req.detail.strip(),
                        req.date.strip(), req.end_date.strip(), req.location.strip(), req.campus.strip())
    summary = await _reingest()
    return {"success": True, "entry": entry, "ingest": summary}


@router.delete("/info/{info_id}")
async def delete_info(info_id: str):
    if not db.delete_info(info_id):
        raise HTTPException(status_code=404, detail="Info entry not found")
    summary = await _reingest()
    return {"success": True, "ingest": summary}


# ------- Offices (who/where routing) -----------------------------------------

class OfficeEntry(BaseModel):
    name: str
    purpose: str = ""
    location: str = ""
    hours: str = ""
    phone: str = ""
    email: str = ""
    campus: str = ""


@router.get("/offices")
async def list_offices():
    return {"offices": db.list_offices()}


@router.post("/offices")
async def add_office(req: OfficeEntry):
    if not req.name.strip():
        raise HTTPException(status_code=400, detail="Office name is required")
    entry = db.add_office(req.name.strip(), req.purpose.strip(), req.location.strip(),
                          req.hours.strip(), req.phone.strip(), req.email.strip(), req.campus.strip())
    summary = await _reingest()
    return {"success": True, "entry": entry, "ingest": summary}


@router.delete("/offices/{office_id}")
async def delete_office(office_id: str):
    if not db.delete_office(office_id):
        raise HTTPException(status_code=404, detail="Office not found")
    summary = await _reingest()
    return {"success": True, "ingest": summary}


# ------- Knowledge documents (upload ANY file/note as a learning source) ------

def _doc_raw_path(doc_id: str) -> str:
    return os.path.join(RAW_DIR, f"_doc_{doc_id}.txt")


@router.get("/knowledge")
async def list_knowledge():
    return {"docs": db.list_knowledge_docs()}


@router.post("/knowledge/note")
async def add_knowledge_note(
    title: str = Form(...),
    description: str = Form(""),
    tags: str = Form(""),
    content: str = Form(...),
):
    """Add a typed note/announcement directly as a knowledge source."""
    if not title.strip() or not content.strip():
        raise HTTPException(status_code=400, detail="Title and content are required")
    doc_id = uuid.uuid4().hex[:12]
    tag_list = [t.strip() for t in tags.split(",") if t.strip()]
    _save_doc(doc_id, title.strip(), description.strip(), tag_list, "note", "", content.strip())
    entry = db.add_knowledge_doc({
        "id": doc_id, "title": title.strip(), "description": description.strip(),
        "tags": tag_list, "source_kind": "note", "filename": "",
        "added_at": datetime.utcnow().isoformat(), "chars": len(content.strip()),
    })
    summary = await _reingest()
    return {"success": True, "entry": entry, "ingest": summary}


@router.post("/knowledge")
async def add_knowledge_file(
    file: UploadFile = File(...),
    title: str = Form(...),
    description: str = Form(""),
    tags: str = Form(""),
):
    """Upload a document/image; AURA extracts its text and learns it. Requires tag + description."""
    from services import docextract
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in docextract.SUPPORTED_EXT:
        raise HTTPException(status_code=400, detail=f"Unsupported type {ext or '?'}. Allowed: PDF, Word, text, images.")
    if not title.strip():
        raise HTTPException(status_code=400, detail="A title is required")

    data = await file.read()
    try:
        text = await asyncio.to_thread(docextract.extract, file.filename, data)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Could not read the file: {str(e)[:120]}")
    if not text or len(text.strip()) < 5:
        raise HTTPException(status_code=422, detail="No readable text could be extracted from this file.")

    doc_id = uuid.uuid4().hex[:12]
    tag_list = [t.strip() for t in tags.split(",") if t.strip()]
    _save_doc(doc_id, title.strip(), description.strip(), tag_list, ext.lstrip("."), file.filename, text.strip())
    entry = db.add_knowledge_doc({
        "id": doc_id, "title": title.strip(), "description": description.strip(),
        "tags": tag_list, "source_kind": ext.lstrip("."), "filename": file.filename,
        "added_at": datetime.utcnow().isoformat(), "chars": len(text.strip()),
    })
    summary = await _reingest()
    return {"success": True, "entry": entry, "ingest": summary}


@router.delete("/knowledge/{doc_id}")
async def delete_knowledge(doc_id: str):
    found = db.delete_knowledge_doc(doc_id)
    if not found:
        raise HTTPException(status_code=404, detail="Document not found")
    p = _doc_raw_path(doc_id)
    if os.path.exists(p):
        try:
            os.remove(p)
        except OSError:
            pass
    summary = await _reingest()
    return {"success": True, "ingest": summary}


def _save_doc(doc_id, title, description, tags, kind, filename, text):
    """Write the extracted text into the knowledge raw folder with a searchable header."""
    os.makedirs(RAW_DIR, exist_ok=True)
    header = (f"SOURCE: Admin upload — {title}\n"
              f"TITLE: {title}\n"
              f"DESCRIPTION: {description}\n"
              f"TAGS: {', '.join(tags)}\n"
              f"TYPE: {kind}{(' (' + filename + ')') if filename else ''}\n\n")
    with open(_doc_raw_path(doc_id), "w", encoding="utf-8") as f:
        f.write(header + text)
