"""Office-hours availability engine.

Pure helpers over a faculty record's schedule fields (office_hours / slot_minutes / auto_accept /
overrides). All datetimes are **naive local** (one timezone — Lebanon). The kiosk validates a
student's requested time against these rules before booking.

Faculty schedule shape (all optional, defaulted by db.get_schedule):
  office_hours: {"mon":[{"start":"10:00","end":"12:00"}], ... "sun":[]}
  slot_minutes: 30
  auto_accept:  false
  overrides:    [{"date":"YYYY-MM-DD","type":"block"|"extra","start"?,"end"?,"reason"?}]
"""
from datetime import datetime, timedelta, date as date_cls

import db

_WEEKDAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]


def _parse_hm(hm: str) -> tuple[int, int]:
    h, m = hm.split(":")
    return int(h), int(m)


def _ranges_for_day(schedule: dict, d: date_cls) -> list[tuple[datetime, datetime]]:
    """Concrete (start,end) datetime ranges for a date: weekly template − blocks + extras."""
    key = _WEEKDAY_KEYS[d.weekday()]
    base = []
    for r in schedule["office_hours"].get(key, []):
        try:
            sh, sm = _parse_hm(r["start"]); eh, em = _parse_hm(r["end"])
            s = datetime(d.year, d.month, d.day, sh, sm)
            e = datetime(d.year, d.month, d.day, eh, em)
            if e > s:
                base.append((s, e))
        except (KeyError, ValueError):
            continue

    iso = d.isoformat()
    # extras add ranges (even on otherwise-closed days)
    for ov in schedule["overrides"]:
        if ov.get("date") != iso or ov.get("type") != "extra":
            continue
        try:
            sh, sm = _parse_hm(ov["start"]); eh, em = _parse_hm(ov["end"])
            s = datetime(d.year, d.month, d.day, sh, sm)
            e = datetime(d.year, d.month, d.day, eh, em)
            if e > s:
                base.append((s, e))
        except (KeyError, ValueError):
            continue

    # blocks subtract
    for ov in schedule["overrides"]:
        if ov.get("date") != iso or ov.get("type") != "block":
            continue
        if "start" not in ov or "end" not in ov:
            return []  # whole-day block
        try:
            bh, bm = _parse_hm(ov["start"]); xh, xm = _parse_hm(ov["end"])
            bs = datetime(d.year, d.month, d.day, bh, bm)
            be = datetime(d.year, d.month, d.day, xh, xm)
        except (KeyError, ValueError):
            continue
        new = []
        for (s, e) in base:
            if be <= s or bs >= e:        # no overlap
                new.append((s, e))
            else:
                if s < bs:
                    new.append((s, bs))
                if be < e:
                    new.append((be, e))
        base = new

    return sorted(base)


def generate_slots(schedule: dict, d: date_cls) -> list[tuple[datetime, datetime]]:
    """Split the day's open ranges into slot_minutes chunks."""
    step = timedelta(minutes=max(5, int(schedule.get("slot_minutes", 30))))
    slots = []
    for (s, e) in _ranges_for_day(schedule, d):
        t = s
        while t + step <= e:
            slots.append((t, t + step))
            t += step
    return slots


def taken_starts(faculty_id: str, d: date_cls) -> set[str]:
    """ISO requested_start values already booked (pending/accepted) on that date."""
    out = set()
    for a in db.list_appointments(faculty_id=faculty_id):
        if a.get("status") not in ("pending", "accepted"):
            continue
        rs = a.get("requested_start")
        if rs and rs[:10] == d.isoformat():
            out.add(rs)
    return out


def _label(s: datetime, e: datetime) -> str:
    return f"{s.strftime('%a %b %d, %H:%M')}–{e.strftime('%H:%M')}"


def free_slots(schedule: dict, faculty_id: str, d: date_cls, from_dt: datetime | None = None) -> list[dict]:
    taken = taken_starts(faculty_id, d)
    out = []
    for (s, e) in generate_slots(schedule, d):
        if s.isoformat() in taken:
            continue
        if from_dt and s < from_dt:
            continue
        out.append({"start": s.isoformat(), "end": e.isoformat(), "label": _label(s, e)})
    return out


def has_any_hours(schedule: dict) -> bool:
    return any(schedule["office_hours"].get(k) for k in _WEEKDAY_KEYS) or bool(schedule["overrides"])


def next_available(schedule: dict, faculty_id: str, from_dt: datetime, horizon_days: int = 14, limit: int = 3) -> list[dict]:
    out = []
    for i in range(horizon_days):
        d = (from_dt + timedelta(days=i)).date()
        start_filter = from_dt if i == 0 else None
        for slot in free_slots(schedule, faculty_id, d, start_filter):
            out.append(slot)
            if len(out) >= limit:
                return out
    return out


def validate_request(faculty: dict, requested_iso: str | None, now: datetime | None = None) -> dict:
    """Decide whether a requested time can be booked.

    Returns either {ok:True, start, end, label, auto_accept}
    or {ok:False, reason, suggestions:[≤3 slots]} with reason in
    need_time | outside_hours | taken | no_hours_set | unparseable.
    """
    now = now or datetime.now()
    schedule = db.get_schedule(faculty["id"]) or {
        "office_hours": {k: [] for k in _WEEKDAY_KEYS}, "slot_minutes": 30, "auto_accept": False, "overrides": [],
    }

    if not has_any_hours(schedule):
        return {"ok": False, "reason": "no_hours_set", "suggestions": []}

    if not requested_iso:
        return {"ok": False, "reason": "need_time", "suggestions": next_available(schedule, faculty["id"], now)}

    try:
        req = datetime.fromisoformat(requested_iso.replace("Z", ""))
        req = req.replace(tzinfo=None)
    except (ValueError, AttributeError):
        return {"ok": False, "reason": "unparseable", "suggestions": next_available(schedule, faculty["id"], now)}

    # find the slot that starts at the requested time (snap to the slot grid of that day)
    for slot in generate_slots(schedule, req.date()):
        s, e = slot
        if abs((s - req).total_seconds()) < 60 or (s <= req < e):
            iso = s.isoformat()
            if iso in taken_starts(faculty["id"], req.date()):
                return {"ok": False, "reason": "taken", "suggestions": free_slots(schedule, faculty["id"], req.date()) or next_available(schedule, faculty["id"], now)}
            if s < now:
                return {"ok": False, "reason": "outside_hours", "suggestions": next_available(schedule, faculty["id"], now)}
            return {"ok": True, "start": iso, "end": e.isoformat(), "label": _label(s, e), "auto_accept": schedule["auto_accept"]}

    # requested time is not inside any open slot
    return {"ok": False, "reason": "outside_hours", "suggestions": next_available(schedule, faculty["id"], now)}
