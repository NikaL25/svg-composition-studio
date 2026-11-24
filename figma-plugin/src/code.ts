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

function scanLibrary(): PluginAsset[] {
  const page = figma.root.children.find((candidate) => candidate.name === "Библиотека компонентов");
  if (!page) return [];
  const result: PluginAsset[] = [];
  const pageName = page.name;
  const supportedTypes = ["FRAME", "GROUP", "COMPONENT", "COMPONENT_SET", "VECTOR", "BOOLEAN_OPERATION"];
  function visit(nodes: readonly SceneNode[], sectionName: string) {
    for (const node of nodes) {
      const technicalName = /^(?:Group|Vector|Line)(?:\s|$)/i.test(node.name);
      if (technicalName) {
        if ("children" in node) visit(node.children, sectionName);
        continue;
      }
      if (supportedTypes.includes(node.type) && node.name.trim()) {
        result.push({ id: node.id, name: node.name, type: node.type, role: roleFromName(node.name), detailLevels: detailFromSection(sectionName, node.name), width: Math.round(node.width), height: Math.round(node.height), page: pageName });
        continue;
      }
      if ("children" in node) visit(node.children, sectionName);
    }
  }
  for (const section of page.children) {
    if (section.type === "SECTION" && /^Размер [LS]$/.test(section.name)) visit(section.children, section.name);
  }
  return result;
}

function selectNode(node: BaseNode | null) {
  if (!node || !("visible" in node)) return;
  figma.currentPage.selection = [node as SceneNode];
  figma.viewport.scrollAndZoomIntoView([node as SceneNode]);
}

function cloneAsset(id: string) {
  const source = figma.getNodeById(id);
  if (!source || !("clone" in source) || !("width" in source) || !("height" in source)) return { ok: false, error: "Узел не найден или не поддерживает клонирование" };
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
  for (let index = 0; index < bytes.length; index += chunk) binary += String.fromCharCode(...bytes.subarray(index, Math.min(index + chunk, bytes.length)));
  return btoa(binary);
}

async function exportSelectedSvg() {
  const node = figma.currentPage.selection[0];
  if (!node) return { ok: false, error: "Выберите объект или композицию" };
  const bytes = await node.exportAsync({ format: "SVG" });
  return { ok: true, name: `${node.name || "composition"}.svg`, base64: bytesToBase64(bytes) };
}

figma.ui.onmessage = async (message: { type: string; id?: string; width?: number; height?: number; detail?: DetailLevel }) => {
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
  if (message.type === "export-svg") {
    figma.ui.postMessage({ type: "export", result: await exportSelectedSvg() });
    return;
  }
  if (message.type === "close") figma.closePlugin();
};

figma.ui.postMessage({ type: "ready", fileName: figma.root.name });
