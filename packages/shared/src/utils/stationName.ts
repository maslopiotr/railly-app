/**
 * Station name normalisation utilities
 *
 * Station names from Darwin and PPTimetable often arrive in ALL CAPS
 * (e.g. "MILTON KEYNES CENTRAL", "LONDON EUSTON").
 * This utility converts them to Title Case for consistent frontend display.
 *
 * CORPUS data stores some London stations in suffix form
 * (e.g. "EUSTON LONDON" instead of "LONDON EUSTON").
 * These are reordered to the UK convention prefix form before title-casing.
 */

/** Words that should remain lowercase in station names (UK rail convention) */
const LOWERCASE_WORDS = new Set([
  "and",
  "on",
  "by",
  "in",
  "the",
  "of",
  "for",
  "upon",
  "le",
  "la",
  "der",
  "super",
]);

/** Words that should be fully uppercase (abbreviations/acronyms) */
const UPPERCASE_WORDS = new Set([
  "RSC",   // Royal Shakespeare Company
  "GMPTE", // Greater Manchester PTE
  "MCV",   // Metrolink
  "HBF",   // Hauptbahnhof (unlikely but defensive)
]);

/**
 * Normalise a station name to Title Case.
 *
 * Rules:
 * - First word always capitalised
 * - Articles/prepositions lowercase (except first word)
 * - Abbreviations stay uppercase
 * - Handles hyphenated names (e.g. "Stratford-Upon-Avon" → "Stratford-upon-Avon")
 * - Handles "/" separated names (e.g. "High Level/Low Level")
 *
 * @param name - Raw station name (may be ALL CAPS, mixed case, or already correct)
 * @returns Normalised station name
 */
export function normaliseStationName(name: string | null | undefined): string {
  if (!name) return "";

  // Trim and collapse multiple spaces
  let trimmed = name.trim().replace(/\s+/g, " ");

  // CORPUS stores some London stations in suffix form
  // (e.g. "EUSTON LONDON" instead of "LONDON EUSTON").
  // Reorder to UK convention: move trailing "LONDON" to prefix position.
  // Only reorder when "LONDON" is the last word and not already the first.
  const upperTrimmed = trimmed.toUpperCase();
  if (upperTrimmed.endsWith(" LONDON") && !upperTrimmed.startsWith("LONDON ")) {
    const prefix = trimmed.slice(0, upperTrimmed.lastIndexOf(" LONDON"));
    trimmed = "LONDON " + prefix;
  }

  // If already title case (has both upper and lower), return as-is
  // This avoids re-normalising names that are already correct
  if (/[a-z]/.test(trimmed) && /[A-Z]/.test(trimmed)) {
    return trimmed;
  }

  // Split into words and normalise each
  return trimmed
    .split(/\s+/)
    .map((word, index) => {
      // Handle "/" separated parts within a word
      if (word.includes("/")) {
        return word
          .split("/")
          .map((part, partIndex) => normaliseWord(part, index === 0 && partIndex === 0))
          .join("/");
      }

      // Handle hyphenated parts
      if (word.includes("-")) {
        return word
          .split("-")
          .map((part, partIndex) => normaliseWord(part, index === 0 && partIndex === 0))
          .join("-");
      }

      return normaliseWord(word, index === 0);
    })
    .join(" ");
}

/** Normalise a single word fragment */
function normaliseWord(word: string, isFirst: boolean): string {
  if (!word) return word;

  const upper = word.toUpperCase();

  // Known abbreviations stay uppercase
  if (UPPERCASE_WORDS.has(upper)) return upper;

  // Articles/prepositions lowercase (except first word)
  if (!isFirst && LOWERCASE_WORDS.has(upper.toLowerCase())) {
    return word.toLowerCase();
  }

  // Title Case: first letter upper, rest lower
  return upper.charAt(0) + word.slice(1).toLowerCase();
}