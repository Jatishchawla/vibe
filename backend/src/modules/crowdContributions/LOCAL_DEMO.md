# Crowd Contributions — Local / Free Demo Guide

Run the AI-validated question contribution feature **with no paid APIs**: the
judge and embeddings run on a **local Ollama** server, dedup uses **in-app
cosine** (so plain local MongoDB is fine), and auth uses the **Firebase emulator**.

There is **one external thing only if you choose it** — and here we avoid it.

---

## 0. Prerequisites (install these)

| Tool | Why | Install |
|---|---|---|
| Node.js (LTS) + **pnpm** | run the app | nodejs.org · `npm i -g pnpm` |
| **Ollama** | local LLM (judge) + embeddings | https://ollama.com (Win/Mac/Linux) |
| **MongoDB** | database | Docker (`docker run -d -p 27017:27017 --name vibe-mongo mongo`) or MongoDB Community |
| **Firebase CLI** | local auth emulator | `npm i -g firebase-tools` |

---

## 1. Ollama (the free AI)

```bash
# after installing Ollama (it runs a server at http://localhost:11434)
ollama pull llama3.1            # the judge model (or: qwen2.5  — often better at JSON)
ollama pull nomic-embed-text    # the embeddings model
ollama list                     # verify both are present
```
Ollama auto-starts a server; if not: `ollama serve`.

> Tip: if `llama3.1` gives flaky JSON verdicts, try `qwen2.5` and set
> `CROWD_JUDGE_MODEL="qwen2.5"`.

---

## 2. Database — pick one

**Option A — fastest working demo (recommended): local AI + the existing test DB.**
Point `DB_URL` at the shared `vibe-test` Atlas cluster so you already have real
courses/videos/users to attach a contribution to. Our feature only **adds a new
`crowdContributions` collection** — it never modifies existing data.

**Option B — fully local DB.** Run local MongoDB (Docker line above). It starts
**empty**, so you must seed at least one course → version → **video segment** and
a student + a teacher/admin user before you can submit. More setup; use A unless
you specifically need the DB local too.

---

## 3. Backend env — `vibe/backend/.env`

```ini
# App
APP_MODULE="all"                 # CRITICAL: loads the crowdContributions module
APP_PORT="8080"
APP_URL="http://localhost:8080"
APP_ORIGINS="http://localhost:5173"
APP_ROUTE_PREFIX="/api"

# Database  (Option A: paste the vibe-test Atlas URL · Option B: local)
DB_URL="mongodb://localhost:27017"     # or the vibe-test Atlas connection string
DB_NAME="vibe"

# Auth (Firebase emulator)
FIREBASE_AUTH_EMULATOR_HOST="127.0.0.1:9099"
GCLOUD_PROJECT="demo-test"

# Crowd Contributions — LOCAL / FREE (Ollama)
CROWD_LLM_PROVIDER="ollama"
CROWD_EMBED_PROVIDER="ollama"
OLLAMA_BASE_URL="http://localhost:11434"
CROWD_JUDGE_MODEL="llama3.1"
CROWD_EMBED_MODEL="nomic-embed-text"
```
(Leave `ANTHROPIC_CRED` / `VOYAGE_API_KEY` empty — not used in local mode.)

---

## 4. Frontend env — `vibe/frontend/.env`

```ini
VITE_BASE_URL="http://localhost:8080/api"   # note the /api prefix
```

---

## 5. Wire the UI (the one bit left to you)

Mount the contribute button where you have the segment context (learning/quiz page):
```tsx
import ContributeQuestionButton from '@/components/ContributeQuestionButton';

<ContributeQuestionButton
  courseId={courseId}
  courseVersionId={courseVersionId}
  segmentId={segmentId}
/>
```
And add a teacher route pointing at `CrowdReviewQueue` (the review screen).

---

## 6. Run (4 terminals)

```bash
# 1) MongoDB (skip if using Atlas / already running)
docker start vibe-mongo

# 2) Firebase auth emulator
firebase emulators:start --only auth --project demo-test

# 3) Backend
cd vibe/backend && pnpm install && pnpm start    # http://localhost:8080

# 4) Frontend
cd vibe/frontend && pnpm install && pnpm dev      # http://localhost:5173
```
(Ollama is already serving on :11434.)

---

## 7. Smoke test

As a logged-in student on a lesson segment, open the Contribute modal and try:
1. **A good MCQ** → "Checking your question…" → **accepted** (lands in the teacher queue).
2. **Spam / gibberish** → **rejected** on the spot with an encouraging message.
3. **A question with the wrong option marked correct** → **needs-fix** + a suggestion; edit & resubmit → accepted.
4. **A near-duplicate** of an accepted one → flagged as a duplicate (in-app cosine).

As a teacher/admin, open `CrowdReviewQueue` → approve / reject.

> First Ollama call is slow (model load). Later calls are fast.

---

## Notes / knobs
- **Judge / embed provider** is just env: set `CROWD_LLM_PROVIDER=anthropic` (+ `ANTHROPIC_CRED`) and `CROWD_EMBED_PROVIDER=voyage` (+ `VOYAGE_API_KEY`) to use the hosted path instead.
- **Dedup thresholds:** `CROWD_NEAR_DUP_THRESHOLD` (0.92), `CROWD_HARD_DUP_THRESHOLD` (0.985).
- **Rate limit:** `CROWD_RATE_MAX_PER_SEGMENT` (5) per `CROWD_RATE_WINDOW_MS` (10 min).
- **Teacher auth** is currently admin-only (`_assertReviewer`) — a Phase-1 placeholder; extend to course instructors when ready.
