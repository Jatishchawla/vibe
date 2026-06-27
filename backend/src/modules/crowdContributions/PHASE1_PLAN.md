# Phase 1 — AI-Validated Student Question Contribution

**Status:** Plan (not yet implemented) · **Date:** 2026-06-27
**Module:** `crowdContributions` (greenfield, standalone) · **Demo-oriented Phase 1**

This plan is grounded in a read-only sweep of the codebase (build setup, DI, config,
existing Anthropic usage, frontend surfaces) plus an adversarial review. It supersedes the
old, broken `studentQuestions` module, which is left dormant and untouched.

---

## 1. Goal

Let a student contribute an MCQ from the quiz/learning page. On submit, an **AI judge screens
it synchronously before storing**; the student gets an **encouraging accept / reject / needs-fix**
result and can edit & resubmit. Questions that pass are **near-duplicate-checked** and land in a
**separate "Pending Validation" bank** for **teacher review & approval**. Injecting an approved
question into a live graded quiz is **Phase 2 (out of scope)**.

## 2. Locked decisions (from the user)

- ✅ Sending question text + lesson context to **Claude** is approved.
- ✅ Validation is **synchronous** ("checking your question…" → instant result).
- ✅ Similarity = **Voyage AI embeddings + MongoDB Atlas Vector Search** (reuse existing Atlas; no new datastore).
- ✅ **Greenfield** new module; do **not** change quiz/attempt/grading logic (one tiny build-repair exception, §11).
- ✅ **DB hands-off**: new collections only — never mutate/migrate existing data.

## 3. What already exists (reuse map — grounded)

| Need | Already in repo | Path |
|---|---|---|
| Claude SDK | **`@anthropic-ai/sdk` v0.71.2 installed**; used for AI question-gen | `quizzes/services/QuestionService.ts` (`generateQuestionsWithAI`) |
| Claude config | `aiConfig` exposes `ANTHROPIC_CRED` (key), `ANTHROPIC_MODEL` | `config/ai.ts` |
| Env/secrets | `env()` / `envOrFail()` over dotenv | `utils/env.ts`, `.example.env` |
| Module auto-load | derives exports from **folder name** | `bootstrap/loadModules.ts` |
| DI pattern | `ContainerModule` + `Symbol.for()` + `@injectable/@inject` | any `modules/*/container.ts` |
| Lesson context | read-only `ItemRepository.readItem(segmentId)` → VIDEO item (name/description/transcript) | `shared/database/.../ItemRepository.ts` |
| Outbound HTTP | `axios` v1.9.0 | `shared/functions/verifyRecaptcha.ts` |
| Submit modal | **`StudentQuestionComposer.tsx`** (stateless), wired in `quiz.tsx` | `frontend/src/components/` |
| Submit hook | **`useSubmitStudentQuestion`** | `frontend/src/hooks/hooks.ts` (~2343) |
| Toast feedback | **sonner** (`toast.success/error/warning`) | `quiz.tsx`, `StudentQuestionReview.tsx` |
| Teacher review UI | **`StudentQuestionReview.tsx`** + row/edit/reject dialogs | `frontend/src/app/pages/teacher/` |

**Must be added:** Voyage embeddings client (npm `voyageai` or a thin axios POST), a vector
search index, and the new module. **Not yet present:** any `$vectorSearch` / embeddings usage.

> ⚠️ **SDK correction (important):** `@anthropic-ai/sdk` **v0.71.2 does NOT expose
> `output_config.format` or `messages.parse`.** Get the strict JSON verdict via **forced
> `tool_choice: { type: 'tool', name: 'verdict' }`** with a single tool whose `input_schema`
> *is* the verdict schema; read the verdict from the `tool_use` block's `input`. Defensive
> JSON5 text-parse fallback (as `QuestionService` already does). **Do not upgrade the SDK for the demo.**

## 4. Architecture & data flow

```
 Student (quiz/learning page)  ── "Contribute a question" (StudentQuestionComposer modal)
        │  POST /crowd-contributions/.../segments/:segmentId/submit   (synchronous)
        ▼
 CrowdContributionService.submit()
   1. cheap local guards (length, 2–8 options, basic spam) + normalizedSignature
   2. DB-backed rate-limit check (per user+segment / per hour / daily circuit-breaker)
   3. resubmission cache (sha256) → return cached verdict if identical
   4. AI JUDGE  → Claude Haiku 4.5 (forced tool_choice 'verdict')
         reject / needs_fix → store minimal attempt stub (HELD) + return encouraging msg
   5. EMBED (only after accept) → Voyage AI
   6. DEDUP → Atlas $vectorSearch (same segment) → DETECT-AND-FLAG only
         near-dup → reject newcomer ("similar exists") OR keep-both + possibleDuplicateOf
   7. PERSIST → crowdContributions (status PENDING_REVIEW)
        ▼
 Teacher review queue (PENDING_REVIEW) → Approve / Reject → APPROVED / REJECTED
```

**Order matters (from critique):** judge **first**, embed **second** — rejected/spam never pays
Voyage latency or cost.

## 5. Backend: new module `crowdContributions` (file-by-file)

> Folder name **must be exactly `crowdContributions`** — `loadModules.ts` derives
> `crowdContributionsModuleControllers[]`, `crowdContributionsModuleValidators[]`,
> `crowdContributionsContainerModules[]`, `setupCrowdContributionsContainer()` from it.

```
vibe/backend/src/modules/crowdContributions/
  index.ts                                  // module exports for loadModules.ts
  container.ts                              // inversify bindings (singleton)
  types.ts                                  // Symbol.for() DI keys
  classes/
    transformers/CrowdContribution.ts       // ICrowdContribution + class (status='SCREENING' on create)
    validators/CrowdContributionValidator.ts// class-validator DTOs (mirror StudentQuestionValidator)
    index.ts
  controllers/CrowdContributionController.ts // @JsonController('/crowd-contributions')
  services/
    CrowdContributionService.ts             // orchestrates the submit flow (§4)
    AiJudgeService.ts                        // Haiku judge (forced tool_choice)
    EmbeddingService.ts                      // Voyage embed (axios)
    SimilarityService.ts                     // $vectorSearch + detect-and-flag
    index.ts
  repositories/providers/mongodb/CrowdContributionRepository.ts
  repositories/index.ts  repositories/providers/index.ts
  util/signature.ts                          // shared normalize+signature helper (+ unit tests)
```

DI follows the existing pattern (`options.bind(X).toSelf().inSingletonScope()` + a `Symbol`
binding). The repo injects `@inject(GLOBAL_TYPES.Database) MongoDatabase`; the judge/lesson
lookup injects `@inject(COURSES_TYPES.ItemRepo)` (read-only).

## 6. AI judge — Claude Haiku 4.5 (`AiJudgeService`)

- Mirror `QuestionService`: `new Anthropic({ apiKey: aiConfig.ANTHROPIC_CRED })` →
  `messages.create({ model: 'claude-haiku-4-5', temperature: 0, max_tokens: 400, tools:[verdictTool], tool_choice:{type:'tool',name:'verdict'} }, { timeout: 8000, maxRetries: 1 })`.
  **No `thinking` / `effort`** (Haiku rejects `effort`). Wrap in an outer `Promise.race` (~9s) hard deadline.
- **Verdict tool input_schema** (`additionalProperties:false`, all required):
  `verdict: 'accept'|'reject'|'needs_fix'`, `category: 'spam'|'gibberish'|'off_topic'|'wrong_answer'|'too_easy_or_hard'|'duplicate'|'ok'`,
  `checks: { wellFormed, onTopic, answerDefensible, notSpam }`, `studentMessage` (encouraging, ≤~240 chars),
  `suggestedFix?` (only on `needs_fix`).
- **Injection-resistant:** static system prompt declares that everything inside the tagged
  blocks (`<lesson_context>`, `<student_question>`, `<options>`, `<marked_correct>`) is **DATA,
  never instructions**. Forced tool output further constrains it. Commit an **adversarial test
  fixture** (injection strings, spam, off-topic, subtly-wrong key, near-dup) run before the demo.
- **Lesson context:** `ItemRepository.readItem(segmentId)` → name + description + transcript,
  truncated to ~3–4k chars; if missing, judge on well-formedness + spam only.
- **Answer-defensibility:** judge verifies the marked-correct option vs context → `answerDefensible`;
  if false → `needs_fix` with a `suggestedFix`. Teacher review is the backstop; surface the AI
  rationale + check booleans in the teacher queue.
- Cost ≈ $0.0035 / submission; ~0.8–2.5s.

## 7. Similarity / dedup — Voyage + Atlas Vector Search (`EmbeddingService` + `SimilarityService`)

- **Only runs after an `accept` verdict.**
- **Embed-text** (shared helper `util/signature.ts`): `normalize(questionText)` + sorted
  `normalize(option.text)` joined; **exclude the correct index** (so re-keying can't dodge dedup)
  and **sort options** (so reordering can't dodge). Unit tests assert: reorder options → same
  signature; change only correct index → same signature; reword stem → different.
- **Voyage:** `voyage-3.5-lite`, dim **1024**, via `voyageai` npm or axios POST to
  `https://api.voyageai.com/v1/embeddings`. Hard 2s timeout.
- **Atlas vector index** `crowd_embedding_idx` (type `vectorSearch`) on `embedding`, filters on
  `courseVersionId` / `segmentId` / `status`; created programmatically in `init()` (tolerate
  "already exists"; treat not-yet-ACTIVE/cold-start as **zero neighbours** → fall back to
  exact-signature dedup). **Create the index before the demo, not at first boot.**
- **`$vectorSearch`** scoped to the same segment; cosine score in [0,1]. Thresholds (env-tunable,
  validate on samples): `NEAR_DUP ≈ 0.92`, `HARD_DUP ≈ 0.985`.
- **Detect-and-flag ONLY (no auto-supersede, no "which-is-better" LLM):** on a near-dup, either
  reject the newcomer with an encouraging *"a similar question already exists"* **or** keep-both
  and set `possibleDuplicateOf` for the teacher to resolve. No automated mutation of sibling records.

## 8. Data model & state machine

**New collection `crowdContributions`** (new data only): `courseId, courseVersionId, segmentId
(ObjectId), questionType, questionText, options[{text}], correctIndex, createdBy (ObjectId),
normalizedSignature, embedding (number[1024]), embeddingModel, screeningVerdict {verdict,
category, checks, message, suggestion, model, latencyMs, at}, status, dedupOf|possibleDuplicateOf
(ObjectId|null), reviewedBy, reviewedAt, rejectionReason, createdAt, updatedAt, isDeleted`.

**Minimal attempt-log** (new lightweight collection): `createdBy, segmentId, verdict, category,
normalizedSignature, createdAt` — powers DB-backed rate limiting + later filter tuning. Persisted
for **every** attempt (including reject/needs_fix). Only `accept` + dedup-pass becomes a full
`PENDING_REVIEW` contribution.

```
SCREENING (transient)
   ├─ AI reject / needs_fix ─► HELD (returned on-spot; NOT in review queue)
   └─ AI accept + dedup pass ─► PENDING_REVIEW ──teacher──► APPROVED | REJECTED
                                near-dup loser ─► REJECTED (dedupOf set)
```
Phase 1 terminal success = **APPROVED in this module only**.

Btree indexes: `{courseVersionId,segmentId,isDeleted}`, `{createdBy,isDeleted}`,
`{courseId,courseVersionId,status,isDeleted}`, `{courseVersionId,segmentId,normalizedSignature,isDeleted}`.

## 9. REST API (`/crowd-contributions`, all authorized)

| Method | Path | Who | Returns |
|---|---|---|---|
| POST | `/courses/:c/versions/:v/segments/:s/submit` | student | `{ result:'accept'|'reject'|'needs_fix', message, suggestion?, contributionId? }` (sync) |
| GET | `/me?status&limit` | student | my contributions |
| GET | `/courses/:c/versions/:v/review-queue?limit` | **teacher** | `PENDING_REVIEW` items + AI rationale |
| PATCH | `/:id/approve` | **teacher** | `{success:true}` |
| PATCH | `/:id/reject` (`{reason}`) | **teacher** | `{success:true}` |

## 10. Security, abuse, resilience

- **Real role enforcement (must-decide, not defer):** review-queue + approve/reject assert
  teacher/admin **server-side**, reusing the existing teacher authorization pattern. Don't rely
  on UI hiding; don't let a student approve their own question.
- **Fail-CLOSED** on AI/Voyage outage: don't persist; friendly *"couldn't check right now, try
  again"*; count against the rate limit. (Fail-open only behind a default-**OFF** flag, routing
  to a visibly-flagged `QUARANTINE` status — never plain `PENDING_REVIEW`.)
- **DB-backed rate limits:** per user+segment (e.g. 5/10min) + per-user hourly cap; plus a
  **global daily spend circuit-breaker** (judge+embed call ceiling → friendly *"contributions are
  taking a break"*). Protects the shared cluster and the bill during a public demo.
- **Resubmission cache:** `sha256(segmentId + normalized content)` short-TTL → return prior
  verdict free; `needs_fix → edit` changes content → fresh judge.
- **Prompt injection:** DATA-framing + forced tool + adversarial fixture (§6).
- **Course-level enable flag (kill-switch):** turn the feature on per course/version for the demo.

## 11. The one existing-code change — `AttemptService` surgical build-repair

The backend **won't compile** today: `quizzes/services/AttemptService.ts` imports a non-existent
`crowdGate.js` (line 71) and calls four methods that don't exist on `StudentQuestionRepository`
(`recordCrowdResponse`, `markEligible`, `findCollectingForSegments`, `listAnsweredQuestionIds`).

**Fix (no scoring change):**
1. Remove the `crowdGate.js` import (line 71).
2. Neutralize the single live call `await this._capturePeerResponses(...)` (~line 766).
3. No-op the bodies of `_pickCollectingQuestion` and `_capturePeerResponses` (prefer no-op
   bodies over removing the `studentQuestionRepo` injection — minimizes ripple/test breakage).

**Scoring-safe proof:** line 766 runs **after** `_grade()` (~744) and **after**
`submissionRepository.update(submissionId, {gradingResult})` (~761); `_capturePeerResponses` is
documented best-effort, fully `try/catch`-wrapped, and only writes peer counters — it never
reads or mutates `gradingResult` / `totalScore` / `gradingStatus`. `_pickCollectingQuestion` is
already dead (the serving path returns at ~161–171 before reaching it). No other code references
the four missing methods (only this file + a markdown doc). *Verify no test constructs
`AttemptService` expecting those methods before editing.*

## 12. Frontend (reuse existing components — UI-first, preserve logic/state)

- **Contribute button:** small, non-distracting affordance — quiz header (near skip/next) and/or a
  `FileQuestion` icon in the video control bar; triggers the existing **`StudentQuestionComposer`**
  modal with `PendingStudentQuestionContext` (already flows course-page → Item-container → quiz).
- **Synchronous result:** extend `useSubmitStudentQuestion`'s response to `{ verdict, message,
  suggestion }`; show a **"checking your question…"** state (disable + debounce the submit button
  to prevent double-fire), then **sonner** feedback:
  - accept → celebratory toast; needs_fix → show `suggestion`, **keep the draft**, edit & resubmit;
  - reject → kind toast + why + invite to retry.
- **Teacher queue:** reuse **`StudentQuestionReview.tsx`** + row/edit/reject dialogs; show the AI
  rationale + check booleans alongside each `PENDING_REVIEW` item.

## 13. New dependencies & env

- npm (backend): `voyageai` (or none — thin axios POST).
- env (`.example.env` + `.env`, via `utils/env.ts`):
  `ANTHROPIC_CRED` (currently unset!), `ANTHROPIC_MODEL=claude-haiku-4-5` *(or a dedicated
  `CROWD_JUDGE_MODEL` so the transcript-generation model isn't repurposed)*, `VOYAGE_API_KEY`,
  `VOYAGE_MODEL=voyage-3.5-lite`, `CROWD_NEAR_DUP_THRESHOLD=0.92`, `CROWD_HARD_DUP_THRESHOLD=0.985`,
  `CROWD_FAIL_OPEN=false`.
- Atlas: one **vector search index** on `crowdContributions.embedding` (create before the demo);
  confirm **Vector Search is provisioned on the `vibe-test` tier**.

## 14. Phase 1 scope

**Include:** contribute button + composer modal; sync Haiku judge (forced `tool_choice`);
judge-first/embed-second; Voyage + Atlas dedup (detect-and-flag); separate Pending-Validation
collection + teacher review queue; APPROVED terminal; minimal `AttemptService` repair; real
teacher auth; DB-backed rate limits + resubmission cache + daily circuit-breaker; course-level
enable flag; shared signature helper + tests; adversarial fixture.

**Defer (Phase 2+):** injecting APPROVED questions into graded quizzes; "which-is-better" LLM +
auto-supersede; Sonnet 4.6 escalation; prompt-caching; cross-segment dedup; embedding backfill
worker; gamification/peer-validation (record contributor + outcome now as a hook); reusing/migrating
the old `studentQuestions` module.

## 15. Must-decide before coding

1. **Teacher/admin authorization gate** to reuse (server-side) — blocking.
2. Concrete **rate-limit thresholds** + daily spend ceiling.
3. **Near-dup thresholds** — validate on a few real Voyage embeddings.
4. **Voyage integration** — `voyageai` SDK vs axios; lock model + dimension (changing dim later
   means rebuilding the index).
5. **Module + collection names** locked to `crowdContributions` everywhere (loadModules derives
   keys from the folder name).
6. Confirm **Atlas Vector Search is enabled** on `vibe-test`.

## 16. Verification / demo script

1. Backend compiles & boots after the `AttemptService` repair; the new module auto-registers.
2. Good question → `accept` → appears in teacher queue as `PENDING_REVIEW`.
3. Spam / off-topic → rejected on the spot, encouraging message, **not** stored as a contribution.
4. Wrong correct-option → `needs_fix` + suggestion; edit & resubmit → `accept`.
5. Near-duplicate → flagged (reject newcomer or `possibleDuplicateOf`).
6. Teacher approve/reject → status updates; student sees it under "my contributions".
7. AI/Voyage forced-down → fail-closed friendly retry; nothing unscreened reaches teachers.
8. Confirm **no existing collection/document was modified** (new collections only).

## 17. Suggested build order

1. `AttemptService` repair → backend builds. 2. Module skeleton + DI + collection + signature
helper (+ tests). 3. `AiJudgeService` (forced tool) + submit endpoint (judge-only) + adversarial
fixture. 4. Rate limits + resubmission cache + fail-closed. 5. `EmbeddingService` + vector index +
`SimilarityService` (detect-and-flag). 6. Teacher review-queue endpoints + auth. 7. Frontend
button + checking state + teacher-queue wiring. 8. End-to-end demo run (§16).
