"""Extract plain text from admin-uploaded knowledge files so AURA can learn from them.

Supported: PDF (text, or vision-OCR for scanned pages), Word (.docx), plain text/markdown, and
images (gpt-4o vision reads/describes them). Returns extracted text; the caller saves it into the
knowledge folder and re-ingests it into the brain.
"""
import io
import os
import base64

TEXT_EXT = {".txt", ".md", ".csv"}
PDF_EXT = {".pdf"}
DOCX_EXT = {".docx"}
IMAGE_EXT = {".jpg", ".jpeg", ".png", ".webp", ".gif"}
SUPPORTED_EXT = TEXT_EXT | PDF_EXT | DOCX_EXT | IMAGE_EXT

_client = None


def _get_client():
    global _client
    if _client is None:
        from openai import OpenAI
        _client = OpenAI()
    return _client


def _from_text(data: bytes) -> str:
    for enc in ("utf-8", "utf-8-sig", "latin-1"):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="ignore")


def _from_docx(data: bytes) -> str:
    import docx
    doc = docx.Document(io.BytesIO(data))
    parts = [p.text for p in doc.paragraphs if p.text.strip()]
    for tbl in doc.tables:
        for row in tbl.rows:
            cells = [c.text.strip() for c in row.cells if c.text.strip()]
            if cells:
                parts.append(" | ".join(cells))
    return "\n".join(parts)


def _from_pdf(data: bytes) -> str:
    # 1) try direct text extraction (pypdf)
    text = ""
    try:
        from pypdf import PdfReader
        reader = PdfReader(io.BytesIO(data))
        text = "\n".join((p.extract_text() or "") for p in reader.pages).strip()
    except Exception:
        text = ""
    if len(text) >= 120:
        return text
    # 2) scanned/low-text PDF → render pages and read with vision (cap pages for cost)
    try:
        import fitz
        doc = fitz.open(stream=data, filetype="pdf")
        chunks = []
        for i, pg in enumerate(doc):
            if i >= 10:
                break
            png = pg.get_pixmap(dpi=170).tobytes("png")
            chunks.append(_vision_read(png, "Transcribe all readable text from this document page. Plain text only."))
        return "\n\n".join(c for c in chunks if c).strip() or text
    except Exception:
        return text


def _vision_read(png_bytes: bytes, prompt: str) -> str:
    resp = _get_client().chat.completions.create(
        model="gpt-4o", temperature=0, max_tokens=1500,
        messages=[{"role": "user", "content": [
            {"type": "text", "text": prompt},
            {"type": "image_url", "image_url": {"url": "data:image/png;base64," + base64.b64encode(png_bytes).decode()}},
        ]}],
    )
    return (resp.choices[0].message.content or "").strip()


def _from_image(data: bytes) -> str:
    return _vision_read(
        data,
        "Describe this image in detail for a university knowledge base. If it contains any text, "
        "tables, charts, or a diagram/flowchart, transcribe and explain it fully. Plain text only.",
    )


def extract(filename: str, data: bytes) -> str:
    """Return extracted text for a supported file, or '' if unsupported/empty."""
    ext = os.path.splitext(filename or "")[1].lower()
    if ext in TEXT_EXT:
        return _from_text(data)
    if ext in DOCX_EXT:
        return _from_docx(data)
    if ext in PDF_EXT:
        return _from_pdf(data)
    if ext in IMAGE_EXT:
        return _from_image(data)
    return ""
