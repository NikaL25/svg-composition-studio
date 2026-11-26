import type { ColorRole, Palette, RoleColorMap } from "./types";

/**
 * Exact canonical colors observed in the original 39 SVG library assets.
 * Every source SVG is authored in the original Lavender palette ("Лавандовая").
 */
export const SOURCE_ROLE_COLORS: Required<RoleColorMap> = {
  ink: "#181817",
  surface: "#ffffff",
  bgStroke: "#7864d7",
  bgFill: "#d7cdf5",
  bgMid: "#aa9bf0",
  accentPrimary: "#f9ecb0",
  accentSecondary: "#f9a3aa",
  accentSoft: "#ffe3e1",
};

export const MAIN_ALLOWED_ROLES: ColorRole[] = [
  "ink",
  "surface",
  "bgStroke",
  "bgFill",
  "bgMid",
  "accentPrimary",
  "accentSecondary",
  "accentSoft",
];

export const BACKGROUND_ALLOWED_ROLES: ColorRole[] = [
  "bgStroke",
  "bgFill",
  "bgMid",
];

/**
 * Builds deterministic lookup maps from semantic `RoleColorMap`, guaranteeing:
 * 1. Background colors MAY be used inside main objects.
 * 2. Main object colors (`accentPrimary`, `accentSecondary`, `accentSoft`) are NEVER used in background objects.
 * 3. Neutral ink (`#181817`) and paper white (`#ffffff`) in main objects stay protected unless explicitly changed.
 */
export function buildPaletteFromRoles(
  meta: { id: string; name: string; description?: string; preset?: boolean },
  roles: RoleColorMap,
): Palette {
  const ink = roles.ink ?? SOURCE_ROLE_COLORS.ink;
  const surface = roles.surface ?? SOURCE_ROLE_COLORS.surface;

  const colors: Record<string, string> = {
    [SOURCE_ROLE_COLORS.ink]: ink,
    [SOURCE_ROLE_COLORS.surface]: surface,
    // Background colors are allowed inside main objects:
    [SOURCE_ROLE_COLORS.bgStroke]: roles.bgStroke,
    [SOURCE_ROLE_COLORS.bgFill]: roles.bgFill,
    [SOURCE_ROLE_COLORS.bgMid]: roles.bgMid,
    // Main-only accent colors:
    [SOURCE_ROLE_COLORS.accentPrimary]: roles.accentPrimary,
    [SOURCE_ROLE_COLORS.accentSecondary]: roles.accentSecondary,
    [SOURCE_ROLE_COLORS.accentSoft]: roles.accentSoft,
  };

  // Background objects are strictly monochrome (bgStroke / bgFill / bgMid only).
  // Even if a main-colored SVG is rendered in background override mode, its ink maps
  // to `bgStroke` and all interior fills map to `bgFill` — matching the Figma library design.
  const backgroundColors: Record<string, string> = {
    [SOURCE_ROLE_COLORS.bgStroke]: roles.bgStroke,
    [SOURCE_ROLE_COLORS.bgFill]: roles.bgFill,
    [SOURCE_ROLE_COLORS.bgMid]: roles.bgMid,
    // Safe monochrome projection when switching a main-only SVG to background role:
    [SOURCE_ROLE_COLORS.ink]: roles.bgStroke,
    [SOURCE_ROLE_COLORS.surface]: roles.bgFill,
    [SOURCE_ROLE_COLORS.accentPrimary]: roles.bgFill,
    [SOURCE_ROLE_COLORS.accentSecondary]: roles.bgFill,
    [SOURCE_ROLE_COLORS.accentSoft]: roles.bgFill,
  };

  return {
    ...meta,
    roles: { ...roles, ink, surface },
    colors,
    backgroundColors,
  };
}

/**
 * Three preset extensible color schemes.
 * Adding a new scheme requires only adding an entry with `RoleColorMap` — no constructor logic changes.
 */
export const PRESET_PALETTES: Palette[] = [
  buildPaletteFromRoles(
    {
      id: "palette-lavender",
      name: "Лавандовая (Оригинал)",
      description: "Исходная палитра библиотеки: лавандовый монохром фона, сливочно-жёлтые и коралловые акценты",
      preset: true,
    },
    {
      bgStroke: "#7864D7",
      bgFill: "#D7CDF5",
      bgMid: "#AA9BF0",
      accentPrimary: "#F9ECB0",
      accentSecondary: "#F9A3AA",
      accentSoft: "#FFE3E1",
      ink: "#181817",
      surface: "#FFFFFF",
    },
  ),
  buildPaletteFromRoles(
    {
      id: "palette-sage",
      name: "Шалфей и Терракота",
      description: "Спокойный шалфейно-изумрудный монохром фона, песочно-медовые и терракотовые акценты",
      preset: true,
    },
    {
      bgStroke: "#3D7A68",
      bgFill: "#CBE4DC",
      bgMid: "#85B8A8",
      accentPrimary: "#F7D9A8",
      accentSecondary: "#E9896A",
      accentSoft: "#FBE4DC",
      ink: "#181817",
      surface: "#FFFFFF",
    },
  ),
  buildPaletteFromRoles(
    {
      id: "palette-ocean",
      name: "Океан и Янтарь",
      description: "Деловой кобальтово-голубой монохром фона, солнечный янтарь и бирюзовые акценты",
      preset: true,
    },
    {
      bgStroke: "#3B6FB6",
      bgFill: "#CFE1F7",
      bgMid: "#89B0E4",
      accentPrimary: "#FFE08A",
      accentSecondary: "#58B8B2",
      accentSoft: "#DCF4F2",
      ink: "#181817",
      surface: "#FFFFFF",
    },
  ),
];

export const DEFAULT_PALETTE_ID = PRESET_PALETTES[0].id;

export function getPresetPalette(id: string): Palette | undefined {
  return PRESET_PALETTES.find((palette) => palette.id === id);
}

export function getDefaultPalettes(): Palette[] {
  return PRESET_PALETTES.map((palette) => ({
    ...palette,
    roles: palette.roles ? { ...palette.roles } : undefined,
    colors: { ...palette.colors },
    backgroundColors: palette.backgroundColors ? { ...palette.backgroundColors } : undefined,
  }));
}

/**
 * Ensures restored/loaded palettes always include up-to-date preset palettes
 * while preserving user-created custom schemes.
 */
export function mergeWithPresetPalettes(savedPalettes: Palette[]): Palette[] {
  const presets = getDefaultPalettes();
  const presetIds = new Set(presets.map((p) => p.id));
  const legacyBrokenIds = new Set(["palette-purple", "palette-yellow", "palette-pink"]);

  const custom = savedPalettes
    .filter((p) => p && typeof p.id === "string" && !presetIds.has(p.id) && !legacyBrokenIds.has(p.id))
    .map(sanitizeCustomPalette);

  return [...presets, ...custom];
}

/**
 * Enforces the rule that main-only accent target colors are never injected into `backgroundColors`.
 */
export function sanitizeCustomPalette(palette: Palette): Palette {
  if (palette.roles) {
    const rebuilt = buildPaletteFromRoles(
      {
        id: palette.id,
        name: palette.name,
        description: palette.description,
        preset: palette.preset,
      },
      palette.roles,
    );
    return {
      ...rebuilt,
      colors: { ...rebuilt.colors, ...palette.colors },
    };
  }

  const forbiddenMainTargets = new Set(
    Object.entries(palette.colors ?? {})
      .filter(([from]) => {
        const key = from.trim().toLowerCase();
        return (
          key === SOURCE_ROLE_COLORS.accentPrimary ||
          key === SOURCE_ROLE_COLORS.accentSecondary ||
          key === SOURCE_ROLE_COLORS.accentSoft
        );
      })
      .map(([, to]) => to.trim().toLowerCase()),
  );

  const safeBg: Record<string, string> = {};
  for (const [from, to] of Object.entries(palette.backgroundColors ?? {})) {
    if (!forbiddenMainTargets.has(to.trim().toLowerCase())) {
      safeBg[from] = to;
    }
  }

  return {
    ...palette,
    backgroundColors: safeBg,
  };
}

/**
 * Checks whether a candidate background color conflicts with main-only accent colors in the same palette.
 */
export function isForbiddenMainColorInBackground(color: string, palette: Palette): boolean {
  const normalized = color.trim().toLowerCase();
  if (palette.roles) {
    const mainOnly = [
      palette.roles.accentPrimary,
      palette.roles.accentSecondary,
      palette.roles.accentSoft,
    ].map((c) => c.trim().toLowerCase());
    const bgAllowed = [
      palette.roles.bgStroke,
      palette.roles.bgFill,
      palette.roles.bgMid,
    ].map((c) => c.trim().toLowerCase());
    if (bgAllowed.includes(normalized)) return false;
    return mainOnly.includes(normalized);
  }
  return false;
}
