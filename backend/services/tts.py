"""Text-to-speech with per-character viseme timing for lip-sync.

Two providers, selected by env `TTS_PROVIDER` (default "openai"):
  - openai : `gpt-4o-mini-tts` — natural, human-like voice (needs network + API key).
  - edge   : `edge-tts` — free, offline Microsoft Neural voice.

Either way `synthesize(text, output_path) -> visemes` keeps the same contract, so chat.py and the
face's BroadcastChannel are unchanged. OpenAI TTS returns no word timings, so for that path we
estimate viseme timing evenly across the audio's true duration (parsed from the MP3).
"""
import os
import re

import edge_tts

# Strip any non-Latin script (e.g. Arabic) so the English voice never mispronounces or skips words.
_NON_LATIN_RE = re.compile(r"[^\x00-\x7F]")


def _english_only(text: str) -> str:
    return re.sub(r"\s+", " ", _NON_LATIN_RE.sub("", text)).strip()


# --- Viseme vocabulary -------------------------------------------------------
# Richer, speech-like mouth shapes (Preston-Blair-style set). The face renderer knows how to draw
# and morph each label. Single letters map here; common digraphs are handled in _word_to_visemes.
# Labels: MBP (lips shut), FV (lip-to-teeth), OO (tight round), O (open round), AI (wide open),
#         E (wide spread), L (tongue tip), TH (tongue-teeth), CONS (generic consonant/teeth),
#         R (slight round), rest (closed neutral).
PHONEME_MAP = {
    'a': 'AI', 'e': 'E', 'i': 'E', 'o': 'O', 'u': 'OO', 'y': 'E',
    'm': 'MBP', 'b': 'MBP', 'p': 'MBP',
    'f': 'FV', 'v': 'FV',
    'w': 'OO', 'q': 'OO',
    'l': 'L',
    'r': 'R',
    's': 'CONS', 't': 'CONS', 'd': 'CONS', 'n': 'CONS', 'z': 'CONS',
    'c': 'CONS', 'g': 'CONS', 'j': 'CONS', 'k': 'CONS', 'x': 'CONS',
    'h': 'AI',
}

# Digraphs collapse to ONE viseme (so the mouth forms the sound, not each letter).
DIGRAPH_MAP = {
    'sh': 'OO', 'ch': 'OO', 'th': 'TH', 'ph': 'FV',
    'oo': 'OO', 'ou': 'OO', 'ow': 'OO', 'ee': 'E', 'ea': 'E',
    'oa': 'O', 'ai': 'AI', 'ay': 'AI', 'wh': 'OO', 'qu': 'OO',
}


def _word_to_visemes(word: str) -> list[str]:
    """Turn a word into a sequence of viseme labels: handle digraphs, then letters, and collapse
    consecutive duplicates so the mouth holds a shape instead of stuttering identical frames."""
    s = [c for c in word.lower() if c.isalpha()]
    labels: list[str] = []
    i = 0
    while i < len(s):
        pair = "".join(s[i:i + 2])
        if len(pair) == 2 and pair in DIGRAPH_MAP:
            labels.append(DIGRAPH_MAP[pair]); i += 2
        else:
            labels.append(PHONEME_MAP.get(s[i], 'rest')); i += 1
    # collapse runs of the same shape
    out: list[str] = []
    for lbl in labels:
        if not out or out[-1] != lbl:
            out.append(lbl)
    return out

TTS_PROVIDER = os.getenv("TTS_PROVIDER", "openai").lower()
EDGE_VOICE = os.getenv("EDGE_TTS_VOICE", "en-US-JennyNeural")
OPENAI_TTS_MODEL = os.getenv("OPENAI_TTS_MODEL", "gpt-4o-mini-tts")
OPENAI_TTS_VOICE = os.getenv("OPENAI_TTS_VOICE", "nova")  # bright, upbeat
# Tone/emotion steering for gpt-4o-mini-tts (the model honors free-text instructions).
OPENAI_TTS_INSTRUCTIONS = os.getenv(
    "OPENAI_TTS_INSTRUCTIONS",
    "Speak in a warm, upbeat, energetic and friendly tone, like a cheerful university receptionist "
    "welcoming a student. Sound genuinely happy to help, with lively but natural pacing and clear "
    "articulation. Keep it positive and bright."
)

_client = None


def _get_client():
    global _client
    if _client is None:
        from openai import OpenAI
        _client = OpenAI()
    return _client


# Natural speaking rate, used to pace estimated visemes. ~13 characters/second ≈ 150 wpm. This is
# encoder-independent and reliable; the browser uses the REAL audio length for speaking-state timing,
# and the face cycles the mouth if audio runs past the visemes — so visemes only need plausible pacing.
CHARS_PER_SEC = float(os.getenv("TTS_CHARS_PER_SEC", "13"))


def _estimate_duration(text: str) -> float:
    return max(len(text) / CHARS_PER_SEC, 0.6)


def _estimate_visemes(text: str, duration_s: float = 0.0) -> list[dict]:
    """Distribute speech-like mouth shapes evenly across the audio duration.

    Builds one viseme per sound (digraph-aware, duplicates collapsed) across all words, with a brief
    closed 'rest' between words so the mouth settles between them. If duration is unknown (<=0),
    estimate it from the text at a natural speaking rate. Contract unchanged: returns {start,end,mouth}.
    """
    words = re.findall(r"[a-zA-Z]+", text)
    if not words:
        return []
    # flat sequence of labels, with a short rest between words
    seq: list[str] = []
    for wi, w in enumerate(words):
        seq.extend(_word_to_visemes(w))
        if wi < len(words) - 1:
            seq.append('rest')
    if not seq:
        return []
    if duration_s <= 0:
        duration_s = _estimate_duration(text)
    d = duration_s / len(seq)
    visemes, t = [], 0.0
    for lbl in seq:
        visemes.append({"start": round(t, 3), "end": round(t + d, 3), "mouth": lbl})
        t += d
    return visemes


async def _synthesize_openai(text: str, output_path: str) -> list[dict]:
    """OpenAI TTS → mp3 + estimated visemes. Raises on failure (caller falls back to edge)."""
    client = _get_client()
    kwargs = dict(model=OPENAI_TTS_MODEL, voice=OPENAI_TTS_VOICE, input=text, response_format="mp3")
    if OPENAI_TTS_INSTRUCTIONS:
        kwargs["instructions"] = OPENAI_TTS_INSTRUCTIONS  # tone steering (gpt-4o-mini-tts)
    try:
        resp = client.audio.speech.create(**kwargs)
    except TypeError:
        kwargs.pop("instructions", None)  # older SDK without instructions support
        resp = client.audio.speech.create(**kwargs)
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    resp.stream_to_file(output_path)
    return _estimate_visemes(text)  # paced from text; browser uses the real audio clock


async def _synthesize_edge(text: str, output_path: str) -> list[dict]:
    """edge-tts → mp3 + accurate visemes from WordBoundary events. Free + offline."""
    communicate = edge_tts.Communicate(text, EDGE_VOICE)
    word_boundaries: list[dict] = []
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, "wb") as f:
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                f.write(chunk["data"])
            elif chunk["type"] == "WordBoundary":
                start = chunk["offset"] / 10_000_000
                dur = chunk["duration"] / 10_000_000
                word_boundaries.append({"word": chunk.get("text", ""), "start": start, "end": start + dur})

    visemes: list[dict] = []
    OFFSET = -0.04
    for wb in word_boundaries:
        labels = _word_to_visemes(wb["word"])
        if not labels:
            continue
        seg_dur = (wb["end"] - wb["start"]) / len(labels)
        t = max(0.0, wb["start"] + OFFSET)
        for lbl in labels:
            visemes.append({"start": round(t, 3), "end": round(t + seg_dur, 3), "mouth": lbl})
            t += seg_dur

    if not visemes:  # no word boundaries — estimate pacing from text
        visemes = _estimate_visemes(text)
    return visemes


async def synthesize(text: str, output_path: str) -> list[dict]:
    """Write MP3 to output_path and return [{start, end, mouth}, ...] visemes.

    Uses the configured provider; on any OpenAI error, automatically falls back to edge-tts so the
    kiosk keeps talking even offline.
    """
    text = _english_only(text) or "Sorry, could you repeat that?"

    if TTS_PROVIDER == "openai" and os.getenv("OPENAI_API_KEY"):
        try:
            return await _synthesize_openai(text, output_path)
        except Exception as e:
            print(f"[TTS] OpenAI TTS failed ({e}); falling back to edge-tts.")

    return await _synthesize_edge(text, output_path)
