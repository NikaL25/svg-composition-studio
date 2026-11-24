import type { CanvasFormat, LibraryAsset, SceneItem } from "./types";

function fittedScale(asset: LibraryAsset, maxWidth: number, maxHeight: number) {
  return Math.min(maxWidth / Math.max(asset.width, 1), maxHeight / Math.max(asset.height, 1));
}

/** Creates a proportional, editable initial layout inside the current artboard. */
export function composeScene(assets: LibraryAsset[], format: CanvasFormat): SceneItem[] {
  const backgrounds = assets.filter((asset) => asset.role === "background");
  const mainObjects = assets.filter((asset) => asset.role === "composition_object");
  const result: SceneItem[] = [];

  const backgroundSpacing = format.width * 0.7 / Math.max(backgrounds.length, 1);
  backgrounds.forEach((asset, index) => {
    const x = format.width * 0.15 + backgroundSpacing * (index + 0.5);
    result.push({
      id: crypto.randomUUID(),
      assetId: asset.id,
      x,
      y: format.height * 0.39,
      scale: fittedScale(asset, Math.min(backgroundSpacing * 0.72, format.width * 0.24), format.height * 0.28),
      rotation: index % 2 === 0 ? -5 : 5,
      opacity: 0.78,
      visible: true,
    });
  });

  const mainSpacing = format.width * 0.76 / Math.max(mainObjects.length, 1);
  mainObjects.forEach((asset, index) => {
    const centerOffset = (index - (mainObjects.length - 1) / 2) * mainSpacing;
    result.push({
      id: crypto.randomUUID(),
      assetId: asset.id,
      x: format.width / 2 + centerOffset,
      y: format.height * (index % 2 === 0 ? 0.59 : 0.53),
      scale: fittedScale(asset, Math.min(mainSpacing * 0.84, format.width * 0.3), format.height * 0.43),
      rotation: index === 0 ? -3 : index === mainObjects.length - 1 ? 3 : 0,
      opacity: 1,
      visible: true,
    });
  });

  return result;
}
