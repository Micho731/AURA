"""Kiosk identity: which institution, faculty and campuses AURA serves.

Everything institution-specific is read from backend/.env so the same code can run at any
university. The defaults describe a neutral demo institution.
"""
import os

INSTITUTION_NAME = os.getenv("INSTITUTION_NAME", "Example University").strip()
FACULTY_NAME = os.getenv("FACULTY_NAME", "Faculty of Engineering and Computer Science").strip()

# Comma-separated list of campus names; the first one is the default home campus.
CAMPUSES = [c.strip() for c in os.getenv("CAMPUSES", "Main Campus, North Campus, South Campus").split(",") if c.strip()]
HOME_CAMPUS = os.getenv("HOME_CAMPUS", CAMPUSES[0]).strip()
