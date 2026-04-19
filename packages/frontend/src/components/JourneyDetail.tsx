/**
 * JourneyDetail — Full timetable calling pattern for a train journey
 *
 * Fetches journey data from PPTimetable and displays all calling points
 * with times, platforms, and stop types.
 */

import { useEffect, useState } from "react";
import type { TimetableJourney } from "@railly-app/shared";
import { fetchJourneyDetail } from "../api/timetable";

interface JourneyDetailProps {
  rid: string;
  onClose: () => void;
}

const STOP_TYPE_LABELS: Record<string, string> = {
  OR: "Origin",
  DT: "Destination",
  IP: "Intermediate",
  PP: "Passes",
  OPOR: "Origin (operational)",
  OPIP: "Intermediate (operational)",
  OPDT: "Destination (operational)",
};

const STOP_TYPE_COLORS: Record<string, string> = {
  OR: "bg-green-500/20 text-green-400",
  DT: "bg-red-500/20 text-red-400",
  IP: "bg-blue-500/20 text-blue-400",
  PP: "bg-slate-500/20 text-slate-500",
  OPOR: "bg-slate-500/20 text-slate-400",
  OPIP: "bg-slate-500/20 text-slate-400",
  OPDT: "bg-slate-500/20 text-slate-400",
};

type JourneyState =
  | { status: "loading" }
  | { status: "loaded"; journey: TimetableJourney }
  | { status: "error"; message: string };

export function JourneyDetail({ rid, onClose }: JourneyDetailProps) {
  const [state, setState] = useState<JourneyState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    fetchJourneyDetail(rid)
      .then((data) => {
        if (!cancelled) {
          setState({ status: "loaded", journey: data.journey });
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setState({ status: "error", message: err.message });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [rid]);

  const journey = state.status === "loaded" ? state.journey : null;
  const loading = state.status === "loading";
  const error = state.status === "error" ? state.message : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700">
          <div>
            <h2 className="text-white font-semibold text-sm">
              Journey Detail
            </h2>
            {journey && (
              <p className="text-slate-400 text-xs mt-0.5">
                {journey.tocName || journey.toc || "Unknown TOC"}
                {journey.trainId && (
                  <span className="ml-2 text-slate-500">
                    {journey.trainId}
                  </span>
                )}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white transition-colors p-1"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {loading && (
            <div className="flex items-center justify-center py-12">
              <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              <span className="ml-3 text-slate-400 text-sm">Loading journey…</span>
            </div>
          )}

          {error && (
            <div className="text-center py-8">
              <p className="text-red-400 text-sm">{error}</p>
              <button
                onClick={onClose}
                className="mt-3 text-xs text-slate-400 hover:text-white"
              >
                Close
              </button>
            </div>
          )}

          {journey && !loading && (
            <div className="space-y-0">
              {/* Calling pattern */}
              <div className="relative">
                {/* Vertical line */}
                <div className="absolute left-[11px] top-3 bottom-3 w-0.5 bg-slate-600" />

                {journey.callingPoints.map((point, idx) => {
                  const isFirst = idx === 0;
                  const isLast = idx === journey.callingPoints.length - 1;
                  const isPass = point.stopType === "PP";
                  const time = point.ptd || point.pta || point.wtd || point.wta;
                  const arrivalTime = point.pta || point.wta;
                  const departureTime = point.ptd || point.wtd;

                  return (
                    <div
                      key={`${point.tpl}-${point.sequence}`}
                      className={`relative pl-8 pb-4 ${isPass ? "opacity-50" : ""}`}
                    >
                      {/* Stop dot */}
                      <div
                        className={`absolute left-[6px] top-1.5 w-[11px] h-[11px] rounded-full border-2 ${
                          isFirst || isLast
                            ? "border-blue-400 bg-blue-500/30"
                            : isPass
                              ? "border-slate-500 bg-slate-600"
                              : "border-slate-400 bg-slate-700"
                        }`}
                      />

                      {/* Stop info */}
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className={`text-sm font-medium ${isFirst || isLast ? "text-white" : "text-slate-300"}`}>
                              {point.name || point.tpl}
                            </span>
                            {point.crs && (
                              <span className="text-[10px] text-slate-500 font-mono">
                                ({point.crs})
                              </span>
                            )}
                          </div>
                          {/* Arrival & departure times */}
                          <div className="flex items-center gap-3 text-xs mt-0.5">
                            {arrivalTime && (
                              <span className="text-slate-400">
                                arr {arrivalTime}
                              </span>
                            )}
                            {departureTime && (
                              <span className="text-slate-400">
                                dep {departureTime}
                              </span>
                            )}
                            {point.plat && (
                              <span className="text-blue-400 font-medium">
                                Plat {point.plat}
                              </span>
                            )}
                          </div>
                          {/* Stop type badge */}
                          <span className={`inline-block text-[10px] px-1.5 py-0.5 rounded mt-1 ${STOP_TYPE_COLORS[point.stopType] || "bg-slate-700 text-slate-400"}`}>
                            {STOP_TYPE_LABELS[point.stopType] || point.stopType}
                          </span>
                        </div>

                        {/* Time on the right */}
                        {time && (
                          <div className="text-sm font-mono text-white shrink-0">
                            {time}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Journey metadata */}
              <div className="mt-3 pt-3 border-t border-slate-700 text-[10px] text-slate-500 font-mono">
                <div>RID: {journey.rid}</div>
                <div>UID: {journey.uid}</div>
                <div>SSD: {journey.ssd}</div>
                {journey.trainCat && <div>Category: {journey.trainCat}</div>}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}