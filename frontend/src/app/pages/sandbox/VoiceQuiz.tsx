/**
 * Interactive Voice Quiz — demo (ISOLATED SANDBOX).
 *
 * A single static question that is read aloud (pre-generated Speechify audio at
 * /tts/question.mp3) and revealed WORD-BY-WORD in sync with the narration.
 *
 * Fully standalone: no auth guard, no backend at runtime, no API key in the
 * client (the audio was generated once, server-side). Reached at /sandbox/voice-quiz.
 */
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { RotateCcw, Sparkles, Volume2 } from "lucide-react";

// Keep this text EXACTLY in sync with the pre-generated audio file.
const QUESTION =
  "In a MERN stack application, explain how a request flows from the React front-end through Express and Mongoose to MongoDB, and how the response makes its way back to the user.";
const AUDIO_SRC = "/tts/question.mp3";

export default function VoiceQuiz() {
  const [started, setStarted] = useState(false);
  const [revealed, setRevealed] = useState(0);
  const [playing, setPlaying] = useState(false);
  // The narration plays once on start; the learner gets a single replay.
  const MAX_REPLAYS = 1;
  const [replaysLeft, setReplaysLeft] = useState(MAX_REPLAYS);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const rafRef = useRef<number | null>(null);

  const words = QUESTION.split(/\s+/);

  const stop = () => {
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

  // Play the narration and reveal words proportionally to playback position
  // (slightly ahead, so the text leads the voice rather than lagging it).
  const play = () => {
    stop();
    setRevealed(0);
    const audio = new Audio(AUDIO_SRC);
    audioRef.current = audio;

    const tick = () => {
      const dur = audio.duration;
      if (dur && isFinite(dur)) {
        const frac = audio.currentTime / dur;
        setRevealed(Math.min(words.length, Math.floor(frac * words.length) + 1));
      }
      if (!audio.paused && !audio.ended) {
        rafRef.current = requestAnimationFrame(tick);
      }
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
      // Autoplay blocked or file missing — reveal text so the demo still reads.
      setRevealed(words.length);
      setPlaying(false);
    });
  };

  useEffect(() => () => stop(), []);

  const start = () => {
    setStarted(true);
    play();
  };

  // One replay only — guard against repeat clicks once the budget is spent.
  const replay = () => {
    if (playing || replaysLeft <= 0) return;
    setReplaysLeft((n) => n - 1);
    play();
  };

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
              Your question will be read aloud and appear word by word. Press start when
              you're ready.
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
                className={
                  i < revealed
                    ? "text-slate-900 dark:text-slate-50"
                    : "text-transparent"
                }
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
      </div>
    </div>
  );
}
