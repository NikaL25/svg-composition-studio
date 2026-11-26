export type DetailLevel = "L" | "S";
export type ComponentRole = "background" | "composition_object";
export type SvgViewBox = [number, number, number, number];

/**
 * Semantic color roles matching the source vector library:
 * - Background roles (`bgStroke`, `bgFill`, `bgMid`) are monochrome and may be used
 *   both in background objects and inside main objects.
 * - Main accent roles (`accentPrimary`, `accentSecondary`, `accentSoft`) are strictly
 *   reserved for main (`composition_object`) objects and forbidden in background objects.
 * - Neutral roles (`ink`, `surface`) protect crisp outlines and white surfaces in main objects.
 */
export type ColorRole =
  | "bgStroke"
  | "bgFill"
  | "bgMid"
  | "accentPrimary"
  | "accentSecondary"
  | "accentSoft"
  | "ink"
  | "surface";

export type RoleColorMap = {
  bgStroke: string;
  bgFill: string;
  bgMid: string;
  accentPrimary: string;
  accentSecondary: string;
  accentSoft: string;
  ink?: string;
  surface?: string;
};

export type PaletteColor = {
  /** Original source color found in SVG. */
  from: string;
  /** Replacement color to apply. */
  to: string;
};

export type Palette = {
  id: string;
  name: string;
  description?: string;
  preset?: boolean;
  /** Semantic color roles for extensible theme definitions. */
  roles?: RoleColorMap;
  /** Direct source->target color map for main objects (includes allowed background tones). */
  colors: Record<string, string>;
  /** Strictly monochrome source->target color map for background objects. */
  backgroundColors?: Record<string, string>;
};

export type LibraryAsset = {
  /** Stable for library files; unique for user imports. */
  id: string;
  /** Canonical family identifier linking L/S and main/background variants. */
  familyId: string;
  name: string;
  description: string;
  category: string;
  keywords: string[];
  /** Reference to one of the 20 source illustrations (e.g. "L-02 · Книга"). */
  sourceIllustration: string;
  role: ComponentRole;
  detailLevel: DetailLevel;
  allowedColorRoles: ColorRole[];
  source: "library" | "imported";
  /** Relative source path, retaining the original folder hierarchy. */
  sourcePath: string;
  /** Original unmodified SVG markup. */
  svg: string;
  width: number;
  height: number;
  viewBox: SvgViewBox;
};

export type CanvasFormat = {
  id: "square" | "portrait" | "landscape";
  label: string;
  width: number;
  height: number;
};

export type SceneItem = {
  id: string;
  assetId: string;
  x: number;
  y: number;
  /** Uniform scale: X and Y proportions are always preserved. */
  scale: number;
  rotation: number;
  opacity: number;
  visible: boolean;
  /**
   * Optional role override when switching main <-> background for an object
   * whose counterpart SVG file does not exist in the library (e.g. L Wallet background).
   */
  roleOverride?: ComponentRole;
};

/** AI provider configuration (values come from env). */
export type AiProviderConfig = {
  id: string;
  baseUrl: string;
  apiKey?: string;
  model: string;
  timeoutMs: number;
  maxRetries: number;
};

/** Result of AI composition generation (strictly references existing library asset IDs). */
export type AiCompositionResult = {
  items: Array<{
    assetId: string;
    role?: ComponentRole;
    reason?: string;
  }>;
  reasoning: string;
};

/** Error from AI provider. */
export type AiProviderError = {
  code: "timeout" | "rate_limit" | "invalid_key" | "network" | "unknown";
  message: string;
  retryable: boolean;
};

/** Abstract AI provider interface. */
export interface AiProvider {
  id: string;
  generateComposition(
    prompt: string,
    assets: LibraryAsset[],
    config?: AiProviderConfig,
  ): Promise<AiCompositionResult>;
  isAvailable(): Promise<boolean>;
}

/** Layout preset style for balanced composition generation. */
export type CompositionStyle = "balanced" | "focal" | "diagonal" | "arc";
