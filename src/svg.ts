import type { ComponentRole, DetailLevel, LibraryAsset, Palette, SvgViewBox } from "./types";

export type AssetMetadata = {
  id?: string;
  role?: ComponentRole;
  detailLevel?: DetailLevel;
  fallbackDetail?: DetailLevel;
  source?: LibraryAsset["source"];
};

function parseDocument(svg: string) {
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  if (doc.querySelector("parsererror") || doc.documentElement.localName.toLowerCase() !== "svg") {
    throw new Error("Файл не содержит корректный SVG");
  }
  return doc;
}

export function svgMetrics(svg: string) {
  const root = parseDocument(svg).documentElement;
  const rawViewBox = root.getAttribute("viewBox")?.trim().split(/[\s,]+/).map(Number);
  const width = Number.parseFloat(root.getAttribute("width") ?? "") || rawViewBox?.[2] || 100;
  const height = Number.parseFloat(root.getAttribute("height") ?? "") || rawViewBox?.[3] || 100;
  const viewBox: SvgViewBox = rawViewBox?.length === 4 && rawViewBox.every(Number.isFinite)
    ? [rawViewBox[0], rawViewBox[1], rawViewBox[2], rawViewBox[3]]
    : [0, 0, width, height];
  return { width, height, viewBox };
}

function normalizeColor(color: string) {
  return color.trim().toLocaleLowerCase();
}

function paletteLookup(palette?: Palette) {
  return new Map(Object.entries(palette?.colors ?? {}).map(([from, to]) => [normalizeColor(from), to.trim()]));
}

function remapColor(value: string, palette: Map<string, string>) {
  const replacement = palette.get(normalizeColor(value));
  return replacement ?? value;
}

function sanitizeRoot(root: Element) {
  root.querySelectorAll("script, foreignObject").forEach((node) => node.remove());
  const elements = [root, ...Array.from(root.querySelectorAll("*"))];
  for (const element of elements) {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim().toLowerCase();
      if (name.startsWith("on") || value.startsWith("javascript:")) element.removeAttribute(attribute.name);
    }
  }
}

/**
 * Returns the complete, sanitized SVG root. Keeping the root preserves its
 * viewBox, dimensions, presentation attributes, defs and vector descendants.
 */
export function svgInnerMarkup(svg: string, paletteDefinition?: Palette) {
  const doc = parseDocument(svg);
  const root = doc.documentElement;
  sanitizeRoot(root);

  const palette = paletteLookup(paletteDefinition);
  if (palette.size) {
    const colorAttributes = ["fill", "stroke", "stop-color", "flood-color", "lighting-color", "color"];
    const elements = [root, ...Array.from(root.querySelectorAll("*"))];
    for (const element of elements) {
      for (const attributeName of colorAttributes) {
        const value = element.getAttribute(attributeName);
        if (value) element.setAttribute(attributeName, remapColor(value, palette));
      }

      // Parse inline CSS declarations through the browser CSSOM instead of
      // doing global string replacement across path data, ids or text.
      const style = (element as SVGElement).style;
      if (!style) continue;
      for (const property of colorAttributes) {
        const value = style.getPropertyValue(property);
        if (!value) continue;
        const replacement = remapColor(value, palette);
        if (replacement !== value) style.setProperty(property, replacement, style.getPropertyPriority(property));
      }
    }
  }

  return new XMLSerializer().serializeToString(root);
}

function pathSegments(sourcePath: string) {
  return sourcePath.replace(/\\/g, "/").split("/").filter(Boolean);
}

export function assetFromSvg(name: string, svg: string, sourcePath: string, metadata: AssetMetadata = {}): LibraryAsset {
  const segments = pathSegments(sourcePath);
  const filename = segments[segments.length - 1] ?? name;
  const detailFromPath = [...segments].reverse().find((part) => part === "L" || part === "S") as DetailLevel | undefined;
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
  const metrics = svgMetrics(svg);

  return {
    id: metadata.id ?? `imported-${crypto.randomUUID()}`,
    name,
    role: metadata.role ?? roleFromPath ?? (/фон|background/i.test(lowerName) ? "background" : "composition_object"),
    detailLevel: metadata.detailLevel ?? detailFromPath ?? detailFromName ?? metadata.fallbackDetail ?? "L",
    source: metadata.source ?? "imported",
    sourcePath,
    svg,
    ...metrics,
  };
}
