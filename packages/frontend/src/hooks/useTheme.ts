/**
 * useTheme — System-aware dark/light mode toggle
 *
 * Modes: "system" (auto-detect OS preference), "light", "dark"
 * Persists choice in localStorage under "railly-theme".
 * Applies/removes "dark" class on <html> element.
 * Prevents flash of wrong theme on load via inline script in index.html.
 */

import { useState, useEffect, useCallback } from "react";

type Theme = "system" | "light" | "dark";

const STORAGE_KEY = "railly-theme";

function getSystemPreference(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function applyTheme(theme: Theme) {
  const isDark = theme === "dark" || (theme === "system" && getSystemPreference());
  document.documentElement.classList.toggle("dark", isDark);
  document.documentElement.style.colorScheme = isDark ? "dark" : "light";
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") return stored;
    return "system";
  });

  // Apply theme on mount and when it changes
  useEffect(() => {
    applyTheme(theme);
    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  // Listen for system preference changes when in "system" mode
  useEffect(() => {
    if (theme !== "system") return;
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => applyTheme("system");
    mediaQuery.addEventListener("change", handler);
    return () => mediaQuery.removeEventListener("change", handler);
  }, [theme]);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
  }, []);

  const cycleTheme = useCallback(() => {
    setThemeState((prev) => {
      if (prev === "system") return "light";
      if (prev === "light") return "dark";
      return "system";
    });
  }, []);

  const isDark = theme === "dark" || (theme === "system" && getSystemPreference());

  return { theme, setTheme, cycleTheme, isDark };
}