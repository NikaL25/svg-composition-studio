export type DetailLevel = "L" | "S";
export type ComponentRole = "background" | "composition_object";
export type SvgViewBox = [number, number, number, number];

export type Palette = {
  id: string;
  name: string;
  /** Exact source color -> replacement color. No preset colors are assumed. */
  colors: Record<string, string>;
};

export type LibraryAsset = {
  /** Stable for library files; unique for user imports. */
  id: string;
  name: string;
  role: ComponentRole;
  detailLevel: DetailLevel;
  source: "library" | "imported";
  /** Relative source path, retaining the original folder hierarchy. */
  sourcePath: string;
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
};
