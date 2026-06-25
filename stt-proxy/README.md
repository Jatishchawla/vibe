# STT proxy (Groq Whisper) — voice-quiz demo

Tiny standalone proxy that holds the Groq API key server-side and transcribes
recorded audio via **whisper-large-v3-turbo**. The browser posts audio here; the
key never reaches the client or git. Touches no production code.

## Run
```bash
cd stt-proxy
python -m venv .venv
# Windows:  .venv\Scripts\activate     macOS/Linux:  source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env          # then add GROQ_API_KEY (free, no credit card)
uvicorn app.main:app --port 8089
```

## Endpoints
- `GET  /health` — `{ status, model, key_configured }`
- `POST /stt` — multipart `file=<audio>` (+ optional `language`) → `{ text }`

Get a free key at https://console.groq.com (2,000 requests/day, no card).
