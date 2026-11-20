"""AURA backend — FOE Reception Intelligence.

Three-device deployment:
  - PC: belly screen (smart cards) + wake-word listener with external mic
  - Phone: face display (avatar with lip-sync)
  - Faculty phones: inbox of pending meeting requests + availability toggle
"""
import os
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

from routes import chat, faculty, admin, push  # noqa: E402

app = FastAPI(title="AURA — FOE Reception Intelligence", version="3.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")
AUDIO_DIR = os.path.join(STATIC_DIR, "audio")
os.makedirs(AUDIO_DIR, exist_ok=True)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

# Serve tagged images for the belly screen
MEDIA_DIR = os.path.join(os.path.dirname(__file__), "..", "data", "media")
os.makedirs(MEDIA_DIR, exist_ok=True)
app.mount("/media", StaticFiles(directory=MEDIA_DIR), name="media")

app.include_router(chat.router, prefix="/api/chat", tags=["chat"])
app.include_router(faculty.router, prefix="/api/faculty", tags=["faculty"])
app.include_router(admin.router, prefix="/api/admin", tags=["admin"])
app.include_router(push.router, prefix="/api/push", tags=["push"])


@app.get("/api/health")
def health():
    return {"name": "AURA", "version": "3.0", "status": "online"}


# ---- Serve the built frontend (single-port deployment) ----------------------
# When `frontend/dist` exists (after `npm run build`), FastAPI serves the whole app itself, so the
# kiosk + faculty portal run on ONE port (8000) — no separate Vite server, and it works behind an
# HTTPS tunnel with zero extra config. In dev you can still run Vite on 5173 separately.
DIST_DIR = os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")
ASSETS_DIR = os.path.join(DIST_DIR, "assets")
INDEX_HTML = os.path.join(DIST_DIR, "index.html")

if os.path.isdir(ASSETS_DIR):
    app.mount("/assets", StaticFiles(directory=ASSETS_DIR), name="assets")


@app.get("/{full_path:path}")
def spa(full_path: str):
    """Serve real files from dist when they exist, else return index.html so React Router can
    handle client-side routes like /faculty, /display, /admin on direct load and refresh."""
    if full_path.startswith(("api/", "static/", "media/", "assets/")):
        return JSONResponse({"detail": "Not Found"}, status_code=404)
    candidate = os.path.join(DIST_DIR, full_path)
    if full_path and os.path.isfile(candidate):
        return FileResponse(candidate)
    if os.path.isfile(INDEX_HTML):
        return FileResponse(INDEX_HTML)
    return JSONResponse({"name": "AURA", "version": "3.0", "status": "online (no built frontend — run npm run build)"}, status_code=200)
