import JSZip from "jszip";
import { assetFromSvg } from "./svg";
import type { DetailLevel, LibraryAsset } from "./types";

function basename(path: string) {
  return path.replace(/\\/g, "/").split("/").pop() ?? path;
}

function displayName(path: string) {
  return basename(path).replace(/\.svg$/i, "").replace(/[-_]/g, " ");
}

async function readSvg(file: File, fallbackDetail: DetailLevel) {
  const sourcePath = file.webkitRelativePath || file.name;
  return assetFromSvg(displayName(sourcePath), await file.text(), sourcePath, {
    fallbackDetail,
    source: "imported",
  });
}

export async function importFiles(files: FileList | File[], fallbackDetail: DetailLevel = "L") {
  const assets: LibraryAsset[] = [];
  for (const file of Array.from(files)) {
    if (file.name.toLocaleLowerCase().endsWith(".svg")) {
      assets.push(await readSvg(file, fallbackDetail));
      continue;
    }
    if (file.name.toLocaleLowerCase().endsWith(".zip")) {
      const zip = await JSZip.loadAsync(file);
      for (const [path, entry] of Object.entries(zip.files)) {
        if (!entry.dir && path.toLocaleLowerCase().endsWith(".svg")) {
          const sourcePath = path.replace(/\\/g, "/");
          const svg = await entry.async("string");
          assets.push(assetFromSvg(displayName(sourcePath), svg, sourcePath, {
            fallbackDetail,
            source: "imported",
          }));
        }
      }
    }
  }
  return assets;
}
