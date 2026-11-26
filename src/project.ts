import type {
  CanvasFormat,
  DetailLevel,
  LibraryAsset,
  Palette,
  SceneItem,
} from "./types";

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

function isValidProject(value: unknown): value is ProjectSnapshot {
  if (!value || typeof value !== "object") return false;

  const project = value as Partial<ProjectSnapshot>;

  return (
    project.version === 1 &&
    Array.isArray(project.assets) &&
    Array.isArray(project.items) &&
    Array.isArray(project.palettes) &&
    project.assets.every(
      (asset) =>
        asset &&
        typeof asset.id === "string" &&
        typeof asset.name === "string" &&
        typeof asset.svg === "string",
    ) &&
    project.items.every(
      (item) =>
        item &&
        typeof item.id === "string" &&
        typeof item.assetId === "string" &&
        Number.isFinite(item.x) &&
        Number.isFinite(item.y) &&
        Number.isFinite(item.scale) &&
        item.scale > 0,
    )
  );
}

/**
 * Builds a project snapshot.
 * For `localStorage`, built-in library SVGs are omitted (`includeBuiltInAssets = false`)
 * because they are always loaded from `svg/` at startup — saving ~1.5 MB of quota and preventing UI lag!
 * For downloadable `.json` exports (`includeBuiltInAssets = true`), all used assets are embedded for portability.
 */
export function snapshotProject(
  assets: LibraryAsset[],
  items: SceneItem[],
  palettes: Palette[],
  format?: CanvasFormat,
  detail?: DetailLevel,
  activePaletteId?: string,
  includeBuiltInAssets: boolean = true,
): ProjectSnapshot {
  const usedIds = new Set(items.map((item) => item.assetId));
  const persistedAssets = includeBuiltInAssets
    ? assets.filter((asset) => asset.source === "imported" || usedIds.has(asset.id))
    : assets.filter((asset) => asset.source === "imported");

  return {
    version: 1,
    savedAt: new Date().toISOString(),
    assets: persistedAssets,
    items,
    palettes,
    format,
    detail,
    activePaletteId,
  };
}

export function saveProject(snapshot: ProjectSnapshot): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    return true;
  } catch (error) {
    console.error("Ошибка сохранения проекта:", error);
    return false;
  }
}

export function loadProject(): ProjectSnapshot | undefined {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return undefined;
    const parsed: unknown = JSON.parse(raw);
    return isValidProject(parsed) ? parsed : undefined;
  } catch (error) {
    console.error("Ошибка загрузки проекта:", error);
    return undefined;
  }
}

export function downloadProject(snapshot: ProjectSnapshot) {
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], {
    type: "application/json",
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "composition-project.json";

  document.body.appendChild(link);
  link.click();
  link.remove();

  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
