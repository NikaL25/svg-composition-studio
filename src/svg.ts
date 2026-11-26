import {
  BACKGROUND_ALLOWED_ROLES,
  MAIN_ALLOWED_ROLES,
  SOURCE_ROLE_COLORS,
} from "./palettes";
import type {
  CanvasFormat,
  ComponentRole,
  DetailLevel,
  LibraryAsset,
  Palette,
  SceneItem,
  SvgViewBox,
} from "./types";

export type AssetMetadata = {
  id?: string;
  familyId?: string;
  description?: string;
  category?: string;
  keywords?: string[];
  sourceIllustration?: string;
  role?: ComponentRole;
  detailLevel?: DetailLevel;
  fallbackDetail?: DetailLevel;
  source?: LibraryAsset["source"];
};

const NAMED_COLORS: Record<string, string> = {
  white: "#ffffff",
  black: "#000000",
  red: "#ff0000",
  green: "#008000",
  blue: "#0000ff",
  yellow: "#ffff00",
  cyan: "#00ffff",
  magenta: "#ff00ff",
  gray: "#808080",
  grey: "#808080",
};

const NON_RECOLORABLE_VALUES = new Set([
  "none",
  "transparent",
  "inherit",
  "initial",
  "unset",
  "context-fill",
  "context-stroke",
]);

const COLOR_ATTRIBUTES = [
  "fill",
  "stroke",
  "stop-color",
  "flood-color",
  "lighting-color",
  "color",
] as const;

/**
 * Normalizes CSS/SVG color representations (#RGB, #RRGGBB, rgb(...), named colors)
 * into canonical lowercase `#rrggbb` whenever possible so attributes and CSSOM inline styles match reliably.
 */
export function normalizeColor(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return "";
  if (NAMED_COLORS[trimmed]) return NAMED_COLORS[trimmed];

  // Expand 3-digit hex #abc -> #aabbcc
  const shortHex = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(trimmed);
  if (shortHex) {
    return `#${shortHex[1]}${shortHex[1]}${shortHex[2]}${shortHex[2]}${shortHex[3]}${shortHex[3]}`;
  }

  // Standard 6-digit hex
  if (/^#[0-9a-f]{6}$/i.test(trimmed)) {
    return trimmed;
  }

  // rgb(r, g, b) or rgba(r, g, b, 1)
  const rgbMatch = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*([\d.]+))?\s*\)$/i.exec(trimmed);
  if (rgbMatch) {
    const alpha = rgbMatch[4] !== undefined ? Number(rgbMatch[4]) : 1;
    if (alpha === 0) return "transparent";
    if (alpha === 1) {
      const r = Math.min(255, Math.max(0, Number(rgbMatch[1]))).toString(16).padStart(2, "0");
      const g = Math.min(255, Math.max(0, Number(rgbMatch[2]))).toString(16).padStart(2, "0");
      const b = Math.min(255, Math.max(0, Number(rgbMatch[3]))).toString(16).padStart(2, "0");
      return `#${r}${g}${b}`;
    }
  }

  return trimmed;
}

function isProtectedPaintValue(value: string): boolean {
  const lower = value.trim().toLowerCase();
  if (!lower) return true;
  if (NON_RECOLORABLE_VALUES.has(lower)) return true;
  // Paint server references (gradients, patterns) are recolored at their <stop> elements, never overwritten!
  if (lower.startsWith("url(")) return true;
  return false;
}

function parseDocument(svg: string): Document {
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  if (doc.querySelector("parsererror") || doc.documentElement.localName.toLowerCase() !== "svg") {
    throw new Error("Файл не содержит корректный SVG");
  }
  return doc;
}

export function svgMetrics(svg: string): { width: number; height: number; viewBox: SvgViewBox } {
  const root = parseDocument(svg).documentElement;
  const rawViewBox = root.getAttribute("viewBox")?.trim().split(/[\s,]+/).map(Number);
  const hasValidViewBox = rawViewBox?.length === 4 && rawViewBox.every(Number.isFinite) && rawViewBox[2] > 0 && rawViewBox[3] > 0;
  const width = Number.parseFloat(root.getAttribute("width") ?? "") || (hasValidViewBox ? rawViewBox![2] : 100);
  const height = Number.parseFloat(root.getAttribute("height") ?? "") || (hasValidViewBox ? rawViewBox![3] : 100);
  const viewBox: SvgViewBox = hasValidViewBox
    ? [rawViewBox![0], rawViewBox![1], rawViewBox![2], rawViewBox![3]]
    : [0, 0, width, height];
  return { width, height, viewBox };
}

/**
 * Extracts all distinct normalized paint colors present in an SVG asset.
 */
export function extractSvgColors(svg: string): string[] {
  const doc = parseDocument(svg);
  const root = doc.documentElement;
  const found = new Set<string>();
  const elements = [root, ...Array.from(root.querySelectorAll("*"))];

  for (const el of elements) {
    for (const attr of COLOR_ATTRIBUTES) {
      const val = el.getAttribute(attr);
      if (val && !isProtectedPaintValue(val) && val.trim().toLowerCase() !== "currentcolor") {
        found.add(normalizeColor(val));
      }
    }
    const style = (el as SVGElement).style;
    if (style) {
      for (const prop of COLOR_ATTRIBUTES) {
        const val = style.getPropertyValue(prop);
        if (val && !isProtectedPaintValue(val) && val.trim().toLowerCase() !== "currentcolor") {
          found.add(normalizeColor(val));
        }
      }
    }
  }
  return [...found];
}

function sanitizeRoot(root: Element) {
  root.querySelectorAll("script, foreignObject").forEach((node) => node.remove());
  const elements = [root, ...Array.from(root.querySelectorAll("*"))];
  for (const element of elements) {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim().toLowerCase();
      if (name.startsWith("on") || value.startsWith("javascript:")) {
        element.removeAttribute(attribute.name);
      }
    }
  }
}

/**
 * Scopes internal SVG IDs (`id="..."`, `url(#...)`, `href="#..."`, `xlink:href="#..."`)
 * so multiple instances of SVGs with gradients, masks, or clipPaths never collide in the DOM or exported file.
 */
function scopeInternalIds(root: Element, scopePrefix: string) {
  const safePrefix = scopePrefix.replace(/[^a-zA-Z0-9_-]/g, "_");
  const idMap = new Map<string, string>();

  root.querySelectorAll("[id]").forEach((el) => {
    const oldId = el.getAttribute("id");
    if (oldId) {
      const newId = `${safePrefix}_${oldId}`;
      idMap.set(oldId, newId);
      el.setAttribute("id", newId);
    }
  });

  if (idMap.size === 0) return;

  const replaceUrlRefs = (val: string) =>
    val.replace(/url\(\s*['"]?#([^'")\s]+)['"]?\s*\)/g, (match, refId: string) => {
      const mapped = idMap.get(refId);
      return mapped ? `url(#${mapped})` : match;
    });

  const elements = [root, ...Array.from(root.querySelectorAll("*"))];
  for (const el of elements) {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      const val = attr.value;
      if ((name === "href" || name === "xlink:href") && val.startsWith("#")) {
        const mapped = idMap.get(val.slice(1));
        if (mapped) el.setAttribute(attr.name, `#${mapped}`);
      } else if (val.includes("url(#") || val.includes("url('#") || val.includes('url("#')) {
        el.setAttribute(attr.name, replaceUrlRefs(val));
      }
    }
    if (el.tagName.toLowerCase() === "style" && el.textContent) {
      el.textContent = replaceUrlRefs(el.textContent);
    }
  }
}

/**
 * Builds the effective normalized color lookup table for the given palette and effective role.
 * Strictly enforces:
 * - Background role NEVER receives main-object accent colors.
 * - Switching a main SVG to background role (`effectiveRole === "background"`) projects it cleanly
 *   into monochrome (`ink` -> `bgStroke`, fills -> `bgFill`), even when no palette is selected.
 */
function buildEffectiveColorMap(
  paletteDefinition: Palette | undefined,
  effectiveRole: ComponentRole,
): Map<string, string> {
  const map = new Map<string, string>();

  if (!paletteDefinition) {
    // Even with "original colors" (no active palette override), if a main object is switched
    // to background mode, enforce the library's monochrome background rule!
    if (effectiveRole === "background") {
      map.set(SOURCE_ROLE_COLORS.ink, SOURCE_ROLE_COLORS.bgStroke);
      map.set(SOURCE_ROLE_COLORS.surface, SOURCE_ROLE_COLORS.bgFill);
      map.set(SOURCE_ROLE_COLORS.accentPrimary, SOURCE_ROLE_COLORS.bgFill);
      map.set(SOURCE_ROLE_COLORS.accentSecondary, SOURCE_ROLE_COLORS.bgFill);
      map.set(SOURCE_ROLE_COLORS.accentSoft, SOURCE_ROLE_COLORS.bgFill);
      map.set(SOURCE_ROLE_COLORS.bgMid, SOURCE_ROLE_COLORS.bgMid);
      map.set(SOURCE_ROLE_COLORS.bgFill, SOURCE_ROLE_COLORS.bgFill);
      map.set(SOURCE_ROLE_COLORS.bgStroke, SOURCE_ROLE_COLORS.bgStroke);
    }
    return map;
  }

  if (effectiveRole === "background") {
    const bgSource = paletteDefinition.backgroundColors ?? {};
    const forbiddenMainTargets = new Set<string>();
    if (paletteDefinition.roles) {
      const allowedBg = new Set(
        [
          paletteDefinition.roles.bgStroke,
          paletteDefinition.roles.bgFill,
          paletteDefinition.roles.bgMid,
        ].map(normalizeColor),
      );
      for (const c of [
        paletteDefinition.roles.accentPrimary,
        paletteDefinition.roles.accentSecondary,
        paletteDefinition.roles.accentSoft,
      ]) {
        const norm = normalizeColor(c);
        if (!allowedBg.has(norm)) forbiddenMainTargets.add(norm);
      }
    }

    // Default monochrome fallback for any unmapped main colors when in background mode
    const fallbackStroke = paletteDefinition.roles?.bgStroke ?? SOURCE_ROLE_COLORS.bgStroke;
    const fallbackFill = paletteDefinition.roles?.bgFill ?? SOURCE_ROLE_COLORS.bgFill;
    map.set(SOURCE_ROLE_COLORS.ink, fallbackStroke);
    map.set(SOURCE_ROLE_COLORS.surface, fallbackFill);
    map.set(SOURCE_ROLE_COLORS.accentPrimary, fallbackFill);
    map.set(SOURCE_ROLE_COLORS.accentSecondary, fallbackFill);
    map.set(SOURCE_ROLE_COLORS.accentSoft, fallbackFill);
    map.set(SOURCE_ROLE_COLORS.bgStroke, fallbackStroke);
    map.set(SOURCE_ROLE_COLORS.bgFill, fallbackFill);
    map.set(SOURCE_ROLE_COLORS.bgMid, paletteDefinition.roles?.bgMid ?? fallbackFill);

    for (const [from, to] of Object.entries(bgSource)) {
      const normFrom = normalizeColor(from);
      const normTo = normalizeColor(to);
      if (normFrom && !forbiddenMainTargets.has(normTo)) {
        map.set(normFrom, to.trim());
      }
    }
    return map;
  }

  // Main object (`composition_object`): may use both main accent colors and background colors
  for (const [from, to] of Object.entries(paletteDefinition.colors ?? {})) {
    const normFrom = normalizeColor(from);
    if (normFrom && to.trim()) {
      map.set(normFrom, to.trim());
    }
  }
  return map;
}

function remapSingleColor(value: string, colorMap: Map<string, string>): string {
  if (isProtectedPaintValue(value)) return value;
  if (value.trim().toLowerCase() === "currentcolor") return value;
  const normalized = normalizeColor(value);
  return colorMap.get(normalized) ?? value;
}

/**
 * Remaps color properties inside embedded `<style>` CSS blocks (handling SVG CSS classes).
 */
function remapCssStyleBlock(cssText: string, colorMap: Map<string, string>): string {
  if (colorMap.size === 0) return cssText;
  const propPattern = /\b(fill|stroke|stop-color|flood-color|lighting-color|color)\s*:\s*([^;!}]+)(\s*!important)?/gi;
  return cssText.replace(propPattern, (full, prop: string, rawVal: string, important?: string) => {
    const replaced = remapSingleColor(rawVal.trim(), colorMap);
    if (replaced === rawVal.trim()) return full;
    return `${prop}: ${replaced}${important ?? ""}`;
  });
}

function applyPaletteToElementTree(
  root: Element,
  paletteDefinition: Palette | undefined,
  effectiveRole: ComponentRole,
) {
  const colorMap = buildEffectiveColorMap(paletteDefinition, effectiveRole);
  if (colorMap.size === 0) return;

  // Support `currentColor` inheritance cleanly if used inside the SVG
  const hasCurrentColor = root.innerHTML.toLowerCase().includes("currentcolor");
  if (hasCurrentColor && !root.getAttribute("color")) {
    const rootColor =
      effectiveRole === "background"
        ? paletteDefinition?.roles?.bgStroke ?? SOURCE_ROLE_COLORS.bgStroke
        : paletteDefinition?.roles?.ink ?? SOURCE_ROLE_COLORS.ink;
    root.setAttribute("color", rootColor);
  }

  const elements = [root, ...Array.from(root.querySelectorAll("*"))];
  for (const element of elements) {
    if (element.tagName.toLowerCase() === "style" && element.textContent) {
      element.textContent = remapCssStyleBlock(element.textContent, colorMap);
      continue;
    }

    for (const attributeName of COLOR_ATTRIBUTES) {
      const value = element.getAttribute(attributeName);
      if (value) {
        const next = remapSingleColor(value, colorMap);
        if (next !== value) {
          element.setAttribute(attributeName, next);
        }
      }
    }

    const style = (element as SVGElement).style;
    if (!style || !element.getAttribute("style")) continue;

    for (const property of COLOR_ATTRIBUTES) {
      const value = style.getPropertyValue(property);
      if (!value) continue;
      const replacement = remapSingleColor(value, colorMap);
      if (replacement !== value) {
        style.setProperty(property, replacement, style.getPropertyPriority(property));
      }
    }
  }
}

// Simple LRU-style bounded cache to avoid reparsing XML 60 times/sec while dragging items on canvas.
const markupCache = new Map<string, string>();
const MAX_CACHE_ENTRIES = 400;

function paletteSignature(palette: Palette | undefined, role: ComponentRole): string {
  if (!palette) return `raw:${role}`;
  const map = role === "background" ? palette.backgroundColors : palette.colors;
  return `${palette.id}:${role}:${JSON.stringify(map ?? {})}:${JSON.stringify(palette.roles ?? {})}`;
}

/**
 * Returns the complete, sanitized `<svg>` root with role-based color remapping applied
 * and internal IDs optionally scoped. Geometry (`<path d="...">`, transforms, viewBox) is 100% untouched.
 */
export function svgInnerMarkup(
  svg: string,
  paletteDefinition?: Palette,
  svgColorRole: ComponentRole = "composition_object",
  scopeId?: string,
): string {
  const cacheKey = `${svg.length}:${svg.slice(0, 64)}:${svg.slice(-48)}:${paletteSignature(paletteDefinition, svgColorRole)}:${scopeId ?? ""}`;
  const cached = markupCache.get(cacheKey);
  if (cached) return cached;

  const doc = parseDocument(svg);
  const root = doc.documentElement;

  sanitizeRoot(root);
  if (scopeId) {
    scopeInternalIds(root, scopeId);
  }
  applyPaletteToElementTree(root, paletteDefinition, svgColorRole);

  const serialized = new XMLSerializer().serializeToString(root);
  if (markupCache.size >= MAX_CACHE_ENTRIES) {
    const firstKey = markupCache.keys().next().value;
    if (firstKey !== undefined) markupCache.delete(firstKey);
  }
  markupCache.set(cacheKey, serialized);
  return serialized;
}

function escapeXmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Builds a clean, Figma- and Illustrator-compatible editable vector SVG composition.
 * Every visible SceneItem becomes a separate named `<g>` layer preserving exact proportions,
 * coordinates, rotation, opacity, color scheme, and 100% original vector `<path>` geometry.
 */
export function buildExportCompositionSvg(params: {
  items: SceneItem[];
  assets: LibraryAsset[];
  format: CanvasFormat;
  activePalette?: Palette;
}): string {
  const { items, assets, format, activePalette } = params;

  const layersMarkup = items
    .filter((item) => item.visible)
    .map((item, layerIndex) => {
      const asset = assets.find((candidate) => candidate.id === item.assetId);
      if (!asset?.svg) return "";

      const effectiveRole: ComponentRole = item.roleOverride ?? asset.role;
      const doc = parseDocument(asset.svg);
      const root = doc.documentElement;

      sanitizeRoot(root);
      const scopePrefix = `layer_${layerIndex + 1}_${asset.familyId || "obj"}`;
      scopeInternalIds(root, scopePrefix);
      applyPaletteToElementTree(root, activePalette, effectiveRole);

      // Account for viewBox offset or viewBox-to-width ratio while preserving exact proportions
      const [vbX, vbY, vbW, vbH] = asset.viewBox;
      const vbScaleX = vbW > 0 ? asset.width / vbW : 1;
      const vbScaleY = vbH > 0 ? asset.height / vbH : 1;
      const needsVbTransform = vbX !== 0 || vbY !== 0 || Math.abs(vbScaleX - 1) > 1e-4 || Math.abs(vbScaleY - 1) > 1e-4;

      // Preserve root presentation attributes (such as fill="none") on the inner vector wrapper
      const rootFill = root.getAttribute("fill") ?? "none";
      const rootStroke = root.getAttribute("stroke");
      const rootColor = root.getAttribute("color");
      const presAttrs = [
        `fill="${escapeXmlAttr(rootFill)}"`,
        rootStroke ? `stroke="${escapeXmlAttr(rootStroke)}"` : "",
        rootColor ? `color="${escapeXmlAttr(rootColor)}"` : "",
        needsVbTransform
          ? `transform="scale(${Number(vbScaleX.toFixed(6))} ${Number(vbScaleY.toFixed(6))}) translate(${-vbX} ${-vbY})"`
          : "",
      ]
        .filter(Boolean)
        .join(" ");

      const serializer = new XMLSerializer();
      const innerNodes = Array.from(root.childNodes)
        .map((node) => serializer.serializeToString(node))
        .join("");

      const cx = Number(item.x.toFixed(3));
      const cy = Number(item.y.toFixed(3));
      const rot = Number(item.rotation.toFixed(3));
      const sc = Number(item.scale.toFixed(6));
      const halfW = Number((-asset.width / 2).toFixed(3));
      const halfH = Number((-asset.height / 2).toFixed(3));
      const op = Number(item.opacity.toFixed(3));

      const layerLabel = `${asset.name} (${asset.detailLevel}, ${effectiveRole === "background" ? "фон" : "главный"})`;
      const layerId = `layer-${layerIndex + 1}-${asset.familyId || "item"}`;

      return [
        `  <g id="${escapeXmlAttr(layerId)}" data-name="${escapeXmlAttr(layerLabel)}" data-asset-id="${escapeXmlAttr(asset.id)}" data-role="${effectiveRole}" data-detail="${asset.detailLevel}" transform="translate(${cx} ${cy}) rotate(${rot}) scale(${sc}) translate(${halfW} ${halfH})"${op < 1 ? ` opacity="${op}"` : ""}>`,
        `    <g ${presAttrs}>${innerNodes}</g>`,
        `  </g>`,
      ].join("\n");
    })
    .filter(Boolean)
    .join("\n");

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${format.width}" height="${format.height}" viewBox="0 0 ${format.width} ${format.height}" fill="none">`,
    `  <rect id="canvas-background" width="${format.width}" height="${format.height}" fill="#FFFFFF"/>`,
    layersMarkup,
    `</svg>`,
  ]
    .filter(Boolean)
    .join("\n");
}

function pathSegments(sourcePath: string) {
  return sourcePath.replace(/\\/g, "/").split("/").filter(Boolean);
}

const SIMPLE_SLUG: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "zh", з: "z", и: "i", й: "y",
  к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f",
  х: "kh", ц: "ts", ч: "ch", ш: "sh", щ: "shch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

export function slugifyName(value: string): string {
  return (
    [...value.toLocaleLowerCase()]
      .map((ch) => SIMPLE_SLUG[ch] ?? ch)
      .join("")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "object"
  );
}

export function assetFromSvg(
  name: string,
  svg: string,
  sourcePath: string,
  metadata: AssetMetadata = {},
): LibraryAsset {
  const segments = pathSegments(sourcePath);
  const filename = segments[segments.length - 1] ?? name;
  const detailFromPath = [...segments].reverse().find((part) => part === "L" || part === "S") as
    | DetailLevel
    | undefined;
  const roleFromPath = segments.includes("background_objects")
    ? "background"
    : segments.includes("main_objects")
      ? "composition_object"
      : undefined;
  const detailFromName = /(?:^|[-_. ])S(?:$|[-_. ])/i.test(filename)
    ? "S"
    : /(?:^|[-_. ])L(?:$|[-_. ])/i.test(filename)
      ? "L"
      : undefined;
  const lowerName = name.toLocaleLowerCase();
  const role: ComponentRole =
    metadata.role ??
    roleFromPath ??
    (/фон|background/i.test(lowerName) ? "background" : "composition_object");
  const detailLevel: DetailLevel =
    metadata.detailLevel ?? detailFromPath ?? detailFromName ?? metadata.fallbackDetail ?? "L";
  const metrics = svgMetrics(svg);
  const familyId = metadata.familyId ?? slugifyName(name);

  return {
    id: metadata.id ?? `imported-${crypto.randomUUID()}`,
    familyId,
    name,
    description:
      metadata.description ??
      `${role === "background" ? "Монохромный фоновый" : "Цветной главный"} векторный объект «${name}» (${detailLevel})`,
    category: metadata.category ?? (metadata.source === "library" ? "Библиотека" : "Пользовательский импорт"),
    keywords: metadata.keywords ?? [lowerName],
    sourceIllustration: metadata.sourceIllustration ?? `${detailLevel} · ${name}`,
    role,
    detailLevel,
    allowedColorRoles: role === "background" ? [...BACKGROUND_ALLOWED_ROLES] : [...MAIN_ALLOWED_ROLES],
    source: metadata.source ?? "imported",
    sourcePath,
    svg,
    ...metrics,
  };
}
