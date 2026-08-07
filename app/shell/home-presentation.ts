export type ProcessKind = "event" | "workflow";

const CYRILLIC_TRANSLITERATION: Readonly<Record<string, string>> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

export const PROCESS_ICON_GLYPHS: Readonly<Record<string, string>> = {
  event: "▶",
  workflow: "⌘",
  database: "▤",
  backup: "▣",
  server: "▥",
  user: "♙",
  group: "♣",
  security: "◇",
  network: "⌁",
  settings: "⚙",
  storage: "▦",
  deploy: "↥",
  report: "≣",
};

export function buildAutomationSlug(value: string): string {
  const normalizedInput = value.trim().toLowerCase();
  const transliterated = Array.from(normalizedInput)
    .map((letter) => CYRILLIC_TRANSLITERATION[letter] ?? letter)
    .join("");

  const slug = transliterated
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  if (slug) return slug;

  let hash = 2166136261;
  for (const letter of value) {
    hash ^= letter.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }

  return `section-${(hash >>> 0).toString(36)}`;
}

export function resolveProcessIconGlyph(icon: string | undefined, kind: ProcessKind): string {
  if (!icon) return PROCESS_ICON_GLYPHS[kind];
  return PROCESS_ICON_GLYPHS[icon] ?? icon.slice(0, 2).toUpperCase();
}
