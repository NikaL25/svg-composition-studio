import type { CanvasFormat, DetailLevel, LibraryAsset, Palette, SceneItem } from "./types";

export type ProjectSnapshot = {
  version: 1;
  savedAt: string;
  assets: LibraryAsset[];
  items: SceneItem[];
  palettes: Palette[];
  format?: CanvasFormat;
  detail?: DetailLevel;
  activePaletteId?: string;
};
const STORAGE_KEY = "svg-composition-studio/project-v1";

export function snapshotProject(assets: LibraryAsset[], items: SceneItem[], palettes: Palette[], format?: CanvasFormat, detail?: DetailLevel, activePaletteId?: string): ProjectSnapshot {
  return { version: 1, savedAt: new Date().toISOString(), assets, items, palettes, format, detail, activePaletteId };
}

export function saveProject(snapshot: ProjectSnapshot) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
}

export function loadProject(): ProjectSnapshot | undefined {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as Partial<ProjectSnapshot>;
    return parsed.version === 1
      && Array.isArray(parsed.assets)
      && Array.isArray(parsed.items)
      && Array.isArray(parsed.palettes)
      ? parsed as ProjectSnapshot
      : undefined;
  } catch {
    return undefined;
  }
}

export function downloadProject(snapshot: ProjectSnapshot) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "composition-project.json";
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
