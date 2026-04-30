/**
 * useTheme — Dark/light mode toggle
 *
 * Two modes: light / dark. No "system" state — just a toggle.
 * On first visit (no stored preference), respects OS preference; defaults to dark.
 * Persists choice in localStorage under "railly-theme".
 * Applies/removes "dark" class on <html> element.
 * Prevents flash of wrong theme on load via dark-background default + inline script in index.html.
 */

import { useState, useEffect, useCallback } from "react";

type Theme = "light" | "dark";

const STORAGE_KEY = "railly-theme";

function applyTheme(theme: Theme) {
  const isDark = theme === "dark";
  document.documentElement.classList.toggle("dark", isDark);
  document.documentElement.style.colorScheme = isDark ? "dark" : "light";
  // Keep html background in sync with theme to prevent flash at edges.
  // Dark: remove inline style, let CSS `html { background-color: #0f172a }` apply.
  // Light: set inline style to override the dark CSS default.
  if (isDark) {
    document.documentElement.style.removeProperty("background-color");
  } else {
    document.documentElement.style.backgroundColor = "#f8fafc";
  }
}

/**
 * Resolve the default theme before React hydrates — used on mount only.
 * Order: stored preference → OS preference → "dark" fallback.
 */
function resolveDefaultTheme(): Theme {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "light" || stored === "dark") return stored;
  // No stored preference: respect OS preference, default to dark
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(resolveDefaultTheme);

  // Apply theme on mount and when it changes
  useEffect(() => {
    applyTheme(theme);
    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  // Listen for OS preference changes and auto-switch
  useEffect(() => {
    const darkMediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const lightMediaQuery = window.matchMedia("(prefers-color-scheme: light)");
    const handler = () => {
      setThemeState((prev) => {
        const stored = localStorage.getItem(STORAGE_KEY);
        // If user has explicitly chosen a theme, don't override
        if (stored === "light" || stored === "dark") return prev;
        // Otherwise, follow OS preference
        return lightMediaQuery.matches ? "light" : "dark";
      });
    };
    darkMediaQuery.addEventListener("change", handler);
    lightMediaQuery.addEventListener("change", handler);
    return () => {
      darkMediaQuery.removeEventListener("change", handler);
      lightMediaQuery.removeEventListener("change", handler);
    };
  }, []);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => (prev === "dark" ? "light" : "dark"));
  }, []);

  return { theme, setTheme, toggleTheme };
}