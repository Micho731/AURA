"""Speech-to-text.

Primary path: OpenAI hosted transcription (gpt-4o-transcribe) — the most accurate option,
biased with a domain prompt so it gets campus names and engineering terms right.
Fallback path: local faster-whisper (offline, free) if the API call fails or no key is set.
"""
import io
import os
import re
import tempfile

# Keep the prompt SHORT and name-free. Transcription models echo their prompt back when they
# get silence/noise, so a long list of faculty names caused phantom faculty-name
# transcripts when no one spoke. A light topical nudge is enough; the LLM resolves names later.
DOMAIN_PROMPT = "English only. Topic: a university engineering reception."

# Common hallucinations transcription models emit on silence/noise — reject these outright.
# Pure transcription artifacts the model emits on silence/noise. Greetings are NOT here —
# the mic's audio-level gate rejects phantom audio, so a real spoken "hi"/"hello" must pass through.
_HALLUCINATIONS = {
    "", ".", "you", "you.", "thank you", "thank you.", "thanks",
    "thanks for watching", "thanks for watching!", "thank you for watching",
    "please subscribe", "subscribe",
    # whole-phrase hallucinations transcription models emit on silence
    "good evening everyone", "good evening everyone.", "good evening",
    "good morning everyone", "good morning everyone.", "good morning",
    "good afternoon everyone", "good afternoon everyone.",
    "hello everyone", "hello everyone.", "see you next time", "see you next time.",
    "bye bye", "bye bye.", "okay", "okay.", "alright", "all right",
}

# Keep only Latin letters, digits, and basic punctuation — strips Arabic/other scripts entirely.
_NON_LATIN_RE = re.compile(r"[^\x00-\x7F]")


def _to_english(text: str) -> str:
    """Remove any non-Latin (e.g. Arabic) characters; collapse leftover whitespace."""
    cleaned = _NON_LATIN_RE.sub("", text)
    return re.sub(r"\s+", " ", cleaned).strip()


# A compact set of very common English words. A real English question almost always contains at
# least one of these; gibberish/foreign hallucinations ("pasuri kshtudoktor", "tu") contain none.
_COMMON_EN = {
    "the", "a", "an", "is", "are", "am", "was", "were", "be", "do", "does", "did", "to", "of",
    "in", "on", "at", "for", "with", "and", "or", "but", "not", "no", "yes", "i", "you", "he",
    "she", "it", "we", "they", "me", "my", "your", "his", "her", "our", "their", "this", "that",
    "these", "those", "what", "where", "who", "when", "why", "how", "which", "can", "could",
    "would", "should", "will", "want", "need", "have", "has", "had", "go", "going", "get",
    "tell", "show", "find", "know", "see", "meet", "talk", "speak", "ask", "help", "please",
    "thanks", "thank", "hello", "hi", "hey", "good", "morning", "afternoon", "evening",
    "campus", "dean", "office", "professor", "doctor", "dr", "teacher", "instructor", "faculty",
    "engineering", "mechatronics", "computer", "lab", "course", "courses", "class", "program",
    "student", "appointment", "meeting", "building", "room", "department", "admission", "tuition",
    "one", "two", "three", "four", "here", "there", "about", "from", "like", "want", "looking",
    "university",
    "free", "today", "tomorrow", "now", "time", "available", "open", "when", "week",
    "register", "registration", "exam", "exams", "fee", "fees", "cost", "scholarship",
    "competition", "competitions", "project", "projects", "expo", "robotics", "research",
    "prerequisite", "prerequisites", "science", "register", "semester", "summer", "fall", "spring",
}

# Campus and institution names from the kiosk config also count as known words.
try:
    import config as _config
    _COMMON_EN |= {w.lower() for name in [_config.INSTITUTION_NAME, *_config.CAMPUSES]
                   for w in re.findall(r"[A-Za-z]+", name) if len(w) > 2}
except Exception:  # config is optional for this module
    pass

# Spoken numbers are valid one-word answers (campus picker etc.)
_VALID_SHORT = {"one", "two", "three", "four", "1", "2", "3", "4", "yes", "no", "hi", "hello", "hey"}


def _is_english(text: str) -> bool:
    """True if the transcript plausibly reads as English.

    LENIENT on purpose: false-rejecting a real question (especially one full of names like
    "Who is Dr. <name>?") sends the visitor into a "Sorry, I didn't catch that" loop, which
    is far worse than occasionally passing slightly-odd text to the LLM — the LLM handles unclear
    input gracefully and never loops. Pure silence and known transcription artifacts are still
    filtered separately (see _looks_like_noise / _HALLUCINATIONS), and non-Latin script is stripped.
    """
    words = re.findall(r"[a-zA-Z]+", text.lower())
    if not words:
        return False
    # Single word: allow numbers/yes-no/greetings, any known word, or a longish word (likely a real
    # name or topic, e.g. "registration", "robotics", "Awaijan").
    if len(words) == 1:
        w = words[0]
        return w in _VALID_SHORT or w in _COMMON_EN or len(w) >= 6
    # Multi-word: a genuine English phrase almost always contains at least one common function/topic
    # word. One hit is enough.
    return any(w in _COMMON_EN for w in words)


def _looks_like_noise(text: str) -> bool:
    """True if the transcript is empty, a known artifact, or not recognizable English."""
    t = text.strip().lower().strip(" .,!?")
    if not t:
        return True
    if t in _HALLUCINATIONS:
        return True
    if not _is_english(t):
        return True
    return False

OPENAI_STT_MODEL = os.getenv("OPENAI_STT_MODEL", "gpt-4o-transcribe")

_model = None  # local fallback
MODEL_SIZE = os.getenv("WHISPER_MODEL", "base")
COMPUTE_TYPE = os.getenv("WHISPER_COMPUTE", "int8")

_client = None


def _get_client():
    global _client
    if _client is None:
        from openai import OpenAI
        _client = OpenAI()  # reads OPENAI_API_KEY
    return _client


def _transcribe_openai(audio_bytes: bytes, suffix: str) -> str:
    """Hosted transcription. Returns text, or raises on failure."""
    fname = "utterance" + (suffix if suffix.startswith(".") else "." + suffix)
    buf = io.BytesIO(audio_bytes)
    buf.name = fname  # the SDK uses the name's extension to pick the decoder
    resp = _get_client().audio.transcriptions.create(
        model=OPENAI_STT_MODEL,
        file=buf,
        language="en",
        prompt=DOMAIN_PROMPT,
        temperature=0.0,
    )
    return (resp.text or "").strip()


def _get_model():
    global _model
    if _model is None:
        from faster_whisper import WhisperModel
        print(f"[STT] loading local faster-whisper '{MODEL_SIZE}' ({COMPUTE_TYPE}) as fallback…")
        _model = WhisperModel(MODEL_SIZE, device="cpu", compute_type=COMPUTE_TYPE)
        print("[STT] local model ready")
    return _model


def _transcribe_local(audio_bytes: bytes, suffix: str) -> str:
    model = _get_model()
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp.write(audio_bytes)
            tmp_path = tmp.name
        segments, _info = model.transcribe(tmp_path, language="en", vad_filter=True, beam_size=1)
        return " ".join(seg.text.strip() for seg in segments).strip()
    finally:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except OSError:
                pass


def transcribe(audio_bytes: bytes, suffix: str = ".webm") -> tuple[str, bool]:
    """Transcribe an audio blob to English text.

    Returns (text, dropped):
      - ("some english", False)  -> a clean English transcript
      - ("", False)              -> silence / nothing heard (ignore quietly)
      - ("", True)               -> something WAS heard but it was gibberish/foreign/non-English,
                                    so AURA should ask the visitor to repeat in English.
    """
    raw = ""
    if os.getenv("OPENAI_API_KEY"):
        try:
            raw = _transcribe_openai(audio_bytes, suffix)
        except Exception as e:
            print(f"[STT] OpenAI transcription failed ({e}); falling back to local Whisper.")
            try:
                raw = _transcribe_local(audio_bytes, suffix)
            except Exception as e2:
                print(f"[STT] local transcription error: {e2}")
                return "", False
    else:
        try:
            raw = _transcribe_local(audio_bytes, suffix)
        except Exception as e:
            print(f"[STT] local transcription error: {e}")
            return "", False

    text = _to_english(raw)  # strip Arabic / any non-Latin script
    if _looks_like_noise(text):
        # If the model produced actual words (>=2 chars, has letters) but they failed the English
        # check, treat it as "didn't catch that" so AURA can prompt. Pure silence -> quiet ignore.
        had_words = len(re.findall(r"[a-zA-Z]{2,}", text)) >= 1
        print(f"[STT] dropped (english={not had_words and 'silence' or 'gibberish'}): {text!r}")
        return "", had_words
    return text, False
