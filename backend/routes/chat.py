"""Chat endpoint — drives the face (audio + visemes) and the belly (smart card).

Flow:
  Display (PC) sends transcript        → POST /api/chat/ask
  Backend: RAG → TTS → updates signals
  Face screen polls  GET /api/chat/signal   → audio + visemes
  Belly screen polls GET /api/chat/display  → smart card

Appointment loop:
  ask() books the request and returns its id.
  Display watches GET /api/chat/appointment/{id}.
  When faculty accepts/declines, Display calls POST /api/chat/announce so AURA
  speaks the outcome live at the kiosk.
"""
import asyncio
import os
import uuid

from fastapi import APIRouter, UploadFile, File
from pydantic import BaseModel

import db
from services import rag, tts, stt, scheduling, push

router = APIRouter()

AUDIO_DIR = os.path.join(os.path.dirname(__file__), "..", "static", "audio")
os.makedirs(AUDIO_DIR, exist_ok=True)

async def _broadcast(reply: str, expression: str, display: dict) -> dict:
    """Synthesize the voice + lip-sync and return everything inline.

    The display window is the only client that calls the backend (over on-device loopback). It
    renders the text/card itself and forwards the audio to the offline face window via the
    browser's BroadcastChannel — so the face makes no network calls of its own.
    """
    signal_id = str(uuid.uuid4())
    audio_url = None
    visemes: list = []
    try:
        audio_filename = f"{uuid.uuid4()}.mp3"
        audio_path = os.path.join(AUDIO_DIR, audio_filename)
        visemes = await tts.synthesize(reply, audio_path)
        audio_url = f"/static/audio/{audio_filename}"
    except Exception as e:
        print(f"[TTS] synthesis failed: {e}")
    return {
        "id": signal_id,
        "reply": reply,
        "expression": expression,
        "display": display,
        "audio_url": audio_url,
        "visemes": visemes,
    }


def _resolve_faculty(faculty_id: str | None, faculty_name: str | None) -> dict | None:
    """Find a faculty member by id first, then by loose name match."""
    if faculty_id:
        f = db.get_faculty(str(faculty_id))
        if f:
            return f
    if faculty_name:
        needle = faculty_name.lower()
        for h in ("dr.", "dr", "prof.", "prof", "mr.", "mr", "ms.", "ms"):
            needle = needle.replace(h, "")
        needle = needle.strip()
        candidates = db.list_faculty(include_password=True)
        for f in candidates:
            if needle and needle in f["name"].lower():
                return f
        tokens = [t for t in needle.split() if len(t) > 1]
        for f in candidates:
            name_low = f["name"].lower()
            if any(tok in name_low for tok in tokens):
                return f
    return None


def _notify_faculty(faculty: dict, appt: dict, slot_label: str) -> None:
    """Best-effort web push to the instructor about a new pending request (never blocks)."""
    try:
        when = slot_label or appt.get("topic") or "a meeting"
        push.send_to_faculty(
            faculty["id"],
            title="New meeting request",
            body=f"{appt.get('student_name', 'A student')} · {when}",
            data={"appointment_id": appt["id"]},
        )
    except Exception as e:
        print(f"[push] notify failed: {e}")


def _appointment_sent_card(result: dict, faculty: dict, appt: dict, slot_label: str) -> None:
    """Set the reply + appointment_sent card for a pending request (manual accept/decline)."""
    _notify_faculty(faculty, appt, slot_label)
    when = f" for {slot_label}" if slot_label else ""
    result["reply"] = (
        f"Done — I've sent your request to {faculty['name']}{when}. "
        f"Please wait a moment, I'll show you their answer right here."
    )
    result["expression"] = "happy"
    result["display"] = {
        "type": "appointment_sent",
        "data": {
            "appointment_id": appt["id"],
            "faculty_name": faculty["name"],
            "faculty_office": faculty["office"],
            "faculty_dept": faculty["dept"],
            "faculty_campus": faculty.get("campus", ""),
            "topic": appt["topic"],
            "slot_label": slot_label,
        },
    }


class Msg(BaseModel):
    role: str
    content: str


class AskRequest(BaseModel):
    message: str
    history: list[Msg] = []
    student_name: str | None = None


class AnnounceRequest(BaseModel):
    reply: str
    expression: str = "neutral"
    display_type: str = "text"
    display_data: dict = {}


@router.post("/ask")
async def ask(req: AskRequest):
    """Process a transcript: think → speak → display."""
    try:
        result = await rag.answer(req.message, req.history)
    except Exception as e:
        import traceback
        traceback.print_exc()
        result = {
            "reply": f"I encountered an error: {e}",
            "expression": "sad",
            "display": {"type": "text", "data": {"title": "Error", "body": str(e)}},
            "action": None,
        }

    appointment_id = None

    # Resolve any media the model chose into displayable URLs
    media_ids = result.get("media_ids") or []
    if media_ids and result.get("display", {}).get("type") == "media":
        items = []
        for mid in media_ids:
            m = db.get_media(mid)
            if m:
                items.append({"url": f"/media/{m['file']}", "caption": m.get("caption", "")})
        data = result["display"].get("data") or {}
        data["items"] = items
        result["display"]["data"] = data

    if result.get("action") and result["action"].get("type") == "request_appointment":
        action = result["action"]
        faculty = _resolve_faculty(action.get("faculty_id"), action.get("faculty_name"))
        if not faculty:
            names = ", ".join(f["name"] for f in db.list_faculty())
            result["reply"] = f"I couldn't tell which instructor you meant. I can reach: {names}. Who would you like to meet?"
            result["expression"] = "thinking"
            result["display"] = {"type": "text", "data": {"title": "Which instructor?", "body": names}}
        else:
            topic = action.get("topic") or "Meeting request"
            student = req.student_name or "A student"
            v = scheduling.validate_request(faculty, action.get("requested_time"))

            if not v["ok"] and v["reason"] == "no_hours_set":
                # Instructor hasn't configured office hours → keep the old time-less request flow.
                appt = db.create_appointment(faculty_id=faculty["id"], topic=topic, student_name=student)
                appointment_id = appt["id"]
                _appointment_sent_card(result, faculty, appt, "")

            elif v["ok"]:
                auto = v.get("auto_accept")
                try:
                    appt = db.create_appointment(
                        faculty_id=faculty["id"], topic=topic, student_name=student,
                        requested_start=v["start"], requested_end=v["end"], slot_label=v["label"],
                        status="accepted" if auto else "pending",
                    )
                except db.SlotTaken:
                    result["reply"] = f"That time was just taken. Could you pick another slot with {faculty['name']}?"
                    result["expression"] = "thinking"
                    result["display"] = {"type": "text", "data": {"title": "Slot taken", "body": v["label"]}}
                    appt = None

                if appt and auto:
                    print(f"[CHAT] Auto-accepted #{appt['id'][:8]} -> {faculty['name']} @ {v['label']}")
                    result["reply"] = f"Booked! You're confirmed with {faculty['name']} on {v['label']}. Please go to {faculty.get('campus','')} {faculty['office']}."
                    result["expression"] = "happy"
                    result["display"] = {"type": "appointment_result", "data": {
                        "status": "accepted", "faculty_name": faculty["name"],
                        "faculty_office": faculty["office"], "faculty_campus": faculty.get("campus", ""),
                        "topic": topic, "slot_label": v["label"]}}
                elif appt:
                    appointment_id = appt["id"]
                    print(f"[CHAT] Appointment #{appt['id'][:8]} -> {faculty['name']} @ {v['label']}")
                    _appointment_sent_card(result, faculty, appt, v["label"])

            else:
                # need_time / outside_hours / taken / unparseable → propose real open slots, don't book.
                sugg = v.get("suggestions") or []
                if sugg:
                    opts = "; ".join(f"{i+1}) {s['label']}" for i, s in enumerate(sugg))
                    result["reply"] = (
                        f"{faculty['name']} isn't available then. The next openings are: {opts}. "
                        f"Which one works — say one, two, or three?"
                    )
                    result["display"] = {"type": "text", "data": {"title": f"Open times — {faculty['name']}",
                                                                   "body": "  •  ".join(s['label'] for s in sugg)}}
                else:
                    result["reply"] = f"{faculty['name']} has no open office hours in the next two weeks. Please try the Dean's office."
                    result["display"] = {"type": "text", "data": {"title": "No openings", "body": faculty["name"]}}
                result["expression"] = "thinking"

    out = await _broadcast(result["reply"], result["expression"], result["display"])
    out["appointment_id"] = appointment_id
    return out


@router.post("/transcribe")
async def transcribe(audio: UploadFile = File(...)):
    """Transcribe an uploaded audio blob. Returns {text, dropped}.
    dropped=True means speech was heard but wasn't understandable English (ask to repeat)."""
    data = await audio.read()
    suffix = os.path.splitext(audio.filename or "")[1] or ".webm"
    text, dropped = await asyncio.to_thread(stt.transcribe, data, suffix)
    return {"text": text, "dropped": dropped}


@router.post("/announce")
async def announce(req: AnnounceRequest):
    """Make AURA speak an arbitrary message + show a card (used for appointment outcomes)."""
    return await _broadcast(req.reply, req.expression, {"type": req.display_type, "data": req.display_data})


@router.get("/appointment/{appointment_id}")
async def get_appointment(appointment_id: str):
    """Return one appointment's current status, enriched with faculty details."""
    appt = db.get_appointment(appointment_id)
    if not appt:
        return {"found": False}
    faculty = db.get_faculty(appt["faculty_id"])
    enriched = dict(appt)
    if faculty:
        enriched["faculty_name"] = faculty["name"]
        enriched["faculty_office"] = faculty["office"]
        enriched["faculty_dept"] = faculty["dept"]
        enriched["faculty_campus"] = faculty.get("campus", "")
    return {"found": True, "appointment": enriched}


