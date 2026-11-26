import type {
  CanvasFormat,
  ComponentRole,
  CompositionStyle,
  LibraryAsset,
  SceneItem,
} from "./types";

export type PlacedAssetSpec = {
  asset: LibraryAsset;
  roleOverride?: ComponentRole;
};

const STYLES: CompositionStyle[] = ["balanced", "focal", "diagonal", "arc"];

/**
 * Computes rotated axis-aligned bounding box half-extents `(halfW, halfH)` for an asset at uniform `scale` and `rotation` (deg).
 */
export function getRotatedHalfExtents(
  width: number,
  height: number,
  scale: number,
  rotationDeg: number,
): { halfW: number; halfH: number } {
  const rad = (Math.abs(rotationDeg) * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const w = width * scale;
  const h = height * scale;
  return {
    halfW: (w * cos + h * sin) / 2,
    halfH: (w * sin + h * cos) / 2,
  };
}

/**
 * Clamps `(x, y)` so the object stays inside the artboard's safe margins (or centered if larger than artboard).
 */
export function clampItemToFormat(
  x: number,
  y: number,
  asset: LibraryAsset,
  scale: number,
  rotation: number,
  format: CanvasFormat,
  marginRatio: number = 0.04,
): { x: number; y: number } {
  const marginX = format.width * marginRatio;
  const marginY = format.height * marginRatio;
  const { halfW, halfH } = getRotatedHalfExtents(asset.width, asset.height, scale, rotation);

  const minX = marginX + halfW;
  const maxX = format.width - marginX - halfW;
  const minY = marginY + halfH;
  const maxY = format.height - marginY - halfH;

  return {
    x: minX <= maxX ? Math.min(maxX, Math.max(minX, x)) : format.width / 2,
    y: minY <= maxY ? Math.min(maxY, Math.max(minY, y)) : format.height / 2,
  };
}

/**
 * Computes a harmonious uniform scale preserving relative proportions of the source illustration system!
 * L illustrations were authored around ~1000px reference canvas, S around ~500px reference canvas.
 * Using a reference normalization prevents tiny objects (like Coin) from inflating to the size of huge objects (like Book),
 * while gently adapting overall composition density to item count and canvas format.
 */
function naturalProportionalScale(
  asset: LibraryAsset,
  format: CanvasFormat,
  effectiveRole: ComponentRole,
  roleIndex: number,
  totalMainCount: number,
): number {
  const minCanvasDim = Math.min(format.width, format.height);
  // Reference source space: L assets have max ~1446px, S assets max ~723px
  const referenceUnit = asset.detailLevel === "S" ? 560 : 1120;
  const baseCanvasScale = (minCanvasDim / referenceUnit) * 0.48;

  // Density factor: scale down gracefully as more objects join the scene
  const densityFactor =
    totalMainCount <= 1 ? 1.18
    : totalMainCount === 2 ? 1.02
    : totalMainCount === 3 ? 0.9
    : totalMainCount === 4 ? 0.8
    : 0.7;

  // Hierarchy boost: first main object is the focal anchor (hero), background objects are slightly calmer
  const hierarchyFactor =
    effectiveRole === "background"
      ? 0.86
      : roleIndex === 0
        ? 1.08
        : 0.94;

  let scale = baseCanvasScale * densityFactor * hierarchyFactor;

  // Guardrails: never let a single object exceed 52% of canvas width/height, nor become microscopic (< 11% of minCanvasDim)
  const maxAllowedScale = Math.min(
    (format.width * (effectiveRole === "background" ? 0.42 : 0.5)) / Math.max(asset.width, 1),
    (format.height * (effectiveRole === "background" ? 0.42 : 0.5)) / Math.max(asset.height, 1),
  );
  const minVisualSpan = minCanvasDim * (effectiveRole === "background" ? 0.13 : 0.15);
  const minAllowedScale = minVisualSpan / Math.max(asset.width, asset.height, 1);

  scale = Math.max(minAllowedScale, Math.min(maxAllowedScale, scale));
  return Number(scale.toFixed(4));
}

function getMainTargetAnchors(
  count: number,
  format: CanvasFormat,
  style: CompositionStyle,
): Array<{ x: number; y: number; rotation: number }> {
  const w = format.width;
  const h = format.height;
  const isPortrait = h > w * 1.1;
  const isLandscape = w > h * 1.25;

  if (count === 1) {
    return [{ x: w * 0.5, y: h * 0.52, rotation: 0 }];
  }

  if (count === 2) {
    if (style === "diagonal") {
      return [
        { x: w * 0.37, y: h * 0.44, rotation: -3 },
        { x: w * 0.65, y: h * 0.6, rotation: 4 },
      ];
    }
    if (isPortrait) {
      return [
        { x: w * 0.46, y: h * 0.4, rotation: -2 },
        { x: w * 0.55, y: h * 0.66, rotation: 3 },
      ];
    }
    return [
      { x: w * 0.36, y: h * 0.53, rotation: -3 },
      { x: w * 0.66, y: h * 0.51, rotation: 3 },
    ];
  }

  if (count === 3) {
    if (style === "focal") {
      return [
        { x: w * 0.5, y: h * 0.54, rotation: 0 },
        { x: w * 0.25, y: h * 0.43, rotation: -5 },
        { x: w * 0.76, y: h * 0.45, rotation: 5 },
      ];
    }
    if (style === "diagonal") {
      return [
        { x: w * 0.5, y: h * 0.52, rotation: 0 },
        { x: w * 0.26, y: h * 0.36, rotation: -4 },
        { x: w * 0.74, y: h * 0.67, rotation: 4 },
      ];
    }
    if (isPortrait) {
      return [
        { x: w * 0.5, y: h * 0.46, rotation: 0 },
        { x: w * 0.31, y: h * 0.7, rotation: -4 },
        { x: w * 0.7, y: h * 0.71, rotation: 4 },
      ];
    }
    // Classic editorial triangle (hero slightly upper-center or lower-center, flanked harmoniously)
    return [
      { x: w * 0.5, y: h * (isLandscape ? 0.54 : 0.47), rotation: 0 },
      { x: w * 0.26, y: h * (isLandscape ? 0.5 : 0.64), rotation: -4 },
      { x: w * 0.74, y: h * (isLandscape ? 0.5 : 0.64), rotation: 4 },
    ];
  }

  // 4 or more main objects: balanced editorial constellation / grid-arc
  const anchors: Array<{ x: number; y: number; rotation: number }> = [];
  if (count === 4 && style !== "arc") {
    return [
      { x: w * 0.36, y: h * 0.41, rotation: -3 },
      { x: w * 0.66, y: h * 0.41, rotation: 3 },
      { x: w * 0.34, y: h * 0.68, rotation: 2 },
      { x: w * 0.67, y: h * 0.68, rotation: -2 },
    ];
  }

  const cols = isPortrait ? 2 : Math.ceil(Math.sqrt(count * (w / h)));
  const rows = Math.ceil(count / cols);
  for (let i = 0; i < count; i += 1) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const itemsInRow = row === rows - 1 ? count - row * cols : cols;
    const normX = (col + 0.5) / Math.max(itemsInRow, 1);
    const normY = (row + 0.5) / Math.max(rows, 1);
    const arcLift = style === "arc" ? Math.sin(normX * Math.PI) * -0.07 * h : 0;
    anchors.push({
      x: w * (0.16 + normX * 0.68),
      y: h * (0.2 + normY * 0.62) + arcLift,
      rotation: i === 0 ? 0 : (i % 2 === 0 ? -3 : 3),
    });
  }
  return anchors;
}

function getBackgroundAnchors(
  count: number,
  format: CanvasFormat,
  variantIndex: number,
): Array<{ x: number; y: number; rotation: number }> {
  const w = format.width;
  const h = format.height;
  const flip = variantIndex % 2 === 1;

  const slots = [
    { x: w * (flip ? 0.76 : 0.24), y: h * 0.28, rotation: flip ? 6 : -6 },
    { x: w * (flip ? 0.25 : 0.75), y: h * 0.31, rotation: flip ? -5 : 5 },
    { x: w * 0.5, y: h * 0.24, rotation: 0 },
    { x: w * (flip ? 0.22 : 0.78), y: h * 0.74, rotation: flip ? 4 : -4 },
  ];

  if (count <= slots.length) return slots.slice(0, count);

  return Array.from({ length: count }, (_, idx) => {
    const angle = (idx / count) * Math.PI * 2 - Math.PI / 2;
    return {
      x: w * (0.5 + 0.31 * Math.cos(angle)),
      y: h * (0.48 + 0.28 * Math.sin(angle)),
      rotation: idx % 2 === 0 ? -5 : 5,
    };
  });
}

/**
 * Iterative collision relaxation so main objects never awkwardly pile on top of one another,
 * while strictly staying inside the artboard boundaries.
 */
function resolveMainCollisions(
  placed: Array<{ item: SceneItem; asset: LibraryAsset }>,
  format: CanvasFormat,
) {
  if (placed.length <= 1) return;

  const pad = Math.min(format.width, format.height) * 0.025;
  const iterations = 28;

  for (let iter = 0; iter < iterations; iter += 1) {
    let moved = false;
    for (let i = 0; i < placed.length; i += 1) {
      for (let j = i + 1; j < placed.length; j += 1) {
        const a = placed[i];
        const b = placed[j];
        const extA = getRotatedHalfExtents(a.asset.width, a.asset.height, a.item.scale, a.item.rotation);
        const extB = getRotatedHalfExtents(b.asset.width, b.asset.height, b.item.scale, b.item.rotation);

        const overlapX = extA.halfW + extB.halfW + pad - Math.abs(b.item.x - a.item.x);
        const overlapY = extA.halfH + extB.halfH + pad - Math.abs(b.item.y - a.item.y);

        if (overlapX > 0 && overlapY > 0) {
          moved = true;
          // Push apart along the axis of smaller penetration for minimal layout disturbance
          if (overlapX < overlapY) {
            const dir = b.item.x >= a.item.x ? 1 : -1;
            const shift = overlapX * 0.52;
            // Hero (i === 0) moves less so it stays anchored near focal point
            const weightA = i === 0 ? 0.3 : 0.5;
            const weightB = 1 - weightA;
            a.item.x -= dir * shift * weightA;
            b.item.x += dir * shift * weightB;
          } else {
            const dir = b.item.y >= a.item.y ? 1 : -1;
            const shift = overlapY * 0.52;
            const weightA = i === 0 ? 0.3 : 0.5;
            const weightB = 1 - weightA;
            a.item.y -= dir * shift * weightA;
            b.item.y += dir * shift * weightB;
          }
        }
      }
    }

    for (const entry of placed) {
      const clamped = clampItemToFormat(
        entry.item.x,
        entry.item.y,
        entry.asset,
        entry.item.scale,
        entry.item.rotation,
        format,
        0.045,
      );
      entry.item.x = clamped.x;
      entry.item.y = clamped.y;
    }

    if (!moved) break;
  }
}

/**
 * Creates a balanced, proportional, and fully editable vector composition inside `format`.
 * Accepts either plain `LibraryAsset[]` or `PlacedAssetSpec[]` (with optional `roleOverride`),
 * plus an optional `variantIndex` for cycling composition styles ("Перекомпоновать").
 */
export function composeScene(
  inputs: Array<LibraryAsset | PlacedAssetSpec>,
  format: CanvasFormat,
  variantIndex: number = 0,
): SceneItem[] {
  const specs: PlacedAssetSpec[] = inputs.map((entry) =>
    "asset" in entry ? entry : { asset: entry },
  );

  const backgrounds = specs.filter((s) => (s.roleOverride ?? s.asset.role) === "background");
  const mainObjects = specs.filter((s) => (s.roleOverride ?? s.asset.role) === "composition_object");

  const style = STYLES[Math.abs(variantIndex) % STYLES.length];
  const result: SceneItem[] = [];

  // 1. Place monochrome background objects on the back layers first (subtle depth & context)
  const bgAnchors = getBackgroundAnchors(backgrounds.length, format, variantIndex);
  backgrounds.forEach((spec, index) => {
    const anchor = bgAnchors[index];
    const scale = naturalProportionalScale(
      spec.asset,
      format,
      "background",
      index,
      Math.max(mainObjects.length, 2),
    );
    const clamped = clampItemToFormat(
      anchor.x,
      anchor.y,
      spec.asset,
      scale,
      anchor.rotation,
      format,
      0.04,
    );
    result.push({
      id: crypto.randomUUID(),
      assetId: spec.asset.id,
      roleOverride: spec.roleOverride,
      x: Math.round(clamped.x),
      y: Math.round(clamped.y),
      scale,
      rotation: anchor.rotation,
      opacity: 0.88,
      visible: true,
    });
  });

  // 2. Place main colored objects in foreground layers with hierarchy and collision resolution
  // Slightly permute supporting objects when variantIndex > 0 while keeping hero prominent
  const orderedMain = [...mainObjects];
  if (variantIndex > 0 && orderedMain.length > 2) {
    const shift = variantIndex % orderedMain.length;
    orderedMain.push(...orderedMain.splice(0, shift));
  }

  const mainAnchors = getMainTargetAnchors(orderedMain.length, format, style);
  const placedMains = orderedMain.map((spec, index) => {
    const anchor = mainAnchors[index];
    const scale = naturalProportionalScale(
      spec.asset,
      format,
      "composition_object",
      index,
      orderedMain.length,
    );
    const clamped = clampItemToFormat(
      anchor.x,
      anchor.y,
      spec.asset,
      scale,
      anchor.rotation,
      format,
      0.045,
    );
    return {
      asset: spec.asset,
      item: {
        id: crypto.randomUUID(),
        assetId: spec.asset.id,
        roleOverride: spec.roleOverride,
        x: clamped.x,
        y: clamped.y,
        scale,
        rotation: anchor.rotation,
        opacity: 1,
        visible: true,
      } satisfies SceneItem,
    };
  });

  resolveMainCollisions(placedMains, format);

  // Place supporting main objects first and the primary hero object at the top of z-order so it's never occluded!
  if (placedMains.length > 1) {
    const [hero, ...supporting] = placedMains;
    for (const entry of supporting) {
      result.push({
        ...entry.item,
        x: Math.round(entry.item.x),
        y: Math.round(entry.item.y),
      });
    }
    result.push({
      ...hero.item,
      x: Math.round(hero.item.x),
      y: Math.round(hero.item.y),
    });
  } else if (placedMains.length === 1) {
    result.push({
      ...placedMains[0].item,
      x: Math.round(placedMains[0].item.x),
      y: Math.round(placedMains[0].item.y),
    });
  }

  return result;
}
