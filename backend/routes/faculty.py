"""Faculty endpoints — login, availability toggle, appointment inbox, office hours."""
from datetime import datetime

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

import db
from services import scheduling

router = APIRouter()


class LoginRequest(BaseModel):
    username: str
    password: str


class StatusUpdate(BaseModel):
    faculty_id: str
    status: str


class AppointmentResponse(BaseModel):
    appointment_id: str
    accept: bool
    message: str = ""


class ScheduleUpdate(BaseModel):
    faculty_id: str
    office_hours: dict
    slot_minutes: int = 30


class OverridesUpdate(BaseModel):
    faculty_id: str
    overrides: list[dict] = []


class AutoAcceptUpdate(BaseModel):
    faculty_id: str
    auto_accept: bool


VALID_STATUSES = {"Available", "Busy", "In Class", "In Meeting", "Away"}


@router.post("/login")
async def login(req: LoginRequest):
    record = db.find_faculty_by_username(req.username)
    if not record or record["password"] != req.password:
        raise HTTPException(status_code=401, detail="Invalid username or password")
    return {"success": True, "faculty": {k: v for k, v in record.items() if k != "password"}}


@router.post("/status")
async def set_status(req: StatusUpdate):
    if req.status not in VALID_STATUSES:
        raise HTTPException(status_code=400, detail=f"Invalid status. Must be one of {VALID_STATUSES}")
    ok = db.update_faculty_status(req.faculty_id, req.status)
    if not ok:
        raise HTTPException(status_code=404, detail="Faculty not found")
    return {"success": True, "status": req.status}


@router.get("/appointments/{faculty_id}")
async def list_appointments(faculty_id: str, status: str | None = None):
    return {"appointments": db.list_appointments(faculty_id=faculty_id, status=status)}


@router.post("/appointments/respond")
async def respond(req: AppointmentResponse):
    record = db.respond_appointment(req.appointment_id, req.accept, req.message)
    if not record:
        raise HTTPException(status_code=404, detail="Appointment not found")
    return {"success": True, "appointment": record}


# ------- Office hours / schedule ---------------------------------------------

@router.get("/schedule/{faculty_id}")
async def get_schedule(faculty_id: str):
    sched = db.get_schedule(faculty_id)
    if sched is None:
        raise HTTPException(status_code=404, detail="Faculty not found")
    return sched


@router.post("/schedule")
async def set_schedule(req: ScheduleUpdate):
    if not (1 <= req.slot_minutes <= 240):
        raise HTTPException(status_code=400, detail="slot_minutes must be between 1 and 240")
    if not db.set_office_hours(req.faculty_id, req.office_hours, req.slot_minutes):
        raise HTTPException(status_code=404, detail="Faculty not found")
    return {"success": True, "office_hours": req.office_hours, "slot_minutes": req.slot_minutes}


@router.get("/overrides/{faculty_id}")
async def get_overrides(faculty_id: str):
    sched = db.get_schedule(faculty_id)
    if sched is None:
        raise HTTPException(status_code=404, detail="Faculty not found")
    return {"overrides": sched["overrides"]}


@router.post("/overrides")
async def set_overrides(req: OverridesUpdate):
    if not db.set_overrides(req.faculty_id, req.overrides):
        raise HTTPException(status_code=404, detail="Faculty not found")
    return {"success": True, "overrides": req.overrides}


@router.post("/auto-accept")
async def set_auto_accept(req: AutoAcceptUpdate):
    if not db.set_auto_accept(req.faculty_id, req.auto_accept):
        raise HTTPException(status_code=404, detail="Faculty not found")
    return {"success": True, "auto_accept": req.auto_accept}


@router.get("/availability/{faculty_id}")
async def availability(faculty_id: str, date: str):
    faculty = db.get_faculty(faculty_id)
    if not faculty:
        raise HTTPException(status_code=404, detail="Faculty not found")
    sched = db.get_schedule(faculty_id)
    try:
        d = datetime.fromisoformat(date).date()
    except ValueError:
        raise HTTPException(status_code=400, detail="date must be YYYY-MM-DD")
    return {"date": date, "free_slots": scheduling.free_slots(sched, faculty_id, d)}
