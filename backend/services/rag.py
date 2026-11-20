"""RAG layer — OpenAI gpt-4o-mini over retrieved context from the brain.

Returns a structured payload:
    {
      "reply":      str,
      "expression": "neutral|happy|thinking|sad",
      "display": {
        "type": "idle|text|faculty|faculty_list|location|programs|faq|media|appointment_sent",
        "data": {...}
      },
      "action": null | { "type": "request_appointment", "faculty_id", "faculty_name", "topic" },
      "media_ids": [str]          # ids of media the model chose to show (resolved by chat.py)
    }
"""
import asyncio
import json
import os
import re

from openai import OpenAI

import db
from services import brain

CHAT_MODEL = os.getenv("OPENAI_CHAT_MODEL", "gpt-4o")

# Which campus this kiosk physically stands at. AURA scopes to it and never asks.
# Admin-settable (data/settings.json) with the .env value as the fallback default.
_ENV_HOME_CAMPUS = os.getenv("HOME_CAMPUS", "Achrafieh (Beirut)").strip()

def get_home_campus() -> str:
    try:
        return db.get_home_campus(_ENV_HOME_CAMPUS)
    except Exception:
        return _ENV_HOME_CAMPUS

VALID_DISPLAYS = {"idle", "text", "faculty", "faculty_list", "location", "programs", "faq", "media", "appointment_sent"}
VALID_EXPRESSIONS = {"neutral", "happy", "thinking", "sad"}

_client = None


def _get_client() -> OpenAI:
    global _client
    if _client is None:
        _client = OpenAI()  # reads OPENAI_API_KEY
    return _client


SYSTEM_PROMPT = """You are AURA, the reception assistant for the FACULTY OF ENGINEERING AND COMPUTER SCIENCE at AUST Lebanon.
You greet visitors, answer questions using the provided context, and help students request meetings with instructors.

SCOPE — you serve the Faculty of Engineering and Computer Science:
- You assist with everything in this faculty: Engineering programs (Computer & Communications Engineering,
  Mechatronics, Biomedical) AND Computer Science, Information & Communications Technology (ICT), and the
  Mathematics that supports them — their programs, curricula, instructors, labs, offices, and campuses.
- If a visitor asks about a DIFFERENT faculty (Business & Economics, Arts & Sciences other than CS,
  Health Sciences) or something clearly outside this faculty, briefly say "I'm the assistant for the
  Faculty of Engineering and Computer Science," then answer the relevant part or point them to the right
  office. Computer Science IS within your scope — never turn away CS questions.
- When a question about "the university" or "campuses" could apply broadly, answer it specifically for the
  Faculty of Engineering and Computer Science, and make that scope clear.

Speak warmly and concisely — your reply is read aloud, so keep it to 1–2 sentences.
ALWAYS respond in English only, regardless of the language the visitor uses. Never use Arabic or any
other language in your reply.

Respond with a SINGLE JSON object (no markdown) of this exact shape:
{
  "reply": "<spoken text>",
  "expression": "neutral | happy | thinking | sad",
  "display": { "type": "<idle|text|faculty|faculty_list|location|programs|faq|media|appointment_sent>", "data": {} },
  "action": null,
  "media_ids": []
}

Grounding:
- Answer ONLY from the RETRIEVED CONTEXT and FACULTY list below. If the answer isn't there, say you're
  not sure and suggest the Dean's office. Do not invent facts, room numbers, or names.

Campuses (CRITICAL — this kiosk has a FIXED location):
- AUST has four campuses: Achrafieh (Beirut, main), Zahle (Bekaa), Sidon (South), Bhamdoun (Mount
  Lebanon). THIS kiosk physically stands at the campus given as "THIS KIOSK IS AT" in the context.
- ASSUME the visitor is at THIS kiosk's campus. Do NOT ask "which campus are you at?" — you already
  know. Scope instructor, office, and appointment answers to this campus automatically and immediately.
- Each instructor in FACULTY has a "campus" field. When the visitor asks for an instructor, prefer the
  one at THIS campus. Only discuss another campus when the visitor explicitly asks about it
  (e.g. "is Dr. Gaby at Zahle?") or when the requested instructor exists ONLY at another campus — in
  that case say which campus they are at.
- When naming an instructor at THIS campus, you don't need to repeat the campus every time; mention a
  campus only when it differs from this one.
- GENERAL RULE FOR ANY HARD-TO-PRONOUNCE CHOICE: if you must ask the visitor to choose between specific
  instructor/program names, present them as a short NUMBERED list ("Say one for…, two for…", max 4) so
  they can answer with a number. (This is for disambiguating names — NOT for asking the campus.)
- General questions (admissions, tuition, programs, hours, offices, events) are answered directly.
- Offices & routing ("who do I ask about X", "where do I pay tuition"): PREFER entries from RETRIEVED
  CONTEXT that begin with "OFFICE:" (these are the official, up-to-date office directory). Give the
  office name, location, and hours. Use the "location" display type when you have a place to show.
- Events/deadlines/hours: use UPCOMING and any "[DEADLINE]/[EVENT]" retrieved items; state the date.
- Courses & prerequisites: the COURSE CATALOG lines in context give each course as
  "CODE — Name (X cr). Prerequisites: ... . description". When asked about a course, ALWAYS give the
  course CODE and full NAME together (e.g. "CCE 320, Computer Organization & Microprocessors"). When
  asked for prerequisites, list every prerequisite course with BOTH its code and name. When asked
  "what should I take before/after X" or to describe a course, use this catalog. Course descriptions
  are general guidance (not the official syllabus) — answer naturally without disclaiming each time,
  but don't invent specific syllabus/grading details. If a course isn't in the catalog, say you're not
  sure and suggest the Dean's office.

Display rules — choose the type that best fits:
- "faculty": one instructor. data = { id, name, dept, office, title, status, campus } from FACULTY.
- "faculty_list": several instructors. data = { items: [ {id,name,dept,office,status,campus} ] }
- "location": a place. data = { place, building, room, directions }
- "programs": majors/degrees. data = { items: [ {name, code, description} ] }
- "faq": a Q&A answer. data = { question, answer }
- "media": when CANDIDATE MEDIA contains images relevant to the question (labs, projects, campus...).
  Put the chosen image ids in top-level "media_ids", and set data = { title, body } (a short caption line).
- "text": general fallback. data = { title, body }
- "idle": goodbye / nothing meaningful.

Appointments:
- Use CONVERSATION HISTORY to resolve "him/her/them/that professor".
- If the user wants to MEET / BOOK / SEE / TALK TO / SCHEDULE with an instructor, set:
    action = { "type":"request_appointment", "faculty_id":"<id from FACULTY>",
               "faculty_name":"<full name from FACULTY>", "topic":"<inferred topic>",
               "requested_time":"<ISO 8601 local datetime e.g. 2026-06-10T14:00, or null>" }
  Always include faculty_id and faculty_name. If the topic is unclear, use "General meeting" — do NOT
  refuse. Only ask for clarification if you cannot tell which instructor is meant.
- requested_time: resolve any day/time the visitor states ("Wednesday at 2", "tomorrow morning",
  "the 10th at 3pm") to an ISO datetime using CURRENT DATE/TIME above. If they gave no specific time,
  set requested_time to null — the system will offer open slots. NEVER invent office hours; just pass
  the time through. The system checks the instructor's real availability and will tell you/them if it
  doesn't fit.
- When booking, set expression to "happy".

Only include media_ids that appear in CANDIDATE MEDIA. Leave it [] otherwise.
"""


def _build_context_block(query: str) -> tuple[str, list[dict]]:
    """Assemble retrieved knowledge + faculty + candidate media into a prompt block."""
    faculty = db.list_faculty()  # full list (small, needed for appointments)

    knowledge_hits = []
    media_hits = []
    if brain.is_ready():
        qvec = brain.embed_query(query)  # embed once, reuse for both searches
        knowledge_hits = brain.search_vec(qvec, k=7, kinds=["knowledge"], min_score=0.15)
        media_hits = brain.search_vec(qvec, k=3, kinds=["media"], min_score=0.20)

    knowledge_text = "\n\n".join(
        f"[source: {h['source']}]\n{h['text']}" for h in knowledge_hits
    ) or "(no scraped knowledge matched this query)"

    candidate_media = [
        {"id": h["id"], "caption": h["meta"].get("caption", h["text"]), "tags": h["meta"].get("tags", [])}
        for h in media_hits
    ]

    from datetime import datetime, date, timedelta
    now = datetime.now()
    home_campus = get_home_campus()

    # Upcoming info-board items for this campus (or all-campus) within the next ~14 days, so AURA can
    # answer "what's going on?" / nearest deadline proactively without relying on retrieval.
    upcoming = []
    try:
        today = date.today()
        horizon = today + timedelta(days=14)
        for it in db.list_info():
            c = (it.get("campus") or "").strip()
            if c and c != home_campus:
                continue
            ds = (it.get("date") or "").strip()
            keep = True
            if ds:
                try:
                    d = date.fromisoformat(ds)
                    keep = today <= d <= horizon
                except ValueError:
                    keep = True
            if keep:
                upcoming.append(it)
        upcoming.sort(key=lambda x: x.get("date") or "9999")
        upcoming = upcoming[:8]
    except Exception:
        upcoming = []
    upcoming_text = "\n".join(
        f"- [{u.get('kind','notice')}] {u.get('title','')}"
        f"{(' on ' + u['date']) if u.get('date') else ''}"
        f"{(' (' + u['location'] + ')') if u.get('location') else ''}: {u.get('detail','')}"
        for u in upcoming
    ) or "(nothing scheduled in the next two weeks)"

    block = (
        f"CURRENT DATE/TIME (local): {now.strftime('%A %Y-%m-%d %H:%M')}\n"
        f"THIS KIOSK IS AT: {home_campus} campus. Assume the visitor is here; do not ask which campus.\n\n"
        f"FACULTY:\n{json.dumps(faculty, ensure_ascii=False)}\n\n"
        f"UPCOMING (this campus, next 2 weeks):\n{upcoming_text}\n\n"
        f"RETRIEVED CONTEXT:\n{knowledge_text}\n\n"
        f"CANDIDATE MEDIA (only these ids may be used in media_ids):\n"
        f"{json.dumps(candidate_media, ensure_ascii=False)}"
    )
    return block, media_hits


def _fallback(text: str, expression: str = "sad") -> dict:
    return {
        "reply": text,
        "expression": expression,
        "display": {"type": "text", "data": {"title": "AURA", "body": text}},
        "action": None,
        "media_ids": [],
    }


_NON_LATIN_RE = re.compile(r"[^\x00-\x7F]")


def _english_only(text: str) -> str:
    """Hard guarantee: strip any non-Latin (e.g. Arabic) characters from a string."""
    if not isinstance(text, str):
        return text
    return re.sub(r"\s+", " ", _NON_LATIN_RE.sub("", text)).strip()


def _coerce(obj: dict, reply_default: str) -> dict:
    reply = _english_only(obj.get("reply") or "") or reply_default
    expression = obj.get("expression", "neutral")
    if expression not in VALID_EXPRESSIONS:
        expression = "neutral"
    display = obj.get("display") or {"type": "text", "data": {"title": "AURA", "body": reply}}
    if display.get("type") not in VALID_DISPLAYS:
        display = {"type": "text", "data": {"title": "AURA", "body": reply}}
    action = obj.get("action")
    if action and (not isinstance(action, dict) or action.get("type") != "request_appointment"):
        action = None
    media_ids = obj.get("media_ids") or []
    if not isinstance(media_ids, list):
        media_ids = []
    return {"reply": reply, "expression": expression, "display": display, "action": action, "media_ids": media_ids}


async def answer(user_query: str, history: list = None) -> dict:
    history = history or []
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key or api_key == "YOUR_OPENAI_API_KEY_HERE":
        return _fallback("I'm in demo mode — no OpenAI API key is configured yet.", "neutral")

    # Cheap greeting shortcut
    q = user_query.lower().strip()
    if q in {"hi", "hello", "hey", "hey aura", "hi aura", "hello aura"} or len(q) < 3:
        return {
            "reply": "Hi there! I'm AURA, the assistant for the Faculty of Engineering and Computer Science. How can I help you?",
            "expression": "happy",
            "display": {"type": "text", "data": {"title": "Welcome", "body": "Faculty of Engineering & Computer Science · AUST"}},
            "action": None,
            "media_ids": [],
        }

    # Flatten history to plain dicts before going off the event loop
    hist = [{"role": "user" if m.role == "user" else "assistant", "content": m.content} for m in history]
    # Run the blocking embedding + chat-completion work in a thread so the FastAPI
    # event loop stays free to answer the face/belly polls while AURA "thinks".
    return await asyncio.to_thread(_answer_sync, user_query, hist)


def _salvage_json(content: str):
    """Best-effort recovery of a JSON object from a truncated/dirty model response.

    Truncation (hitting the token cap mid-object) is the usual cause of the old 'trouble forming a
    response' error. We extract the largest brace-balanced prefix; if that fails, we at least pull the
    "reply" string so AURA can still speak something sensible.
    """
    if not content:
        return None
    s = content.strip()
    if s.startswith("```"):
        s = re.sub(r"^```(json)?|```$", "", s, flags=re.MULTILINE).strip()
    # try progressively shorter prefixes that close cleanly
    start = s.find("{")
    if start == -1:
        return None
    depth, in_str, esc = 0, False, False
    for i in range(start, len(s)):
        c = s[i]
        if in_str:
            if esc: esc = False
            elif c == "\\": esc = True
            elif c == '"': in_str = False
        else:
            if c == '"': in_str = True
            elif c == "{": depth += 1
            elif c == "}":
                depth -= 1
                if depth == 0:
                    try:
                        return json.loads(s[start:i + 1])
                    except json.JSONDecodeError:
                        break
    return None


def _loose_reply(content: str) -> str:
    """Pull the value of a "reply" field out of malformed/truncated JSON text, if present."""
    if not content:
        return ""
    m = re.search(r'"reply"\s*:\s*"((?:[^"\\]|\\.)*)', content)
    if m:
        return m.group(1).replace('\\"', '"').replace("\\n", " ").strip()
    return ""


def _answer_sync(user_query: str, hist: list[dict]) -> dict:
    context_block, _media_hits = _build_context_block(user_query)

    messages = [{"role": "system", "content": SYSTEM_PROMPT + "\n\n" + context_block}]
    messages.extend(hist)
    messages.append({"role": "user", "content": user_query})

    def _call():
        client = _get_client()
        resp = client.chat.completions.create(
            model=CHAT_MODEL,
            messages=messages,
            temperature=0.4,
            max_tokens=700,   # room for fuller answers (program overviews, course lists) without truncation
            response_format={"type": "json_object"},
        )
        return resp.choices[0].message.content

    try:
        content = _call()
        try:
            obj = json.loads(content)
        except json.JSONDecodeError:
            obj = _salvage_json(content)  # try to recover a truncated/dirty JSON object
            if obj is None:
                # one clean retry before giving up
                content = _call()
                try:
                    obj = json.loads(content)
                except json.JSONDecodeError:
                    obj = _salvage_json(content)
        if obj is None:
            # Last resort: speak the model's own text if we have any, else a friendly line — NEVER
            # the robotic "trouble forming a response".
            spoken = _english_only(_loose_reply(content)) or "Sorry, could you say that another way?"
            return _fallback(spoken, "neutral")
        return _coerce(obj, "Sorry, could you say that another way?")
    except Exception as e:
        err = str(e)
        print(f"[RAG] OpenAI error: {err}")
        if "rate limit" in err.lower() or "429" in err:
            return _fallback("I'm getting a lot of questions right now — please try again in a moment.")
        if "api key" in err.lower() or "401" in err:
            return _fallback("My OpenAI key looks invalid. Please check the backend configuration.", "neutral")
        return _fallback("Sorry, could you ask me that again?")
