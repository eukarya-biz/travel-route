/**
 * Configuration for the place labels drawn under the trip: which font faces
 * cover them and how a country's ISO code becomes a flag emoji.
 */

/** Family name every label layer on this page references. */
export const LABEL_FONT = "TravelLabels";

/**
 * Two `@font-face` stylesheets combined into one family, in priority order:
 * the self-hosted multi-script faces (Roboto for Latin/Cyrillic/Greek plus
 * Noto Sans script and CJK subsets), then the sliced COLRv1 Noto Color Emoji
 * subsets that carry the country flags. Face files stay lazily fetched — only
 * the subsets an on-screen label actually needs are downloaded.
 */
export const LABEL_FONT_CSS_URLS = [
  "/fonts/woff2/world-cities.css",
  "https://cdn.jsdelivr.net/npm/@infolektuell/noto-color-emoji@0.2.0/index.css",
];

/**
 * Declutter priorities. Every label is a candidate and the screen-space
 * declutter pass decides what fits, so where labels collide the trip's own
 * stops win, then countries, then cities.
 */
export const LABEL_PRIORITY = { stop: 30, country: 20, city: 10 };

/**
 * Camera heights (meters above the ellipsoid) that switch each tier on and
 * off. Decluttering only resolves labels that overlap on screen; these bands
 * are what keeps a whole tier out of the way when the scale is wrong for it —
 * country names would crowd a city flyover, city names are unreadable specks
 * from orbit.
 */
export const LABEL_ALTITUDE = {
  /** Countries fade out below this — too close for a country-wide label. */
  countryMinHeight: 250_000,
  /** Cities only appear below this. */
  cityMaxHeight: 2_500_000,
} as const;

/** Turns a two-letter ISO 3166-1 country code into its flag emoji. */
export const flagFor = (country: unknown): string => {
  if (typeof country !== "string" || country.length !== 2) return "";
  const a = country.toUpperCase().charCodeAt(0);
  const b = country.toUpperCase().charCodeAt(1);
  if (a < 65 || a > 90 || b < 65 || b > 90) return "";
  return (
    String.fromCodePoint(0x1f1e6 + (a - 65)) +
    String.fromCodePoint(0x1f1e6 + (b - 65))
  );
};

/** `🇫🇷 France` for a country feature; the bare name when the code is unknown. */
export const countryLabel = (
  properties: Record<string, unknown> | undefined,
): string => {
  const name = properties?.["name"];
  if (typeof name !== "string" || name.length === 0) return "";
  const flag = flagFor(properties?.["country"]);
  return flag ? `${flag} ${name}` : name;
};
