import { assetFromSvg } from "./svg";
import type { LibraryAsset } from "./types";

const svgFiles = import.meta.glob<string>("../svg/**/*.svg", {
  eager: true,
  query: "?url",
  import: "default",
});

const transliteration: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "zh", з: "z", и: "i", й: "y",
  к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f",
  х: "kh", ц: "ts", ч: "ch", ш: "sh", щ: "shch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

function slug(value: string) {
  return [...value.toLocaleLowerCase()]
    .map((character) => transliteration[character] ?? character)
    .join("")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "object";
}

function hash(value: string) {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(36);
}

function libraryAsset(sourcePath: string, svg: string): LibraryAsset {
  const normalizedPath = sourcePath.replace(/^\.\.\//, "").replace(/\\/g, "/");
  const filename = normalizedPath.split("/").pop() ?? "object.svg";
  const name = filename.replace(/\.svg$/i, "");
  const detail = normalizedPath.split("/").find((part) => part === "L" || part === "S") ?? "L";
  const role = normalizedPath.includes("/background_objects/") ? "background" : "composition_object";
  const id = `${slug(name)}-${detail}-${role === "background" ? "background" : "main"}-${hash(normalizedPath)}`;
  return assetFromSvg(name, svg, normalizedPath, {
    id,
    detailLevel: detail as "L" | "S",
    role,
    source: "library",
  });
}

/** Vite emits every SVG as a separate static asset and discovers it at build time. */
export const libraryFileCount = Object.keys(svgFiles).length;

let libraryPromise: Promise<LibraryAsset[]> | undefined;
export function loadLibraryAssets() {
  if (!libraryPromise) {
    libraryPromise = Promise.all(Object.entries(svgFiles).map(async ([sourcePath, url]) => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Не удалось загрузить ${sourcePath}: HTTP ${response.status}`);
      return libraryAsset(sourcePath, await response.text());
    })).then((assets) => assets.sort((a, b) => a.sourcePath.localeCompare(b.sourcePath, "ru")))
      .catch((error: unknown) => {
        libraryPromise = undefined;
        throw error;
      });
  }
  return libraryPromise;
}

/** Imported assets are deduplicated by their unique id only, never by name. */
export function mergeImportedAssets(existing: LibraryAsset[], imported: LibraryAsset[]) {
  const ids = new Set(existing.map((asset) => asset.id));
  return [...existing, ...imported.filter((asset) => !ids.has(asset.id))];
}
