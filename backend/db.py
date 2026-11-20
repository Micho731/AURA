"""Tiny JSON-file database. No ORM, no SQL — just atomic read/write to files in data/."""
import json
import os
import threading
import uuid
from datetime import datetime
from typing import Any

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data")
os.makedirs(DATA_DIR, exist_ok=True)

_lock = threading.Lock()

FACULTY_PATH = os.path.join(DATA_DIR, "faculty.json")
FAQ_PATH = os.path.join(DATA_DIR, "faq.json")
KNOWLEDGE_PATH = os.path.join(DATA_DIR, "knowledge.json")
APPOINTMENTS_PATH = os.path.join(DATA_DIR, "appointments.json")
MEDIA_DIR = os.path.join(DATA_DIR, "media")
MEDIA_MANIFEST_PATH = os.path.join(MEDIA_DIR, "manifest.json")
PUSH_PATH = os.path.join(DATA_DIR, "push_subscriptions.json")
SETTINGS_PATH = os.path.join(DATA_DIR, "settings.json")
KNOWLEDGE_DOCS_PATH = os.path.join(DATA_DIR, "knowledge_docs.json")
INFO_PATH = os.path.join(DATA_DIR, "info_board.json")
OFFICES_PATH = os.path.join(DATA_DIR, "offices.json")


def _read(path: str, default: Any) -> Any:
    if not os.path.exists(path):
        return default
    with _lock:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)


def _write(path: str, data: Any) -> None:
    with _lock:
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        os.replace(tmp, path)


# ------- Faculty --------------------------------------------------------------

def list_faculty(include_password: bool = False) -> list[dict]:
    rows = _read(FACULTY_PATH, {"faculty": []}).get("faculty", [])
    if include_password:
        return rows
    return [{k: v for k, v in r.items() if k != "password"} for r in rows]


def get_faculty(faculty_id: str) -> dict | None:
    for f in list_faculty(include_password=True):
        if f["id"] == faculty_id:
            return f
    return None


def find_faculty_by_username(username: str) -> dict | None:
    for f in list_faculty(include_password=True):
        if f["username"].lower() == username.lower():
            return f
    return None


def search_faculty(query: str) -> list[dict]:
    """Loose search across name/dept/office for the RAG layer to use."""
    q = query.lower()
    return [
        f for f in list_faculty()
        if q in f["name"].lower() or q in f["dept"].lower() or q in f["office"].lower()
    ]


def add_faculty(name: str, dept: str, office: str, title: str = "") -> dict:
    rows = list_faculty(include_password=True)
    next_id = str(max([int(r["id"]) for r in rows], default=0) + 1)
    username, password = _generate_credentials(name, [r["username"] for r in rows])
    record = {
        "id": next_id,
        "name": name,
        "dept": dept,
        "office": office,
        "title": title,
        "status": "Away",
        "username": username,
        "password": password,
    }
    rows.append(record)
    _write(FACULTY_PATH, {"faculty": rows})
    return record


def update_faculty_status(faculty_id: str, status: str) -> bool:
    rows = list_faculty(include_password=True)
    found = False
    for r in rows:
        if r["id"] == faculty_id:
            r["status"] = status
            found = True
            break
    if found:
        _write(FACULTY_PATH, {"faculty": rows})
    return found


def delete_faculty(faculty_id: str) -> None:
    rows = list_faculty(include_password=True)
    rows = [r for r in rows if r["id"] != faculty_id]
    _write(FACULTY_PATH, {"faculty": rows})


def _generate_credentials(name: str, taken: list[str]) -> tuple[str, str]:
    parts = name.strip().lower().split()
    parts = [p for p in parts if p not in ("dr.", "dr", "prof.", "prof", "mr.", "mr", "ms.", "ms")]
    if not parts:
        parts = ["faculty"]
    base = (parts[0][0] + parts[-1]) if len(parts) >= 2 else parts[0]
    username = base
    n = 1
    while username in taken:
        username = f"{base}{n}"
        n += 1
    pwd = (f"{parts[0]}.{parts[-1]}24" if len(parts) >= 2 else f"{parts[0]}24")
    return username, pwd


# ------- Appointments --------------------------------------------------------

def list_appointments(faculty_id: str | None = None, status: str | None = None) -> list[dict]:
    rows = _read(APPOINTMENTS_PATH, {"appointments": []}).get("appointments", [])
    if faculty_id:
        rows = [r for r in rows if r["faculty_id"] == faculty_id]
    if status:
        rows = [r for r in rows if r["status"] == status]
    return sorted(rows, key=lambda r: r["created_at"], reverse=True)


def get_appointment(appointment_id: str) -> dict | None:
    rows = _read(APPOINTMENTS_PATH, {"appointments": []}).get("appointments", [])
    for r in rows:
        if r["id"] == appointment_id:
            return r
    return None


class SlotTaken(Exception):
    """Raised when the requested slot was booked by someone else between validate and write."""


def create_appointment(faculty_id: str, topic: str, student_name: str = "Anonymous student",
                       requested_start: str | None = None, requested_end: str | None = None,
                       slot_label: str = "", status: str = "pending") -> dict:
    """Create an appointment. If requested_start is given, re-check inside the lock that the slot is
    still free (status pending/accepted) to avoid a double-book race; raises SlotTaken if not."""
    with _lock:
        store = json.load(open(APPOINTMENTS_PATH, encoding="utf-8")) if os.path.exists(APPOINTMENTS_PATH) else {"appointments": []}
        rows = store.get("appointments", [])
        if requested_start:
            for r in rows:
                if (r["faculty_id"] == faculty_id and r.get("requested_start") == requested_start
                        and r.get("status") in ("pending", "accepted")):
                    raise SlotTaken(requested_start)
        record = {
            "id": str(uuid.uuid4()),
            "faculty_id": faculty_id,
            "student_name": student_name,
            "topic": topic,
            "status": status,
            "created_at": datetime.utcnow().isoformat(),
            "responded_at": datetime.utcnow().isoformat() if status != "pending" else None,
            "requested_start": requested_start,
            "requested_end": requested_end,
            "slot_label": slot_label,
        }
        rows.append(record)
        tmp = APPOINTMENTS_PATH + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump({"appointments": rows}, f, indent=2, ensure_ascii=False)
        os.replace(tmp, APPOINTMENTS_PATH)
    return record


def respond_appointment(appointment_id: str, accept: bool, message: str = "") -> dict | None:
    rows = _read(APPOINTMENTS_PATH, {"appointments": []}).get("appointments", [])
    for r in rows:
        if r["id"] == appointment_id:
            r["status"] = "accepted" if accept else "declined"
            r["responded_at"] = datetime.utcnow().isoformat()
            r["message"] = message
            _write(APPOINTMENTS_PATH, {"appointments": rows})
            return r
    return None


# ------- Office hours / schedule ---------------------------------------------

_EMPTY_WEEK = {"mon": [], "tue": [], "wed": [], "thu": [], "fri": [], "sat": [], "sun": []}


def get_schedule(faculty_id: str) -> dict | None:
    """Return {office_hours, slot_minutes, auto_accept, overrides} with safe defaults, or None."""
    f = get_faculty(faculty_id)
    if not f:
        return None
    return {
        "office_hours": f.get("office_hours") or dict(_EMPTY_WEEK),
        "slot_minutes": int(f.get("slot_minutes") or 30),
        "auto_accept": bool(f.get("auto_accept", False)),
        "overrides": f.get("overrides") or [],
    }


def _update_faculty_fields(faculty_id: str, fields: dict) -> bool:
    rows = list_faculty(include_password=True)
    found = False
    for r in rows:
        if r["id"] == faculty_id:
            r.update(fields)
            found = True
            break
    if found:
        _write(FACULTY_PATH, {"faculty": rows})
    return found


def set_office_hours(faculty_id: str, office_hours: dict, slot_minutes: int = 30) -> bool:
    hours = dict(_EMPTY_WEEK)
    for day in _EMPTY_WEEK:
        hours[day] = office_hours.get(day, []) if isinstance(office_hours, dict) else []
    return _update_faculty_fields(faculty_id, {"office_hours": hours, "slot_minutes": int(slot_minutes or 30)})


def set_overrides(faculty_id: str, overrides: list[dict]) -> bool:
    return _update_faculty_fields(faculty_id, {"overrides": overrides or []})


def set_auto_accept(faculty_id: str, auto_accept: bool) -> bool:
    return _update_faculty_fields(faculty_id, {"auto_accept": bool(auto_accept)})


# ------- Settings (kiosk config: home campus, etc.) --------------------------

VALID_CAMPUSES = ["Achrafieh (Beirut)", "Zahle (Bekaa)", "Sidon (South)", "Bhamdoun (Mount Lebanon)"]


def get_settings() -> dict:
    return _read(SETTINGS_PATH, {})


def get_home_campus(default: str = "Achrafieh (Beirut)") -> str:
    return get_settings().get("home_campus") or default


def set_home_campus(campus: str) -> bool:
    if campus not in VALID_CAMPUSES:
        return False
    s = get_settings()
    s["home_campus"] = campus
    _write(SETTINGS_PATH, s)
    return True


# ------- Knowledge -----------------------------------------------------------

def get_faqs() -> list[dict]:
    return _read(FAQ_PATH, {"faqs": []}).get("faqs", [])


def get_knowledge() -> dict:
    return _read(KNOWLEDGE_PATH, {})


# ------- Media (image manifest) ----------------------------------------------

def list_media() -> list[dict]:
    """Each entry: {file, caption, tags, category}. id == file."""
    data = _read(MEDIA_MANIFEST_PATH, [])
    # Support either a bare list or {"media": [...]}
    if isinstance(data, dict):
        return data.get("media", [])
    return data


def get_media(media_id: str) -> dict | None:
    for m in list_media():
        if m.get("file") == media_id:
            return m
    return None


def _write_media(rows: list[dict]) -> None:
    _write(MEDIA_MANIFEST_PATH, rows)


def add_media(file: str, caption: str, tags: list[str], category: str = "") -> dict:
    """Add (or replace by filename) a manifest entry. Returns the entry."""
    rows = list_media()
    rows = [m for m in rows if m.get("file") != file]   # replace if same filename
    entry = {"file": file, "category": category, "caption": caption, "tags": tags}
    rows.append(entry)
    _write_media(rows)
    return entry


def delete_media(file: str) -> bool:
    rows = list_media()
    new_rows = [m for m in rows if m.get("file") != file]
    if len(new_rows) == len(rows):
        return False
    _write_media(new_rows)
    return True


# ------- Info board (calendar / deadlines / events / hours / notices) --------

def list_info() -> list[dict]:
    """Each entry: {id, kind, title, detail, date?, end_date?, location?, campus?}."""
    return _read(INFO_PATH, {"info": []}).get("info", [])


def add_info(kind: str, title: str, detail: str = "", date: str = "",
             end_date: str = "", location: str = "", campus: str = "") -> dict:
    rows = list_info()
    entry = {
        "id": str(uuid.uuid4()),
        "kind": kind, "title": title, "detail": detail,
        "date": date, "end_date": end_date, "location": location, "campus": campus,
    }
    rows.append(entry)
    _write(INFO_PATH, {"info": rows})
    return entry


def delete_info(info_id: str) -> bool:
    rows = list_info()
    new_rows = [r for r in rows if r.get("id") != info_id]
    if len(new_rows) == len(rows):
        return False
    _write(INFO_PATH, {"info": new_rows})
    return True


# ------- Knowledge documents (admin-uploaded learning sources) ---------------

def list_knowledge_docs() -> list[dict]:
    """Each entry: {id, title, description, tags[], source_kind, filename?, added_at, chars}."""
    return _read(KNOWLEDGE_DOCS_PATH, {"docs": []}).get("docs", [])


def add_knowledge_doc(entry: dict) -> dict:
    rows = list_knowledge_docs()
    rows.append(entry)
    _write(KNOWLEDGE_DOCS_PATH, {"docs": rows})
    return entry


def delete_knowledge_doc(doc_id: str) -> dict | None:
    rows = list_knowledge_docs()
    found = next((r for r in rows if r.get("id") == doc_id), None)
    if not found:
        return None
    _write(KNOWLEDGE_DOCS_PATH, {"docs": [r for r in rows if r.get("id") != doc_id]})
    return found


# ------- Offices (who/where for financial aid, registrar, IT, ...) -----------

def list_offices() -> list[dict]:
    """Each entry: {id, name, purpose, location, hours?, phone?, email?, campus?}."""
    return _read(OFFICES_PATH, {"offices": []}).get("offices", [])


def add_office(name: str, purpose: str = "", location: str = "", hours: str = "",
               phone: str = "", email: str = "", campus: str = "") -> dict:
    rows = list_offices()
    entry = {
        "id": str(uuid.uuid4()),
        "name": name, "purpose": purpose, "location": location,
        "hours": hours, "phone": phone, "email": email, "campus": campus,
    }
    rows.append(entry)
    _write(OFFICES_PATH, {"offices": rows})
    return entry


def delete_office(office_id: str) -> bool:
    rows = list_offices()
    new_rows = [r for r in rows if r.get("id") != office_id]
    if len(new_rows) == len(rows):
        return False
    _write(OFFICES_PATH, {"offices": new_rows})
    return True


# ------- Push subscriptions (web push) ---------------------------------------

def list_push_subscriptions(faculty_id: str | None = None) -> list[dict]:
    rows = _read(PUSH_PATH, {"subs": []}).get("subs", [])
    if faculty_id:
        rows = [r for r in rows if r.get("faculty_id") == faculty_id]
    return rows


def save_push_subscription(faculty_id: str, subscription: dict) -> None:
    rows = _read(PUSH_PATH, {"subs": []}).get("subs", [])
    endpoint = subscription.get("endpoint")
    rows = [r for r in rows if r.get("subscription", {}).get("endpoint") != endpoint]  # de-dup
    rows.append({"faculty_id": faculty_id, "subscription": subscription})
    _write(PUSH_PATH, {"subs": rows})


def remove_push_subscription(endpoint: str) -> None:
    rows = _read(PUSH_PATH, {"subs": []}).get("subs", [])
    rows = [r for r in rows if r.get("subscription", {}).get("endpoint") != endpoint]
    _write(PUSH_PATH, {"subs": rows})
