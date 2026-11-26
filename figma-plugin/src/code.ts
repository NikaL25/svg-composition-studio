type DetailLevel = "L" | "S";
type PluginAsset = {
  id: string;
  name: string;
  type: string;
  role: "background" | "composition_object";
  detailLevels: DetailLevel[];
  width: number;
  height: number;
  page: string;
};

type LayoutMode = "horizontal" | "vertical" | "grid" | "adaptive";
type AlignMode = "left" | "center" | "right" | "top" | "middle" | "bottom";

type LayoutOptions = {
  mode: LayoutMode;
  padding: number;
  gap: number;
  align: AlignMode;
  wrap?: boolean;
};

const UI_WIDTH = 360;
const UI_HEIGHT = 620;
figma.showUI(__html__, { width: UI_WIDTH, height: UI_HEIGHT, themeColors: true });

function detailFromSection(sectionName: string, nodeName: string): DetailLevel[] {
  if (sectionName === "Размер L" || /(^|[-_ .])l($|[-_ .])/i.test(nodeName)) return ["L"];
  if (sectionName === "Размер S" || /(^|[-_ .])s($|[-_ .])/i.test(nodeName)) return ["S"];
  return ["L", "S"];
}

function roleFromName(name: string): PluginAsset["role"] {
  return /фон|background|конфетти/i.test(name) ? "background" : "composition_object";
}

function findLibraryPage(): PageNode | null {
  const exact = figma.root.children.find(
    (c) => c.type === "PAGE" && c.name === "Библиотека компонентов",
  );
  if (exact) return exact;
  const fuzzy = figma.root.children.find(
    (c) =>
      c.type === "PAGE" &&
      /библиотека.*компонент|компонент.*библиотека/i.test(c.name),
  );
  if (fuzzy) return fuzzy;
  for (const page of figma.root.children) {
    if (page.type !== "PAGE") continue;
    const hasSizeSection = page.children.some(
      (c) => c.type === "SECTION" && /^Размер [LS]$/.test(c.name),
    );
    if (hasSizeSection) return page;
  }
  return null;
}

function findSizeSection(page: PageNode, detail: DetailLevel): SectionNode | null {
  const target = detail === "L" ? "Размер L" : "Размер S";
  const exact = page.children.find(
    (c) => c.type === "SECTION" && c.name === target,
  );
  if (exact) return exact as SectionNode;
  const fuzzy = page.children.find(
    (c) =>
      c.type === "SECTION" &&
      new RegExp(`размер\\s*${detail}`, "i").test(c.name),
  );
  if (fuzzy) return fuzzy as SectionNode;
  return null;
}

function scanLibrary(): PluginAsset[] {
  const page = findLibraryPage();
  if (!page) return [];
  const result: PluginAsset[] = [];
  const pageName = page.name;
  const supportedTypes = [
    "FRAME", "GROUP", "COMPONENT", "COMPONENT_SET", "VECTOR", "BOOLEAN_OPERATION",
  ];

  function visit(nodes: readonly SceneNode[], sectionName: string) {
    for (const node of nodes) {
      const technicalName = /^(?:Group|Vector|Line)(?:\s|$)/i.test(node.name);
      if (technicalName) {
        if ("children" in node) visit(node.children, sectionName);
        continue;
      }
      if (supportedTypes.includes(node.type) && node.name.trim()) {
        result.push({
          id: node.id,
          name: node.name,
          type: node.type,
          role: roleFromName(node.name),
          detailLevels: detailFromSection(sectionName, node.name),
          width: Math.round(node.width),
          height: Math.round(node.height),
          page: pageName,
        });
        continue;
      }
      if ("children" in node) visit(node.children, sectionName);
    }
  }

  for (const detail of ["L", "S"] as DetailLevel[]) {
    const section = findSizeSection(page, detail);
    if (section) visit(section.children, `Размер ${detail}`);
  }

  visit(
    page.children.filter((c) => c.type !== "SECTION") as SceneNode[],
    "Общий",
  );

  return result;
}

function selectNode(node: BaseNode | null) {
  if (!node || !("visible" in node)) return;
  figma.currentPage.selection = [node as SceneNode];
  figma.viewport.scrollAndZoomIntoView([node as SceneNode]);
}

function cloneAsset(id: string) {
  const source = figma.getNodeById(id);
  if (!source || !("clone" in source) || !("width" in source) || !("height" in source)) {
    return { ok: false, error: "Узел не найден или не поддерживает клонирование" };
  }
  const clone = (source as SceneNode).clone();
  const center = figma.viewport.center;
  clone.x = center.x - clone.width / 2;
  clone.y = center.y - clone.height / 2;
  figma.currentPage.appendChild(clone);
  selectNode(clone);
  return { ok: true, id: clone.id, name: clone.name };
}

function createComposition(width: number, height: number) {
  const frame = figma.createFrame();
  frame.name = `Composition ${width}×${height}`;
  frame.resize(width, height);
  frame.x = figma.viewport.center.x - width / 2;
  frame.y = figma.viewport.center.y - height / 2;
  frame.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
  figma.currentPage.appendChild(frame);
  selectNode(frame);
  return { ok: true, id: frame.id, width, height };
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, Math.min(index + chunk, bytes.length)));
  }
  return btoa(binary);
}

function isAlignMode(value: string | undefined): value is AlignMode {
  return (
    value === "left" ||
    value === "center" ||
    value === "right" ||
    value === "top" ||
    value === "middle" ||
    value === "bottom"
  );
}

function autoLayoutInsideFrame(
  frameId: string,
  mode: LayoutMode,
  options: LayoutOptions,
): { ok: boolean; error?: string; arrangedCount: number } {
  const frame = figma.getNodeById(frameId);
  if (!frame || frame.type !== "FRAME") {
    return { ok: false, error: "Целевой Frame не найден", arrangedCount: 0 };
  }
  const children = frame.children.filter((child) => child.id !== frameId);
  if (children.length === 0) {
    return { ok: false, error: "Нет объектов внутри Frame для компоновки", arrangedCount: 0 };
  }

  frame.layoutMode =
    mode === "vertical" ? "VERTICAL" : "HORIZONTAL";
  frame.primaryAxisAlignItems =
    options.align === "left" || options.align === "top"
      ? "MIN"
      : options.align === "right" || options.align === "bottom"
        ? "MAX"
        : "CENTER";
  frame.counterAxisAlignItems =
    options.align === "left" || options.align === "right"
      ? "CENTER"
      : options.align === "top" || options.align === "bottom"
        ? "MIN"
        : "CENTER";
  frame.itemSpacing = options.gap;
  if (mode === "grid" || options.wrap) {
    frame.layoutWrap = "WRAP";
    frame.counterAxisSpacing = options.gap;
  } else {
    frame.layoutWrap = "NO_WRAP";
  }
  frame.paddingLeft = options.padding;
  frame.paddingRight = options.padding;
  frame.paddingTop = options.padding;
  frame.paddingBottom = options.padding;

  return { ok: true, arrangedCount: children.length };
}

async function exportSelectedSvg() {
  const selection = figma.currentPage.selection;
  if (!selection || selection.length === 0) {
    return { ok: false, error: "Выберите объект или композицию для экспорта" };
  }
  const results: Array<{ name: string; base64: string }> = [];
  for (const node of selection) {
    try {
      if ("exportAsync" in node) {
        const bytes = await node.exportAsync({ format: "SVG" });
        results.push({ name: `${node.name || "composition"}.svg`, base64: bytesToBase64(bytes) });
      }
    } catch {
      // Skip nodes that can't be exported
    }
  }
  if (results.length === 0) {
    return { ok: false, error: "Не удалось экспортировать выбранные объекты" };
  }
  return {
    ok: true,
    name: results[0].name,
    base64: results[0].base64,
    multiple: results.length > 1,
    all: results,
  };
}

async function exportNodeById(nodeId: string) {
  const node = figma.getNodeById(nodeId);
  if (!node) {
    return { ok: false, error: "Узел не найден" };
  }
  try {
    if ("exportAsync" in node) {
      const bytes = await node.exportAsync({ format: "SVG" });
      return {
        ok: true,
        name: `${node.name || "composition"}.svg`,
        base64: bytesToBase64(bytes),
      };
    }
    return { ok: false, error: "Узел не поддерживает экспорт" };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Ошибка экспорта" };
  }
}

figma.ui.onmessage = async (message: {
  type: string;
  id?: string;
  width?: number;
  height?: number;
  detail?: DetailLevel;
  mode?: LayoutMode;
  frameId?: string;
  exportAll?: boolean;
  padding?: number;
  gap?: number;
  align?: string;
  wrap?: boolean;
}) => {
  if (message.type === "scan-library") {
    figma.ui.postMessage({ type: "library", assets: scanLibrary() });
    return;
  }
  if (message.type === "add-asset" && message.id) {
    figma.ui.postMessage({ type: "result", result: cloneAsset(message.id) });
    return;
  }
  if (message.type === "create-composition" && message.width && message.height) {
    figma.ui.postMessage({ type: "result", result: createComposition(message.width, message.height) });
    return;
  }
  if (message.type === "auto-layout" && message.frameId && message.mode) {
    const result = autoLayoutInsideFrame(message.frameId, message.mode, {
      mode: message.mode,
      padding: message.padding ?? 20,
      gap: message.gap ?? 16,
      align: isAlignMode(message.align) ? message.align : "center",
      wrap: message.wrap ?? message.mode === "grid",
    });
    figma.ui.postMessage({ type: "result", result });
    return;
  }
  if (message.type === "export-svg") {
    if (message.id) {
      figma.ui.postMessage({ type: "export", result: await exportNodeById(message.id) });
    } else {
      figma.ui.postMessage({ type: "export", result: await exportSelectedSvg() });
    }
    return;
  }
  if (message.type === "close") figma.closePlugin();
};

figma.ui.postMessage({ type: "ready", fileName: figma.root.name });
