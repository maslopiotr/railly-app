/**
 * LoadingIndicator — Shows coach crowding level from FormationData
 *
 * Displays a visual indicator of how busy a train service is,
 * using the LDBWS FormationData loading categories.
 */

import type { FormationData } from "@railly-app/shared";

interface LoadingIndicatorProps {
  formation?: FormationData;
  compact?: boolean;
}

/** Map loading category codes to display info */
const LOADING_DISPLAY: Record<string, { label: string; emoji: string; className: string }> = {
  "1": { label: "Quiet", emoji: "🟢", className: "text-green-400" },
  "2": { label: "Moderate", emoji: "🟡", className: "text-yellow-400" },
  "3": { label: "Busy", emoji: "🟠", className: "text-orange-400" },
  "4": { label: "Very Busy", emoji: "🔴", className: "text-red-400" },
};

function getLoadingInfo(code?: string) {
  if (!code) return null;
  return LOADING_DISPLAY[code] ?? null;
}

/** Find the least busy coach from formation data */
function getQuietestCoach(formation: FormationData): { number: string; loading: number } | null {
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
    // Compact mode: just show the emoji + label
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
      {/* Overall loading category */}
      {loadingInfo && (
        <div className={`flex items-center gap-1.5 text-sm font-medium ${loadingInfo.className}`}>
          <span className="text-base">{loadingInfo.emoji}</span>
          <span>{loadingInfo.label}</span>
        </div>
      )}

      {/* Quietest coach suggestion */}
      {quietestCoach && (
        <div className="text-xs text-slate-400">
          🪑 Coach {quietestCoach.number} is quietest ({quietestCoach.loading}% full)
        </div>
      )}

      {/* Coach loading bars */}
      {formation.coaches && formation.coaches.length > 0 && (
        <div className="flex gap-0.5 mt-1">
          {formation.coaches.map((coach) => {
            const loading = coach.loading ?? 0;
            const barColor =
              loading < 40 ? "bg-green-500" :
              loading < 70 ? "bg-yellow-500" :
              loading < 90 ? "bg-orange-500" :
              "bg-red-500";

            return (
              <div
                key={coach.number}
                className="flex flex-col items-center"
                title={`Coach ${coach.number}: ${loading}% full${coach.coachClass === "First" ? " (First Class)" : ""}${coach.toilet?.status === "InService" ? " — 🚻 Toilet available" : ""}`}
              >
                <div className="w-6 bg-slate-700 rounded-t overflow-hidden" style={{ height: "24px" }}>
                  <div
                    className={`${barColor} rounded-t w-full transition-all`}
                    style={{ height: `${Math.max(loading, 5)}%`, marginTop: `${100 - Math.max(loading, 5)}%` }}
                  />
                </div>
                <span className="text-[9px] text-slate-500 mt-0.5">
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