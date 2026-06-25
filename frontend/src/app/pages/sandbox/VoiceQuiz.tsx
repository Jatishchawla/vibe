/**
 * Interactive Voice Quiz — demo (ISOLATED SANDBOX).
 *
 *   1. A static MERN question is read aloud (pre-generated Speechify audio at
 *      /tts/question.mp3) and revealed WORD-BY-WORD in sync with the narration.
 *   2. The student answers BY VOICE (max 50 words, no typing). The recorded
 *      audio is transcribed by Groq Whisper-large-v3-turbo via a tiny local
 *      proxy (the key stays server-side) — accurate and ~1s fast.
 *
 * Standalone: no auth guard, no production code touched. Reached at
 * /sandbox/voice-quiz. Needs the stt-proxy running on :8089 for transcription.
 */
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Loader2, Mic, RotateCcw, Sparkles, Square, Volume2 } from "lucide-react";

// Keep this text EXACTLY in sync with the pre-generated audio file.
const QUESTION = `Based on the video, is the statement, "Experience is data, just without Excel," true?`;
const AUDIO_SRC = "/tts/question.mp3";

// Spoken answers are capped — concise, voice only.
const MAX_WORDS = 50;
const MAX_RECORD_SECONDS = 10; // short, focused answer; auto-stops
const CHUNK_MS = 1000; // emit/transcribe roughly every second for a live feel

// Local STT proxy (Groq Whisper). Override via Vite env.
const STT_SERVICE =
  (import.meta as any).env?.VITE_STT_SERVICE_URL || "http://localhost:8089";

function pickMimeType(): string | undefined {
  const types = ["audio/webm", "audio/mp4", "audio/ogg", "audio/wav"];
  return types.find((t) => MediaRecorder.isTypeSupported(t));
}

// Light context prompt for this question's domain. Kept neutral on purpose —
// a prompt that names jargon can make Whisper hallucinate those words into the
// answer, so we only set general topic + the one proper noun (Excel).
const STT_PROMPT =
  "The speaker gives a short spoken opinion, with reference to a video, about whether " +
  "experience is data without Excel. Likely words: experience, data, Excel, spreadsheet, video.";

// Deterministic corrections. This question has no fixed technical vocabulary, so
// the map is intentionally empty (add question-specific entries here if needed).
const TERM_FIXES: [RegExp, string][] = [];

function fixTerms(text: string): string {
  return TERM_FIXES.reduce((acc, [re, rep]) => acc.replace(re, rep), text);
}

export default function VoiceQuiz() {
  // Question narration
  const [started, setStarted] = useState(false);
  const [revealed, setRevealed] = useState(0);
  const [playing, setPlaying] = useState(false);
  const MAX_REPLAYS = 1;
  const [replaysLeft, setReplaysLeft] = useState(MAX_REPLAYS);

  // Spoken answer
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [answer, setAnswer] = useState("");
  const [sttError, setSttError] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mimeRef = useRef<string | undefined>(undefined);
  const inFlightRef = useRef(false); // one live request at a time
  const stoppedRef = useRef(false); // ignore late partials after stop

  const words = QUESTION.split(/\s+/);
  const wordCount = answer.trim() ? answer.trim().split(/\s+/).length : 0;
  const atLimit = wordCount >= MAX_WORDS;

  // ---- question narration ----------------------------------------------
  const stopAudio = () => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setPlaying(false);
  };

  const play = () => {
    stopAudio();
    setRevealed(0);
    const audio = new Audio(AUDIO_SRC);
    audioRef.current = audio;
    const tick = () => {
      const dur = audio.duration;
      if (dur && isFinite(dur)) {
        const frac = audio.currentTime / dur;
        setRevealed(Math.min(words.length, Math.floor(frac * words.length) + 1));
      }
      if (!audio.paused && !audio.ended) rafRef.current = requestAnimationFrame(tick);
    };
    audio.onplay = () => {
      setPlaying(true);
      rafRef.current = requestAnimationFrame(tick);
    };
    audio.onended = () => {
      setRevealed(words.length);
      setPlaying(false);
    };
    audio.play().catch(() => {
      setRevealed(words.length);
      setPlaying(false);
    });
  };

  const start = () => {
    setStarted(true);
    play();
  };

  const replay = () => {
    if (playing || replaysLeft <= 0) return;
    setReplaysLeft((n) => n - 1);
    play();
  };

  // ---- record + transcribe ---------------------------------------------
  // POST audio to the proxy, return the corrected + 50-word-capped transcript.
  const postAudio = async (blob: Blob): Promise<string> => {
    const form = new FormData();
    form.append("file", blob, "answer.webm");
    form.append("prompt", STT_PROMPT); // bias Whisper toward the domain vocabulary
    const resp = await fetch(`${STT_SERVICE}/stt`, { method: "POST", body: form });
    if (!resp.ok) throw new Error(`STT ${resp.status}`);
    const data = await resp.json();
    const text = fixTerms((data.text || "").trim());
    const w = text.split(/\s+/).filter(Boolean);
    return w.length > MAX_WORDS ? w.slice(0, MAX_WORDS).join(" ") : text;
  };

  // Live update: re-transcribe ALL audio recorded so far (cumulative, never
  // chunk-cut) on a ~1s cadence. One request in flight at a time; late results
  // after Stop are ignored so the final transcript wins.
  const sendPartial = async () => {
    if (inFlightRef.current || stoppedRef.current || chunksRef.current.length === 0) return;
    inFlightRef.current = true;
    try {
      const blob = new Blob(chunksRef.current, { type: mimeRef.current || "audio/webm" });
      const text = await postAudio(blob);
      if (!stoppedRef.current) setAnswer(text);
    } catch {
      /* ignore transient partial errors — the final pass reports problems */
    } finally {
      inFlightRef.current = false;
    }
  };

  // Final authoritative transcript when the user stops.
  const transcribeFinal = async (blob: Blob) => {
    setTranscribing(true);
    setSttError(null);
    try {
      setAnswer(await postAudio(blob));
    } catch {
      setSttError(
        "Couldn't transcribe. Make sure the STT proxy is running on :8089 with a Groq key in its .env.",
      );
    } finally {
      setTranscribing(false);
    }
  };

  const startRecording = async () => {
    setSttError(null);
    setSeconds(0);
    stoppedRef.current = false;
    inFlightRef.current = false;
    try {
      streamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = pickMimeType();
      mimeRef.current = mimeType;
      const recorder = new MediaRecorder(streamRef.current, mimeType ? { mimeType } : undefined);
      recorderRef.current = recorder;
      chunksRef.current = [];
      recorder.addEventListener("dataavailable", (ev) => {
        if (ev.data.size > 0) chunksRef.current.push(ev.data);
        sendPartial(); // live cumulative transcription (~1s cadence)
      });
      recorder.addEventListener("stop", () => {
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        const blob = new Blob(chunksRef.current, { type: mimeType || "audio/webm" });
        if (blob.size > 0) transcribeFinal(blob);
      });
      setAnswer("");
      recorder.start(CHUNK_MS); // emit a chunk every second
      setRecording(true);
    } catch {
      setSttError("Microphone is blocked or unavailable. Allow mic access and retry.");
    }
  };

  const stopRecording = () => {
    stoppedRef.current = true; // ignore any in-flight partials; final wins
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.stop();
    }
    setRecording(false);
  };

  // recording timer + hard duration cap
  useEffect(() => {
    if (!recording) return;
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [recording]);

  useEffect(() => {
    if (recording && seconds >= MAX_RECORD_SECONDS) stopRecording();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording, seconds]);

  // cleanup
  useEffect(
    () => () => {
      stopAudio();
      if (recorderRef.current?.state === "recording") {
        try {
          recorderRef.current.stop();
        } catch {
          /* no-op */
        }
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
    },
    [],
  );

  // ---- Start screen ----------------------------------------------------
  if (!started) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-indigo-50 via-slate-50 to-slate-100 dark:from-slate-950 dark:via-slate-950 dark:to-slate-900 flex items-center justify-center p-6">
        <div className="w-full max-w-lg rounded-3xl bg-white dark:bg-slate-800 shadow-2xl p-10 text-center space-y-6">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-500/10">
            <Sparkles className="h-7 w-7 text-indigo-500" />
          </div>
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-widest text-indigo-500">
              Interactive Quiz
            </p>
            <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-100">
              Listen, then think it through
            </h1>
            <p className="text-slate-500 dark:text-slate-400">
              Your question is read aloud and appears word by word. Then answer out loud — in 50 words
              or fewer.
            </p>
          </div>
          <Button onClick={start} className="gap-2 px-10 py-6 text-base">
            <Sparkles className="h-5 w-5" />
            Start quiz
          </Button>
        </div>
      </div>
    );
  }

  // ---- Quiz screen -----------------------------------------------------
  return (
    <div className="min-h-screen bg-gradient-to-b from-indigo-50 via-slate-50 to-slate-100 dark:from-slate-950 dark:via-slate-950 dark:to-slate-900 flex items-center justify-center p-6">
      <div className="w-full max-w-2xl rounded-3xl bg-white dark:bg-slate-800 shadow-2xl p-10 space-y-8">
        <header className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-widest text-indigo-500">
            Question 1
          </p>
          <span
            className={`flex items-center gap-2 text-xs transition-opacity ${
              playing ? "text-indigo-500 opacity-100" : "opacity-0"
            }`}
          >
            <Volume2 className="h-4 w-4 animate-pulse" />
            Reading aloud…
          </span>
        </header>

        {/* Word-by-word question */}
        <div className="min-h-[8rem] flex items-center">
          <p className="text-2xl leading-relaxed font-medium">
            {words.map((w, i) => (
              <span
                key={i}
                className={i < revealed ? "text-slate-900 dark:text-slate-50" : "text-transparent"}
              >
                {w}{" "}
              </span>
            ))}
          </p>
        </div>

        <div className="flex items-center gap-3 pt-2 border-t border-slate-100 dark:border-slate-700">
          <Button
            type="button"
            variant="outline"
            onClick={replay}
            disabled={playing || replaysLeft === 0}
            className="gap-2"
          >
            <RotateCcw className="h-4 w-4" />
            Replay
          </Button>
          <span className="text-xs text-slate-400">
            {replaysLeft > 0
              ? `${replaysLeft} replay${replaysLeft === 1 ? "" : "s"} left`
              : "No replays left"}
          </span>
        </div>

        {/* Spoken answer — voice only, no typing, capped at MAX_WORDS */}
        <div className="space-y-3 pt-2 border-t border-slate-100 dark:border-slate-700">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">
              Your spoken answer
            </p>
            <span
              className={`text-xs font-medium tabular-nums ${
                atLimit ? "text-emerald-600" : "text-slate-400"
              }`}
            >
              {wordCount} / {MAX_WORDS} words
            </span>
          </div>

          <div
            aria-live="polite"
            className="min-h-[5rem] rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 p-4 text-slate-800 dark:text-slate-100 select-none"
          >
            {answer ? (
              answer
            ) : transcribing ? (
              <span className="flex items-center gap-2 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                Transcribing your answer…
              </span>
            ) : recording ? (
              <span className="text-slate-400 italic">Listening… your words appear here live.</span>
            ) : (
              <span className="text-slate-400 italic">
                Press “Record answer” and speak — your words appear live (no typing).
              </span>
            )}
          </div>

          <div className="flex items-center gap-3">
            {!recording ? (
              <Button
                type="button"
                onClick={startRecording}
                disabled={playing || transcribing}
                className="gap-2"
              >
                <Mic className="h-4 w-4" />
                {answer ? "Re-record" : "Record answer"}
              </Button>
            ) : (
              <Button
                type="button"
                onClick={stopRecording}
                className="gap-2 bg-red-500 hover:bg-red-600"
              >
                <Square className="h-4 w-4" />
                Stop ({seconds}s)
              </Button>
            )}
            {recording && (
              <span className="flex items-center gap-1.5 text-xs text-red-500">
                <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
                Recording… (max {MAX_RECORD_SECONDS}s)
              </span>
            )}
          </div>

          {sttError && <p className="text-sm text-red-500">{sttError}</p>}
        </div>
      </div>
    </div>
  );
}
