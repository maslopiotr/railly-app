/**
 * NrccMessages — Disruption alert banners from National Rail
 */

import type { NRCCMessage } from "@railly-app/shared";

interface NrccMessagesProps {
  messages: NRCCMessage[];
}

export function NrccMessages({ messages }: NrccMessagesProps) {
  if (messages.length === 0) return null;

  return (
    <div className="px-4 py-2">
      {messages.map((msg, i) => (
        <div
          key={i}
          className="text-xs px-3 py-1.5 rounded mb-1 bg-alert-delay-bg text-alert-delay-text border border-alert-delay-border"
        >
          {msg.Value}
        </div>
      ))}
    </div>
  );
}