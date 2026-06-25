"""Minimal speech-to-text proxy for the voice-quiz demo.

Holds the Groq API key server-side and forwards recorded audio to Groq's
Whisper-large-v3-turbo transcription endpoint. The browser only ever talks to
this proxy — the key is never shipped to the client or committed to git.

Standalone and isolated: touches no production backend, DB, or code.
"""
import os

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

load_dotenv()

GROQ_API_KEY = os.getenv("GROQ_API_KEY", "").strip()
GROQ_MODEL = os.getenv("GROQ_MODEL", "whisper-large-v3-turbo").strip()
CORS_ORIGINS = [
    o.strip()
    for o in os.getenv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",")
    if o.strip()
]
PORT = int(os.getenv("PORT", "8089"))
GROQ_URL = "https://api.groq.com/openai/v1/audio/transcriptions"

app = FastAPI(title="STT proxy (Groq Whisper)", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "model": GROQ_MODEL, "key_configured": bool(GROQ_API_KEY)}


@app.post("/stt")
async def stt(
    file: UploadFile = File(...),
    language: str = Form("en"),
    prompt: str = Form(""),
) -> dict:
    """Transcribe an uploaded audio clip via Groq Whisper. Returns { text }.

    An optional `prompt` (<=224 tokens) biases Whisper toward domain vocabulary
    and proper-noun spelling — e.g. naming the expected technical terms.
    """
    if not GROQ_API_KEY:
        raise HTTPException(status_code=503, detail="GROQ_API_KEY not configured in .env")

    audio = await file.read()
    if not audio:
        raise HTTPException(status_code=400, detail="empty audio upload")

    files = {"file": (file.filename or "answer.webm", audio, file.content_type or "audio/webm")}
    data = {
        "model": GROQ_MODEL,
        "language": language,
        "response_format": "json",
        "temperature": "0",
    }
    if prompt.strip():
        data["prompt"] = prompt.strip()
    headers = {"Authorization": f"Bearer {GROQ_API_KEY}"}

    try:
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(GROQ_URL, files=files, data=data, headers=headers)
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"Groq upstream error: {e}") from e

    if resp.status_code != 200:
        # surface Groq's error so a bad key / quota / format is debuggable
        raise HTTPException(status_code=resp.status_code, detail=resp.text[:400])

    return {"text": resp.json().get("text", "")}
