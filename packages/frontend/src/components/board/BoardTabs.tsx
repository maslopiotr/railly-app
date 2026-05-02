/**
 * BoardTabs — Departures / Arrivals tab bar
 */

interface BoardTabsProps {
  activeTab: "departures" | "arrivals";
  onTabChange: (tab: "departures" | "arrivals") => void;
}

export function BoardTabs({ activeTab, onTabChange }: BoardTabsProps) {
  return (
    <div className="flex border-b border-border-default px-4">
      <button
        className={`px-6 py-3 text-sm font-medium transition-colors select-none border-b-2 -mb-px focus-visible:ring-2 focus-visible:ring-blue-500 ${activeTab === "departures" ? "border-blue-600 text-text-primary" : "border-transparent text-text-secondary hover:text-text-primary"}`}
        onClick={() => onTabChange("departures")}
      >
        Departures
      </button>
      <button
        className={`px-6 py-3 text-sm font-medium transition-colors select-none border-b-2 -mb-px focus-visible:ring-2 focus-visible:ring-blue-500 ${activeTab === "arrivals" ? "border-blue-600 text-text-primary" : "border-transparent text-text-secondary hover:text-text-primary"}`}
        onClick={() => onTabChange("arrivals")}
      >
        Arrivals
      </button>
      <div className="flex-1" />
    </div>
  );
}