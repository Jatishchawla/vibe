import { Card } from "@/components/ui/card";
import { TrendingUp, CalendarClock, Flag, CheckCircle2 } from "lucide-react";
import { buildForecast, formatDate, type CourseAnalytics } from "./analytics-utils";

/**
 * Learning pace + an actionable completion forecast: projected finish date for
 * the course you're closest to done, plus a "to finish by <goal>, do N/week" nudge.
 */
export function VelocityCard({ itemsPerWeek, courses }: { itemsPerWeek: number; courses: CourseAnalytics[] }) {
  const forecast = buildForecast(courses);

  return (
    <Card className="h-full rounded-2xl border p-5">
      <h3 className="text-sm font-semibold text-foreground">Learning pace</h3>
      <p className="mb-4 text-xs text-muted-foreground">Your momentum and a finish forecast</p>

      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400">
          <TrendingUp className="h-5 w-5" />
        </span>
        <div>
          <p className="text-2xl font-bold tabular-nums text-foreground">{itemsPerWeek}</p>
          <p className="text-xs text-muted-foreground">lessons / week (active courses)</p>
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-neutral-200/70 bg-neutral-50/60 p-3 dark:border-white/[0.06] dark:bg-white/[0.03]">
        {!forecast ? (
          <p className="text-xs text-muted-foreground">
            Complete a few more lessons to unlock a finish forecast.
          </p>
        ) : (
          <div className="space-y-2.5">
            {/* Projection at current pace */}
            <div className="flex items-start gap-2.5">
              <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">At your current pace you'll finish</p>
                <p className="truncate text-sm font-semibold text-foreground" title={forecast.course.name}>
                  {forecast.course.name}
                </p>
                <p className="text-xs text-muted-foreground">
                  by <span className="font-semibold text-foreground">{formatDate(forecast.projectedDate)}</span>
                  {` · ~${forecast.projectedDays} days · ${forecast.remaining} lessons left`}
                </p>
              </div>
            </div>

            {/* Actionable target nudge */}
            <div className="rounded-lg border border-dashed border-primary/30 bg-primary/[0.04] p-2.5">
              {forecast.onTrack ? (
                <p className="flex items-center gap-2 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  You're on track to finish within {forecast.goalDays / 7} weeks — keep it up!
                </p>
              ) : (
                <p className="flex items-start gap-2 text-xs text-foreground">
                  <Flag className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <span>
                    To finish by <span className="font-semibold">{formatDate(forecast.goalDate)}</span>, do{" "}
                    <span className="font-semibold text-primary">{forecast.neededPerWeek} lessons/week</span>{" "}
                    <span className="text-muted-foreground">
                      (you're at {forecast.currentPerWeek}/wk — that's +{forecast.extraPerWeek}/week)
                    </span>
                  </span>
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
