
import JSZip from "jszip";
import { assetFromSvg } from "./svg";
import type { DetailLevel, LibraryAsset } from "./types";

function basename(path: string) {
  return path.replace(/\\/g, "/").split("/").pop() ?? path;
}

function displayName(path: string) {
  return basename(path)
    .replace(/\.svg$/i, "")
    .replace(/[-_]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function readSvg(
  file: File,
  fallbackDetail: DetailLevel
): Promise<LibraryAsset> {
  const sourcePath = file.webkitRelativePath || file.name;
  const svg = await file.text();

  return assetFromSvg(
    displayName(sourcePath),
    svg,
    sourcePath,
    {
      fallbackDetail,
      source: "imported",
    }
  );
}

export async function importFiles(
  files: FileList | File[],
  fallbackDetail: DetailLevel = "L"
): Promise<LibraryAsset[]> {
  const assets: LibraryAsset[] = [];

  for (const file of Array.from(files)) {
    const filename = file.name.toLocaleLowerCase();

    if (filename.endsWith(".svg")) {
      assets.push(await readSvg(file, fallbackDetail));
      continue;
    }

    if (filename.endsWith(".zip")) {
      const zip = await JSZip.loadAsync(file);

      const svgEntries = Object.entries(zip.files).filter(
        ([path, entry]) =>
          !entry.dir &&
          path.toLocaleLowerCase().endsWith(".svg")
      );

      const imported = await Promise.all(
        svgEntries.map(async ([path, entry]) => {
          const sourcePath = path.replace(/\\/g, "/");
          const svg = await entry.async("string");

          return assetFromSvg(
            displayName(sourcePath),
            svg,
            sourcePath,
            {
              fallbackDetail,
              source: "imported",
            }
          );
        })
      );

      assets.push(...imported);
    }
  }

  return assets;
}
