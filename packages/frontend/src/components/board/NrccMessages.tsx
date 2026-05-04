/**
 * NrccMessages — Disruption alert banners from Darwin Push Port (OW)
 *
 * Displays station messages with severity-based colour coding:
 *   0 = Normal (info style)
 *   1 = Minor (amber/delay style)
 *   2 = Major (red/cancel style)
 *   3 = Severe (red+bold)
 */

import type { StationMessage } from "@railly-app/shared";

interface NrccMessagesProps {
  messages: StationMessage[];
}

/** Map severity to CSS classes using design tokens */
const severityStyles: Record<number, string> = {
  0: "bg-alert-info-bg text-alert-info-text border-alert-info-border",       // Normal — info style
  1: "bg-alert-delay-bg text-alert-delay-text border-alert-delay-border", // Minor — amber/delay style
  2: "bg-alert-cancel-bg text-alert-cancel-text border-alert-cancel-border", // Major — red/cancel style
  3: "bg-alert-cancel-bg text-alert-cancel-text border-alert-cancel-border font-bold", // Severe — red+bold
};

/** Map category to display label */
const categoryLabels: Record<string, string> = {
  Train: "🚂 Train",
  Station: "🏛��� Station",
  Connections: "🔗 Connections",
  System: "⚙️ System",
  Misc: "ℹ️ Misc",
  PriorTrains: "⏮️ Prior Trains",
  PriorOther: "⏮️ Prior",
};

export function NrccMessages({ messages }: NrccMessagesProps) {
  if (messages.length === 0) return null;

  return (
    <div className="px-4 py-2">
      {messages.map((msg) => {
        const style = severityStyles[msg.severity] ?? severityStyles[0];
        const label = msg.category ? categoryLabels[msg.category] ?? msg.category : null;
        return (
          <div
            key={msg.id}
            className={`text-xs px-3 py-1.5 rounded mb-1 border ${style}`}
          >
            {label && <span className="font-semibold mr-1">{label}:</span>}
            {msg.message}
          </div>
        );
      })}
    </div>
  );
}