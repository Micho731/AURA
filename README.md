# AURA — Automated Unified Reception Assistant

A voice-first AI reception kiosk that greets visitors, answers questions about a university faculty, and books meetings with instructors.

**Built:** June 2026 · Senior design project


## Demo

**Demo video** (1 min 45 s): a visitor walks up, AURA wakes, answers course questions, shows a flowchart, books a meeting, and the instructor accepts from a phone. Names and logos on the kiosk screen are blurred.

## Screenshots

**The kiosk in action**

<img width="1600" alt="AURA kiosk: avatar face above the info screen, answering questions and showing a flowchart; instructor app on a phone" src="media/aura-overview.jpg" />

**Animated avatar (lip-syncs to AURA's voice)**

<img width="500" alt="aura-10-avatar-face" src="https://github.com/user-attachments/assets/cdeeb87b-6c73-454e-887a-80f46f3476e0" />

**Instructor app (phone)**

<img width="1527" alt="Instructor app: sign-in, meeting inbox with accept and decline, weekly office hours" src="media/aura-instructor-app.jpg" />

**Admin dashboard**

<img width="450" alt="aura-9-admin-instructors" src="https://github.com/user-attachments/assets/68855b9f-0acf-4d8a-9903-e50f1972d62f" />


## Results

Evaluated on 32 visitor questions, with answers checked against the source data:

| Metric | Result |
| --- | --- |
| Answer accuracy | 91% (29 of 32) |
| Off-topic questions safely declined | 4 of 4 |
| Average time to spoken reply | 3.9 s |

## How it works

1. **Notices you.** A camera watches for a visitor who stands close and looks at the screen for 2.5 seconds, then AURA wakes and greets them.
2. **Listens.** Speech is transcribed in real time and filtered for noise and non-English input.
3. **Answers from real data.** A retrieval-augmented (RAG) GPT-4o pipeline answers only from the faculty's own knowledge base, so it does not make things up.
4. **Speaks and shows.** An animated avatar speaks the answer with lip-sync, while a second screen shows an info card (instructor, location, program, flowchart).
5. **Books meetings.** Visitors can request a meeting; the instructor accepts or declines from a phone web app.
6. **Forgets you.** When the visitor leaves for 7 seconds, AURA resets and wipes the conversation for privacy.

## Architecture

```
 Webcam ─► MediaPipe Face Landmarker (in browser, offline)
                │ visitor engaged
 Mic ───► Speech-to-text (OpenAI gpt-4o-transcribe │ faster-whisper offline)
                │ text
                ▼
        FastAPI backend ──► RAG: embeddings search ─► GPT-4o (JSON mode)
                │                 reply + card + expression + action
                ▼
 Text-to-speech (gpt-4o-mini-tts │ edge-tts offline) + viseme timings
                │
   ┌────────────┼──────────────────┬───────────────────┐
 /face        /display           /faculty            /admin
 avatar       info cards         instructor inbox    roster, knowledge,
 lip-sync     + wake logic       + web push          media management
```

## Tech stack

| Layer | Tools |
| --- | --- |
| Frontend | React 18, Vite, Tailwind CSS, Framer Motion, React Router |
| Computer vision | MediaPipe Face Landmarker (WASM, runs offline in the browser) |
| Backend | Python, FastAPI, Uvicorn |
| AI | OpenAI GPT-4o, text-embedding-3-small, gpt-4o-transcribe, gpt-4o-mini-tts |
| Offline fallbacks | faster-whisper (speech-to-text), edge-tts (text-to-speech) |
| Data | JSON file store, NumPy vector index with cosine similarity |
| Knowledge ingestion | BeautifulSoup, Playwright, PyMuPDF, pypdf, python-docx |
| Notifications | Web Push (VAPID) via pywebpush |
| Hardware | Mini-PC, 24" info display, 10" face screen, webcam, USB microphone |

## Engineering notes

- **RAG over a general chatbot** keeps answers grounded in the institution's real information.
- **Perception runs on-device.** Presence detection happens in the browser and no camera images are stored.
- **Cloud first, offline fallback.** Speech recognition and synthesis switch to local models when the network drops.
- **Gaze-based wake-up** (face size, yaw within 22°, pitch within 20°, held 2.5 s) avoids false triggers from people walking past.
- **No database server.** Atomic JSON files keep the kiosk simple to deploy and maintain.
- **Institution-neutral.** The university name, faculty, campuses and scraper sources live in `.env` and `tools/sources.json`, so the same code runs at any faculty.

## Repository layout

```
backend/
  main.py            FastAPI app, CORS, static files
  db.py              JSON store: faculty, appointments, knowledge, media
  routes/            chat, faculty, admin, push endpoints
  services/          rag, brain (vector index), stt, tts, scheduling, push
  config.py          institution, faculty and campus names (from .env)
  tools/             scrape the faculty website and build the knowledge index
data/                sample data (demo instructors, FAQ, settings)
media/               demo video and screenshots
frontend/
  src/pages/         Face, Display, Faculty, Admin, CameraTest
  src/components/    Avatar, Cards, managers for knowledge, media, schedule
  src/lib/           usePresence (MediaPipe), recorder, face channel
  public/mediapipe/  offline face-landmark model and WASM runtime
```

## Run it (Windows)

Needs Python 3.10+, Node.js 18+, and an OpenAI API key.

```powershell
# Backend
cd backend
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env      # then put your OpenAI key and your institution's names in .env

# Build the knowledge base: copy tools\sources.example.json to tools\sources.json,
# point it at your faculty site, then scrape and embed
python -m tools.scrape_foe
python -m tools.ingest

# Frontend
cd ..\frontend
copy .env.example .env      # optional: your institution's name on screen
npm install
npm run build
```

Then double-click `START-AURA.bat` and open:

| Route | Device | Purpose |
| --- | --- | --- |
| `/display` | Kiosk PC | Info cards and wake-up logic |
| `/face` | Face screen | Avatar with lip-sync |
| `/faculty` | Instructor phone | Meeting requests and availability |
| `/admin` | Staff laptop | Manage instructors, knowledge, media |

Demo instructor login: `jdoe` / `demo1234` (sample data only).

## Limitations and next steps

- Prototype authentication: demo passwords are stored in plain text. Production use needs hashed credentials and proper sessions.
- The language model runs in the cloud; a local model fallback is planned.
- English only for now; multi-language support is future work.

## Author

**Michel Salame** — [LinkedIn](https://www.linkedin.com/in/michel-salame)
