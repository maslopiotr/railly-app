/**
 * LoadingIndicator — Shows coach crowding level from FormationData
 *
 * Displays a visual indicator of how busy a train service is,
 * using the LDBWS FormationData loading categories.
 * Uses semantic design tokens for text and background; bar colours
 * remain semantic (green/yellow/orange/red) as they are data-driven indicators.
 */

import type { FormationData } from "@railly-app/shared";

interface LoadingIndicatorProps {
  formation?: FormationData;
  compact?: boolean;
}

/** Map loading category codes to display info */
const LOADING_DISPLAY: Record<string, { label: string; emoji: string; className: string }> = {
  "1": { label: "Quiet", emoji: "🟢", className: "text-status-on-time" },
  "2": { label: "Moderate", emoji: "🟡", className: "text-status-approaching" },
  "3": { label: "Busy", emoji: "🟠", className: "text-status-delayed" },
  "4": { label: "Very Busy", emoji: "🔴", className: "text-status-cancelled" },
};

function getLoadingInfo(code?: string) {
  if (!code) return null;
  return LOADING_DISPLAY[code] ?? null;
}

/** Find the least busy coach from formation data */
function getQuietestCoach(
  formation: FormationData,
): { number: string; loading: number } | null {
  if (!formation.coaches || formation.coaches.length === 0) return null;

  let quietest: { number: string; loading: number } | null = null;
  for (const coach of formation.coaches) {
    if (coach.loading !== undefined && coach.loadingSpecified) {
      if (!quietest || coach.loading < quietest.loading) {
        quietest = { number: coach.number, loading: coach.loading };
      }
    }
  }
  return quietest;
}

export function LoadingIndicator({ formation, compact = false }: LoadingIndicatorProps) {
  if (!formation) return null;

  const category = formation.loadingCategory;
  const loadingInfo = category ? getLoadingInfo(category.code) : null;
  const quietestCoach = getQuietestCoach(formation);

  if (compact) {
    if (!loadingInfo) return null;
    return (
      <span className={`inline-flex items-center gap-1 text-xs ${loadingInfo.className}`}>
        <span>{loadingInfo.emoji}</span>
        <span>{loadingInfo.label}</span>
      </span>
    );
  }

  return (
    <div className="space-y-1.5">
      {loadingInfo && (
        <div className={`flex items-center gap-1.5 text-sm font-medium ${loadingInfo.className}`}>
          <span className="text-base">{loadingInfo.emoji}</span>
          <span>{loadingInfo.label}</span>
        </div>
      )}

      {quietestCoach && (
        <div className="text-xs text-text-secondary">
          🪑 Coach {quietestCoach.number} is quietest ({quietestCoach.loading}% full)
        </div>
      )}

      {formation.coaches && formation.coaches.length > 0 && (
        <div className="flex gap-0.5 mt-1 overflow-x-auto pb-1">
          {formation.coaches.map((coach) => {
            const loading = coach.loading ?? 0;
            const barColor =
              loading < 40
                ? "bg-status-on-time"
                : loading < 70
                  ? "bg-status-approaching"
                  : loading < 90
                    ? "bg-status-delayed"
                    : "bg-status-cancelled";

            return (
              <div
                key={coach.number}
                className="flex flex-col items-center shrink-0"
                title={`Coach ${coach.number}: ${loading}% full${coach.coachClass === "First" ? " (First Class)" : ""}${coach.toilet?.status === "InService" ? " — 🚻 Toilet available" : ""}`}
              >
                <div
                  className="w-6 sm:w-6 h-6 bg-surface-hover rounded-t overflow-hidden"
                >
                  <div
                    className={`${barColor} rounded-t w-full transition-all`}
                    style={{
                      height: `${Math.max(loading, 5)}%`,
                      marginTop: `${100 - Math.max(loading, 5)}%`,
                    }}
                  />
                </div>
                <span className="text-[10px] text-text-muted mt-0.5">
                  {coach.coachClass === "First" ? "★" : coach.number}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}