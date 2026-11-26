import { StrictMode, useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent, PointerEvent as ReactPointerEvent } from "react";
import { createRoot } from "react-dom/client";
import {
  findCounterpartAsset,
  libraryFileCount,
  loadLibraryAssets,
  mergeImportedAssets,
} from "./catalog";
import {
  LocalComponentRecommender,
  resolveComponentsByNames,
  type ComponentSuggestion,
} from "./ai";
import { AiCompositionService } from "./ai-provider";
import {
  buildPaletteFromRoles,
  DEFAULT_PALETTE_ID,
  getDefaultPalettes,
  isForbiddenMainColorInBackground,
  mergeWithPresetPalettes,
  SOURCE_ROLE_COLORS,
} from "./palettes";
import { importFiles } from "./importer";
import { clampItemToFormat, composeScene } from "./layout";
import { downloadProject, loadProject, saveProject, snapshotProject } from "./project";
import { assetFromSvg, buildExportCompositionSvg, normalizeColor, svgInnerMarkup } from "./svg";
import type {
  CanvasFormat,
  ComponentRole,
  DetailLevel,
  LibraryAsset,
  Palette,
  RoleColorMap,
  SceneItem,
} from "./types";
import "./styles.css";

const FORMATS: CanvasFormat[] = [
  { id: "square", label: "Квадрат", width: 1080, height: 1080 },
  { id: "portrait", label: "Портрет", width: 1080, height: 1350 },
  { id: "landscape", label: "Ландшафт", width: 1200, height: 675 },
];

const METAPHOR_PRESETS = [
  "Цифровая трансформация бизнеса",
  "Командная работа",
  "Рост и развитие",
  "Искусственный интеллект",
  "Безопасность данных",
];

type DragMode =
  | { kind: "move"; id: string; offsetX: number; offsetY: number }
  | { kind: "scale"; id: string; baseRadius: number }
  | { kind: "rotate"; id: string };

type RestoredProject = {
  assets: LibraryAsset[];
  items: SceneItem[];
  palettes: Palette[];
  format: CanvasFormat;
  detail: DetailLevel;
  activePaletteId?: string;
  missingItems: string[];
};

function isDetail(value: unknown): value is DetailLevel {
  return value === "L" || value === "S";
}

function isRole(value: unknown): value is ComponentRole {
  return value === "background" || value === "composition_object";
}

function effectiveItemRole(item: SceneItem, asset: LibraryAsset): ComponentRole {
  return item.roleOverride ?? asset.role;
}

function restoreProject(
  snapshot: ReturnType<typeof loadProject>,
  library: LibraryAsset[],
): RestoredProject | undefined {
  if (!snapshot) return undefined;
  const detail = isDetail(snapshot.detail) ? snapshot.detail : "L";
  const format = FORMATS.find((candidate) => candidate.id === snapshot.format?.id) ?? FORMATS[0];
  const assets = [...library];
  const legacyById = new Map<string, Partial<LibraryAsset>>();

  for (const raw of (snapshot.assets ?? []) as Array<
    Partial<LibraryAsset> & { detailLevels?: DetailLevel[]; fileName?: string }
  >) {
    if (!raw || typeof raw.id !== "string" || typeof raw.name !== "string") continue;
    legacyById.set(raw.id, raw);
    if (typeof raw.svg !== "string" || assets.some((asset) => asset.id === raw.id)) continue;
    // Skip re-adding built-in library files as duplicates if matched by sourcePath
    if (raw.source === "library" && raw.sourcePath && assets.some((a) => a.sourcePath === raw.sourcePath)) {
      continue;
    }
    const sourcePath =
      typeof raw.sourcePath === "string" ? raw.sourcePath : raw.fileName ?? `project/${raw.name}.svg`;
    const role = isRole(raw.role) ? raw.role : undefined;
    const level = isDetail(raw.detailLevel)
      ? raw.detailLevel
      : raw.detailLevels?.find(isDetail) ?? detail;
    assets.push(
      assetFromSvg(raw.name, raw.svg, sourcePath, {
        id: raw.id,
        role,
        detailLevel: level,
        source: raw.source === "library" ? "library" : "imported",
      }),
    );
  }

  const missingItems: string[] = [];
  const items: SceneItem[] = (snapshot.items ?? []).flatMap((item) => {
    if (!item || typeof item.assetId !== "string") return [];
    const normalizedItem: SceneItem = {
      id: item.id || crypto.randomUUID(),
      assetId: item.assetId,
      x: Number.isFinite(item.x) ? item.x : format.width / 2,
      y: Number.isFinite(item.y) ? item.y : format.height / 2,
      scale: Number.isFinite(item.scale) && item.scale > 0 ? item.scale : 0.4,
      rotation: Number.isFinite(item.rotation) ? item.rotation : 0,
      opacity: Number.isFinite(item.opacity) ? Math.min(1, Math.max(0, item.opacity)) : 1,
      visible: item.visible !== false,
      roleOverride: isRole(item.roleOverride) ? item.roleOverride : undefined,
    };

    if (assets.some((asset) => asset.id === normalizedItem.assetId)) return [normalizedItem];

    const oldAsset = legacyById.get(normalizedItem.assetId);
    const replacement =
      oldAsset &&
      assets.find(
        (asset) =>
          asset.name.toLocaleLowerCase() === oldAsset.name?.toLocaleLowerCase() &&
          (!isRole(oldAsset.role) || asset.role === oldAsset.role) &&
          asset.detailLevel === detail,
      );
    if (replacement) return [{ ...normalizedItem, assetId: replacement.id }];
    missingItems.push(oldAsset?.name ?? "Неизвестный объект");
    return [];
  });

  const palettes = mergeWithPresetPalettes(Array.isArray(snapshot.palettes) ? snapshot.palettes : []);
  const activePaletteId =
    snapshot.activePaletteId && palettes.some((p) => p.id === snapshot.activePaletteId)
      ? snapshot.activePaletteId
      : DEFAULT_PALETTE_ID;

  return { assets, items, palettes, format, detail, activePaletteId, missingItems };
}

function App() {
  const [assets, setAssets] = useState<LibraryAsset[]>([]);
  const [detail, setDetail] = useState<DetailLevel>("L");
  const [format, setFormat] = useState<CanvasFormat>(FORMATS[0]);
  const [items, setItems] = useState<SceneItem[]>([]);
  const [palettes, setPalettes] = useState<Palette[]>(() => getDefaultPalettes());
  const [activePaletteId, setActivePaletteId] = useState<string | undefined>(DEFAULT_PALETTE_ID);
  const [roleFilter, setRoleFilter] = useState<ComponentRole | "all">("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string>();
  const [notice, setNotice] = useState(`Загрузка SVG-библиотеки (${libraryFileCount} файлов)…`);
  const [hydrated, setHydrated] = useState(false);

  // Auto-composition state (Scenario 1 & Scenario 2)
  const [compositionMode, setCompositionMode] = useState<"metaphor" | "components">("metaphor");
  const [composePrompt, setComposePrompt] = useState("");
  const [includeBackgrounds, setIncludeBackgrounds] = useState(true);
  const [componentsTextInput, setComponentsTextInput] = useState("");
  const [pickedAssetIds, setPickedAssetIds] = useState<string[]>([]);
  const [missingComponentNames, setMissingComponentNames] = useState<string[]>([]);
  const [compositionNotes, setCompositionNotes] = useState<string[]>([]);
  const [suggestions, setSuggestions] = useState<ComponentSuggestion[]>([]);
  const [themeSummary, setThemeSummary] = useState("");
  const [layoutVariant, setLayoutVariant] = useState(0);

  // External / Local semantic AI service
  const [aiService, setAiService] = useState<AiCompositionService | null>(null);
  const [aiAvailable, setAiAvailable] = useState(false);
  const [aiWarning, setAiWarning] = useState<string>();

  // Custom palette pair editor
  const [customFromColor, setCustomFromColor] = useState("#F9ECB0");
  const [customToColor, setCustomToColor] = useState("#68B89E");
  const [paletteWarning, setPaletteWarning] = useState<string>();

  const fileRef = useRef<HTMLInputElement>(null);
  const projectFileRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<DragMode>();

  const activePalette = useMemo(
    () => palettes.find((palette) => palette.id === activePaletteId),
    [palettes, activePaletteId],
  );

  const detailAssets = useMemo(
    () => assets.filter((asset) => Boolean(asset.svg) && asset.detailLevel === detail),
    [assets, detail],
  );

  const visibleAssets = useMemo(() => {
    const q = search.trim().toLocaleLowerCase();
    return detailAssets.filter(
      (asset) =>
        (roleFilter === "all" || asset.role === roleFilter) &&
        (!q ||
          asset.name.toLocaleLowerCase().includes(q) ||
          asset.category.toLocaleLowerCase().includes(q) ||
          asset.keywords.some((kw) => kw.toLocaleLowerCase().includes(q))),
    );
  }, [detailAssets, roleFilter, search]);

  const selected = useMemo(() => items.find((item) => item.id === selectedId), [items, selectedId]);
  const selectedAsset = useMemo(
    () => (selected ? assets.find((asset) => asset.id === selected.assetId) : undefined),
    [assets, selected],
  );
  const selectedEffectiveRole =
    selected && selectedAsset ? effectiveItemRole(selected, selectedAsset) : undefined;

  // Initial library & project load
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const library = await loadLibraryAssets();
        if (!active) return;
        const restored = restoreProject(loadProject(), library);
        if (restored) {
          setAssets(restored.assets);
          setItems(restored.items);
          setPalettes(restored.palettes);
          setFormat(restored.format);
          setDetail(restored.detail);
          setActivePaletteId(restored.activePaletteId);
          setNotice(
            restored.missingItems.length
              ? `Проект восстановлен; пропущены отсутствующие объекты: ${[...new Set(restored.missingItems)].join(", ")}`
              : `Готово · ${library.length} оригинальных SVG (${library.filter((a) => a.detailLevel === "L").length} L / ${library.filter((a) => a.detailLevel === "S").length} S)`,
          );
        } else {
          setAssets(library);
          setPalettes(getDefaultPalettes());
          setActivePaletteId(DEFAULT_PALETTE_ID);
          setNotice(`Загружено оригинальных SVG-компонентов: ${library.length}`);
        }
        setHydrated(true);

        try {
          const service = new AiCompositionService();
          setAiService(service);
          const available = await service.isExternalAvailable();
          if (active) setAiAvailable(available);
        } catch {
          // Local recommender remains active
        }
      } catch (error) {
        if (active) {
          setNotice(error instanceof Error ? error.message : "Не удалось загрузить SVG-библиотеку");
        }
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // Debounced lightweight auto-save to localStorage (avoids serializing 39 library SVGs on every pointer move)
  useEffect(() => {
    if (!hydrated) return;
    const timer = window.setTimeout(() => {
      const ok = saveProject(
        snapshotProject(assets, items, palettes, format, detail, activePaletteId, false),
      );
      if (!ok) {
        setNotice("Не удалось автосохранить проект в localStorage: превышен лимит хранилища");
      }
    }, 280);
    return () => window.clearTimeout(timer);
  }, [assets, items, palettes, format, detail, activePaletteId, hydrated]);

  // Stable keyboard shortcut handler
  const keyboardActionsRef = useRef<(event: KeyboardEvent) => void>(() => {});
  keyboardActionsRef.current = (event: KeyboardEvent) => {
    if (
      !selectedId ||
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLSelectElement ||
      event.target instanceof HTMLTextAreaElement
    ) {
      return;
    }
    const step = event.shiftKey ? 20 : 5;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "d") {
      event.preventDefault();
      duplicateSelected();
    } else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      setItems((current) => current.filter((item) => item.id !== selectedId));
      setSelectedId(undefined);
      setNotice("Объект удалён с холста");
    } else if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
      event.preventDefault();
      const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
      const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
      setItems((current) =>
        current.map((item) =>
          item.id === selectedId ? { ...item, x: item.x + dx, y: item.y + dy } : item,
        ),
      );
    } else if (event.key.toLowerCase() === "r") {
      event.preventDefault();
      setItems((current) =>
        current.map((item) => {
          if (item.id !== selectedId) return item;
          const nextRot = ((item.rotation + 15 + 180) % 360) - 180;
          return { ...item, rotation: Math.round(nextRot) };
        }),
      );
    } else if (event.key === "Escape") {
      setSelectedId(undefined);
    }
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => keyboardActionsRef.current(e);
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  async function onImport(fileList: FileList | null) {
    if (!fileList?.length) return;
    try {
      const imported = await importFiles(fileList, detail);
      if (imported.length === 0) {
        setNotice("В выбранных файлах не найдено корректных SVG");
        return;
      }
      setAssets((current) => mergeImportedAssets(current, imported));
      setNotice(`Импортировано дополнительных SVG: ${imported.length}`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Не удалось импортировать файлы");
    }
  }

  function onDropFiles(event: DragEvent) {
    event.preventDefault();
    void onImport(event.dataTransfer.files);
  }

  function applyLoadedProject(snapshot: ReturnType<typeof loadProject>) {
    const restored = restoreProject(
      snapshot,
      assets.filter((asset) => asset.source === "library"),
    );
    if (!restored) throw new Error("Файл не является сохранённым проектом SVG Composition Studio");
    setAssets(restored.assets);
    setItems(restored.items);
    setPalettes(restored.palettes);
    setFormat(restored.format);
    setDetail(restored.detail);
    setActivePaletteId(restored.activePaletteId);
    setSelectedId(undefined);
    setSuggestions([]);
    setMissingComponentNames([]);
    setNotice(
      restored.missingItems.length
        ? `Проект открыт; пропущены недоступные объекты: ${[...new Set(restored.missingItems)].join(", ")}`
        : "Проект успешно открыт",
    );
  }

  async function importProject(fileList: FileList | null) {
    const file = fileList?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (
        parsed.version !== 1 ||
        !Array.isArray(parsed.assets) ||
        !Array.isArray(parsed.items) ||
        !Array.isArray(parsed.palettes)
      ) {
        throw new Error("Файл не является поддерживаемым проектом SVG Composition Studio");
      }
      applyLoadedProject(parsed);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Не удалось загрузить проект");
    } finally {
      if (projectFileRef.current) projectFileRef.current.value = "";
    }
  }

  function addAsset(asset: LibraryAsset) {
    if (!asset.svg) return;
    const id = crypto.randomUUID();
    const minCanvas = Math.min(format.width, format.height);
    const refUnit = asset.detailLevel === "S" ? 560 : 1120;
    const rawScale = (minCanvas / refUnit) * 0.45;
    const maxScale = Math.min(
      (format.width * 0.55) / Math.max(asset.width, 1),
      (format.height * 0.55) / Math.max(asset.height, 1),
    );
    const minScale = (minCanvas * 0.14) / Math.max(asset.width, asset.height, 1);
    const scale = Number(Math.max(minScale, Math.min(maxScale, rawScale)).toFixed(4));

    // Slight stagger if an item is already right at the center
    const centerCount = items.filter(
      (it) => Math.hypot(it.x - format.width / 2, it.y - format.height / 2) < 90,
    ).length;
    const offset = centerCount * 22;

    const newItem: SceneItem = {
      id,
      assetId: asset.id,
      x: Math.round(format.width / 2 + offset),
      y: Math.round(format.height / 2 + offset),
      scale,
      rotation: 0,
      opacity: asset.role === "background" ? 0.9 : 1,
      visible: true,
    };

    setItems((current) =>
      asset.role === "background" ? [newItem, ...current] : [...current, newItem],
    );
    setSelectedId(id);
    setNotice(
      `Добавлен «${asset.name}» (${asset.detailLevel}, ${asset.role === "background" ? "фоновый монохромный" : "главный цветной"})`,
    );
  }

  function updateSelected(patch: Partial<SceneItem>) {
    if (!selectedId) return;
    setItems((current) =>
      current.map((item) => (item.id === selectedId ? { ...item, ...patch } : item)),
    );
  }

  function centerSelected() {
    if (!selected || !selectedAsset) return;
    updateSelected({ x: Math.round(format.width / 2), y: Math.round(format.height / 2) });
    setNotice(`Объект «${selectedAsset.name}» выровнен по центру холста`);
  }

  function duplicateSelected() {
    if (!selected || !selectedAsset) return;
    const clamped = clampItemToFormat(
      selected.x + 32,
      selected.y + 32,
      selectedAsset,
      selected.scale,
      selected.rotation,
      format,
      0.02,
    );
    const duplicate: SceneItem = {
      ...selected,
      id: crypto.randomUUID(),
      x: Math.round(clamped.x),
      y: Math.round(clamped.y),
    };
    setItems((current) => [...current, duplicate]);
    setSelectedId(duplicate.id);
    setNotice(`Объект «${selectedAsset.name}» продублирован`);
  }

  /**
   * Switches a placed SceneItem between "composition_object" (main colored) and "background" (monochrome).
   * Uses the authentic library counterpart SVG when available, or applies strict monochrome role projection
   * without altering SVG geometry when no separate background file exists (e.g. L Wallet).
   */
  function switchItemRole(itemId: string, nextRole: ComponentRole) {
    const targetItem = items.find((it) => it.id === itemId);
    if (!targetItem) return;
    const currentAsset = assets.find((a) => a.id === targetItem.assetId);
    if (!currentAsset) return;

    const currentRole = effectiveItemRole(targetItem, currentAsset);
    if (currentRole === nextRole) return;

    const counterpart = findCounterpartAsset(
      assets,
      currentAsset,
      currentAsset.detailLevel,
      nextRole,
    );

    if (counterpart) {
      const ratio = currentAsset.width / Math.max(counterpart.width, 1);
      setItems((current) =>
        current.map((it) =>
          it.id === itemId
            ? {
                ...it,
                assetId: counterpart.id,
                roleOverride: undefined,
                scale: Number((it.scale * ratio).toFixed(4)),
                opacity: nextRole === "background" && it.opacity === 1 ? 0.9 : nextRole === "composition_object" && it.opacity === 0.9 ? 1 : it.opacity,
              }
            : it,
        ),
      );
      setNotice(
        `«${counterpart.name}» переключён в режим «${nextRole === "background" ? "Фоновый (монохром)" : "Главный (цветной)"}»`,
      );
    } else {
      // No separate file in library (e.g. L Wallet background, or user-imported SVG)
      setItems((current) =>
        current.map((it) =>
          it.id === itemId
            ? {
                ...it,
                roleOverride: nextRole === currentAsset.role ? undefined : nextRole,
                opacity: nextRole === "background" && it.opacity === 1 ? 0.9 : nextRole === "composition_object" && it.opacity === 0.9 ? 1 : it.opacity,
              }
            : it,
        ),
      );
      setNotice(
        nextRole === "background"
          ? `Для «${currentAsset.name}» (${currentAsset.detailLevel}) нет отдельного фонового файла — применён монохромный фоновый режим к оригинальному вектору`
          : `«${currentAsset.name}» переключён в режим «Главный объект»`,
      );
    }
  }

  /**
   * Switches composition detail level between L and S:
   * - Replaces every library asset with its exact L/S counterpart, preventing incompatible detail mixing.
   * - Adjusts `scale` proportionally (`oldWidth / newWidth`) so visual size and composition balance remain identical!
   * - Handles L Wallet background gracefully via L vector + monochrome background role projection.
   */
  function changeDetail(nextDetail: DetailLevel) {
    if (nextDetail === detail) return;
    const notes: string[] = [];

    const updatedItems = items.map((item) => {
      const currentAsset = assets.find((asset) => asset.id === item.assetId);
      if (!currentAsset || currentAsset.detailLevel === nextDetail) return item;

      const role = effectiveItemRole(item, currentAsset);
      const exactCounterpart = findCounterpartAsset(assets, currentAsset, nextDetail, role);
      if (exactCounterpart) {
        const scaleRatio = currentAsset.width / Math.max(exactCounterpart.width, 1);
        return {
          ...item,
          assetId: exactCounterpart.id,
          roleOverride: undefined,
          scale: Number((item.scale * scaleRatio).toFixed(4)),
        };
      }

      // Check opposite-role counterpart in target detail (specifically L Wallet when in background mode)
      if (role === "background") {
        const mainCounterpart = findCounterpartAsset(
          assets,
          currentAsset,
          nextDetail,
          "composition_object",
        );
        if (mainCounterpart) {
          const scaleRatio = currentAsset.width / Math.max(mainCounterpart.width, 1);
          notes.push(`«${currentAsset.name}» (${nextDetail}, монохромный режим)`);
          return {
            ...item,
            assetId: mainCounterpart.id,
            roleOverride: "background" as ComponentRole,
            scale: Number((item.scale * scaleRatio).toFixed(4)),
          };
        }
      }

      notes.push(`«${currentAsset.name}» (нет варианта ${nextDetail})`);
      return item;
    });

    // Also keep Scenario 2 pickedAssetIds synced to the new detail level!
    setPickedAssetIds((prevIds) =>
      prevIds.flatMap((id) => {
        const cur = assets.find((a) => a.id === id);
        if (!cur) return [];
        const cp =
          findCounterpartAsset(assets, cur, nextDetail, cur.role) ??
          findCounterpartAsset(assets, cur, nextDetail, "composition_object");
        return cp ? [cp.id] : [];
      }),
    );

    setItems(updatedItems);
    setDetail(nextDetail);
    setNotice(
      notes.length > 0
        ? `Детализация ${nextDetail}: обновлены объекты (особые случаи: ${[...new Set(notes)].join(", ")})`
        : `Выбрана детализация ${nextDetail}: все объекты композиции переключены с сохранением пропорций`,
    );
  }

  function scenePoint(event: ReactPointerEvent) {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };
    return {
      x: ((event.clientX - rect.left) / rect.width) * format.width,
      y: ((event.clientY - rect.top) / rect.height) * format.height,
    };
  }

  function startMoveDrag(event: ReactPointerEvent, item: SceneItem) {
    event.stopPropagation();
    const point = scenePoint(event);
    dragRef.current = {
      kind: "move",
      id: item.id,
      offsetX: item.x - point.x,
      offsetY: item.y - point.y,
    };
    setSelectedId(item.id);
    canvasRef.current?.setPointerCapture(event.pointerId);
  }

  function startScaleDrag(event: ReactPointerEvent, item: SceneItem, asset: LibraryAsset) {
    event.stopPropagation();
    const baseRadius = Math.max(1, Math.hypot(asset.width / 2, asset.height / 2));
    dragRef.current = { kind: "scale", id: item.id, baseRadius };
    setSelectedId(item.id);
    canvasRef.current?.setPointerCapture(event.pointerId);
  }

  function startRotateDrag(event: ReactPointerEvent, item: SceneItem) {
    event.stopPropagation();
    dragRef.current = { kind: "rotate", id: item.id };
    setSelectedId(item.id);
    canvasRef.current?.setPointerCapture(event.pointerId);
  }

  function onCanvasPointerMove(event: ReactPointerEvent) {
    const drag = dragRef.current;
    if (!drag) return;
    const point = scenePoint(event);

    if (drag.kind === "move") {
      setItems((current) =>
        current.map((item) => {
          if (item.id !== drag.id) return item;
          const asset = assets.find((a) => a.id === item.assetId);
          const rawX = point.x + drag.offsetX;
          const rawY = point.y + drag.offsetY;
          // Soft guardrails: keep at least a grabbable edge inside the artboard
          const reachX = asset ? Math.min(80, (asset.width * item.scale) / 2) : 40;
          const reachY = asset ? Math.min(80, (asset.height * item.scale) / 2) : 40;
          const clampedX = Math.max(-reachX, Math.min(format.width + reachX, rawX));
          const clampedY = Math.max(-reachY, Math.min(format.height + reachY, rawY));
          return { ...item, x: Math.round(clampedX), y: Math.round(clampedY) };
        }),
      );
    } else if (drag.kind === "scale") {
      setItems((current) =>
        current.map((item) => {
          if (item.id !== drag.id) return item;
          const dist = Math.hypot(point.x - item.x, point.y - item.y);
          const nextScale = Math.max(0.08, Math.min(3.5, dist / drag.baseRadius));
          return { ...item, scale: Number(nextScale.toFixed(3)) };
        }),
      );
    } else if (drag.kind === "rotate") {
      setItems((current) =>
        current.map((item) => {
          if (item.id !== drag.id) return item;
          let angle = (Math.atan2(point.y - item.y, point.x - item.x) * 180) / Math.PI + 90;
          if (angle > 180) angle -= 360;
          if (angle < -180) angle += 360;
          if (event.shiftKey) angle = Math.round(angle / 15) * 15;
          return { ...item, rotation: Math.round(angle) };
        }),
      );
    }
  }

  function stopCanvasDrag(event: ReactPointerEvent) {
    dragRef.current = undefined;
    if (canvasRef.current?.hasPointerCapture(event.pointerId)) {
      canvasRef.current.releasePointerCapture(event.pointerId);
    }
  }

  function moveLayer(id: string, action: "up" | "down" | "top" | "bottom") {
    setItems((current) => {
      const index = current.findIndex((item) => item.id === id);
      if (index < 0) return current;
      const copy = [...current];
      if (action === "up" && index < copy.length - 1) {
        [copy[index], copy[index + 1]] = [copy[index + 1], copy[index]];
      } else if (action === "down" && index > 0) {
        [copy[index], copy[index - 1]] = [copy[index - 1], copy[index]];
      } else if (action === "top" && index < copy.length - 1) {
        const [picked] = copy.splice(index, 1);
        copy.push(picked);
      } else if (action === "bottom" && index > 0) {
        const [picked] = copy.splice(index, 1);
        copy.unshift(picked);
      }
      return copy;
    });
  }

  function toggleVisibility(id: string) {
    setItems((current) =>
      current.map((item) => (item.id === id ? { ...item, visible: !item.visible } : item)),
    );
  }

  function recomposeCurrentItems() {
    const visibleSpecs = items
      .filter((it) => it.visible)
      .map((it) => {
        const asset = assets.find((a) => a.id === it.assetId);
        return asset ? { asset, roleOverride: it.roleOverride } : undefined;
      })
      .filter((spec): spec is { asset: LibraryAsset; roleOverride: ComponentRole | undefined } =>
        Boolean(spec),
      );

    if (visibleSpecs.length === 0) {
      setNotice("На холсте нет видимых объектов для перекомпоновки");
      return;
    }

    const nextVariant = layoutVariant + 1;
    setLayoutVariant(nextVariant);
    const recomposed = composeScene(visibleSpecs, format, nextVariant);
    setItems(recomposed);
    setSelectedId(recomposed[recomposed.length - 1]?.id);
    const styleNames = ["Сбалансированная", "Фокусная", "Диагональная", "Арочная"];
    setNotice(
      `Перекомпоновано (${styleNames[nextVariant % styleNames.length]} схема · ${recomposed.length} объектов)`,
    );
  }

  async function runMetaphorComposition(overridePrompt?: string) {
    const prompt = (overridePrompt ?? composePrompt).trim();
    if (!prompt) {
      setNotice("Введите тему, заголовок или метафору для сборки композиции");
      return;
    }
    if (overridePrompt !== undefined) setComposePrompt(overridePrompt);

    setAiWarning(undefined);
    setMissingComponentNames([]);
    setCompositionNotes([]);

    let chosenSuggestions: ComponentSuggestion[] = [];
    let summary = "";
    let usedExternal = false;

    if (aiService) {
      const result = await aiService.generateComposition(prompt, detailAssets, detail, {
        preferExternal: aiAvailable,
        includeBackgrounds,
      });
      chosenSuggestions = result.suggestions;
      summary = result.themeSummary;
      usedExternal = result.usedExternal;
      if (result.error) setAiWarning(result.error.message);
    } else {
      const local = new LocalComponentRecommender();
      const res = local.recommendWithSummary(prompt, detailAssets, detail, includeBackgrounds);
      chosenSuggestions = res.suggestions;
      summary = res.themeSummary;
    }

    setSuggestions(chosenSuggestions);
    setThemeSummary(summary);

    if (chosenSuggestions.length === 0) {
      setNotice(
        `По запросу «${prompt}» подходящие компоненты в библиотеке не найдены. Уточните метафору или выберите объекты вручную.`,
      );
      return;
    }

    const composed = composeScene(
      chosenSuggestions.map((s) => ({ asset: s.asset, roleOverride: s.roleOverride })),
      format,
      0,
    );
    setLayoutVariant(0);
    setItems(composed);
    setSelectedId(composed[composed.length - 1]?.id);
    setNotice(
      `${usedExternal ? "AI" : "Семантический подбор"}: собрана композиция из ${composed.length} объектов (${detail})`,
    );
  }

  function runComponentsComposition() {
    setAiWarning(undefined);
    const specs: Array<{ asset: LibraryAsset; roleOverride?: ComponentRole }> = [];
    let notFoundList: string[] = [];
    let notesList: string[] = [];

    // 1. Parse text names if entered (Scenario 2: user enters names of desired objects)
    if (componentsTextInput.trim()) {
      const resolved = resolveComponentsByNames(componentsTextInput, assets, detail);
      notFoundList = resolved.notFound;
      notesList = resolved.notices;
      for (const m of resolved.matched) {
        specs.push({ asset: m.asset, roleOverride: m.roleOverride });
      }
    }

    // 2. Also include any explicitly toggled chips from the picker (avoiding exact duplicate assetIds unless typed multiple times)
    for (const id of pickedAssetIds) {
      const asset = detailAssets.find((a) => a.id === id);
      if (asset && !specs.some((s) => s.asset.id === asset.id && !s.roleOverride)) {
        specs.push({ asset });
      }
    }

    setMissingComponentNames(notFoundList);
    setCompositionNotes(notesList);

    if (specs.length === 0) {
      if (notFoundList.length > 0) {
        setNotice(
          `Компоненты не найдены в библиотеке: ${notFoundList.join(", ")}. Замена не создавалась.`,
        );
      } else {
        setNotice("Введите названия компонентов через запятую или отметьте их в списке");
      }
      return;
    }

    const composed = composeScene(specs, format, 0);
    setLayoutVariant(0);
    setItems(composed);
    setSelectedId(composed[composed.length - 1]?.id);

    if (notFoundList.length > 0) {
      setNotice(
        `Собрано из ${composed.length} найденных объектов. Не найдены (пропущены без замены): ${notFoundList.join(", ")}`,
      );
    } else {
      setNotice(`Композиция собрана из ${composed.length} выбранных компонентов (${detail})`);
    }
  }

  function togglePickedAsset(assetId: string) {
    setPickedAssetIds((current) =>
      current.includes(assetId) ? current.filter((id) => id !== assetId) : [...current, assetId],
    );
  }

  function addCustomPalette() {
    const baseRoles: RoleColorMap = activePalette?.roles
      ? { ...activePalette.roles }
      : {
          bgStroke: SOURCE_ROLE_COLORS.bgStroke,
          bgFill: SOURCE_ROLE_COLORS.bgFill,
          bgMid: SOURCE_ROLE_COLORS.bgMid,
          accentPrimary: SOURCE_ROLE_COLORS.accentPrimary,
          accentSecondary: SOURCE_ROLE_COLORS.accentSecondary,
          accentSoft: SOURCE_ROLE_COLORS.accentSoft,
          ink: SOURCE_ROLE_COLORS.ink,
          surface: SOURCE_ROLE_COLORS.surface,
        };

    const customCount = palettes.filter((p) => !p.preset).length + 1;
    const created = buildPaletteFromRoles(
      {
        id: `custom-${crypto.randomUUID()}`,
        name: `Пользовательская схема ${customCount}`,
        description: "Расширяемая ролевая цветовая схема",
        preset: false,
      },
      baseRoles,
    );
    setPalettes((current) => [...current, created]);
    setActivePaletteId(created.id);
    setPaletteWarning(undefined);
    setNotice(`Создана новая цветовая схема «${created.name}»`);
  }

  function updateActivePaletteRole(roleKey: keyof RoleColorMap, nextHex: string) {
    if (!activePalette || activePalette.preset) return;
    const currentRoles: RoleColorMap = activePalette.roles ?? {
      bgStroke: SOURCE_ROLE_COLORS.bgStroke,
      bgFill: SOURCE_ROLE_COLORS.bgFill,
      bgMid: SOURCE_ROLE_COLORS.bgMid,
      accentPrimary: SOURCE_ROLE_COLORS.accentPrimary,
      accentSecondary: SOURCE_ROLE_COLORS.accentSecondary,
      accentSoft: SOURCE_ROLE_COLORS.accentSoft,
      ink: SOURCE_ROLE_COLORS.ink,
      surface: SOURCE_ROLE_COLORS.surface,
    };

    const isBgRole = roleKey === "bgStroke" || roleKey === "bgFill" || roleKey === "bgMid";
    if (isBgRole) {
      const mainAccents = [
        currentRoles.accentPrimary,
        currentRoles.accentSecondary,
        currentRoles.accentSoft,
      ].map(normalizeColor);
      if (mainAccents.includes(normalizeColor(nextHex))) {
        setPaletteWarning(
          "Нарушение правила палитры: цвета главных объектов запрещено назначать фоновым объектам!",
        );
        return;
      }
    }

    setPaletteWarning(undefined);
    const updatedRoles = { ...currentRoles, [roleKey]: nextHex };
    const rebuilt = buildPaletteFromRoles(
      {
        id: activePalette.id,
        name: activePalette.name,
        description: activePalette.description,
        preset: false,
      },
      updatedRoles,
    );

    setPalettes((current) =>
      current.map((p) => (p.id === activePalette.id ? rebuilt : p)),
    );
  }

  function addDirectColorPair() {
    if (!activePalette || activePalette.preset) return;
    const from = customFromColor.trim();
    const to = customToColor.trim();
    if (!CSS.supports("color", from) || !CSS.supports("color", to)) {
      setPaletteWarning("Укажите корректные CSS/HEX значения цветов");
      return;
    }
    if (
      (normalizeColor(from) === SOURCE_ROLE_COLORS.bgStroke ||
        normalizeColor(from) === SOURCE_ROLE_COLORS.bgFill) &&
      isForbiddenMainColorInBackground(to, activePalette)
    ) {
      setPaletteWarning("Запрещено использовать акцентный цвет главных объектов в фоне!");
      return;
    }
    setPaletteWarning(undefined);
    setPalettes((current) =>
      current.map((p) =>
        p.id === activePalette.id
          ? { ...p, colors: { ...p.colors, [normalizeColor(from)]: to } }
          : p,
      ),
    );
  }

  function deleteActiveCustomPalette() {
    if (!activePalette || activePalette.preset) return;
    const deletedName = activePalette.name;
    setPalettes((current) => current.filter((p) => p.id !== activePalette.id));
    setActivePaletteId(DEFAULT_PALETTE_ID);
    setPaletteWarning(undefined);
    setNotice(`Удалена схема «${deletedName}»`);
  }

  function exportSvg() {
    try {
      const visibleCount = items.filter((it) => it.visible).length;
      if (visibleCount === 0) {
        setNotice("На холсте нет видимых объектов для экспорта");
        return;
      }
      const svg = buildExportCompositionSvg({
        items,
        assets,
        format,
        activePalette,
      });
      const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `composition-${detail}-${format.id}.svg`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice(
        `SVG экспортирован (${visibleCount} слоёв, ${format.width}×${format.height}px): сохранены векторные контуры и редактируемые группы`,
      );
    } catch (error) {
      setNotice(
        error instanceof Error
          ? `Не удалось экспортировать SVG: ${error.message}`
          : "Не удалось экспортировать SVG",
      );
    }
  }

  // Selection frame metrics in artboard coordinate space
  const selectionBox = useMemo(() => {
    if (!selected || !selectedAsset || !selected.visible) return undefined;
    const w = selectedAsset.width * selected.scale;
    const h = selectedAsset.height * selected.scale;
    return { w, h, halfW: w / 2, halfH: h / 2 };
  }, [selected, selectedAsset]);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">✦</span>
          <span>SVG Composition Studio</span>
          <small>vector constructor</small>
        </div>

        <div className="top-notice" title={notice}>
          <span className="status-dot" />
          <span className="notice-text">{notice}</span>
        </div>

        <div className="top-actions">
          <button
            className="secondary top-project"
            onClick={() =>
              downloadProject(
                snapshotProject(assets, items, palettes, format, detail, activePaletteId, true),
              )
            }
          >
            Сохранить JSON
          </button>
          <button className="secondary top-project" onClick={() => projectFileRef.current?.click()}>
            Открыть JSON
          </button>
          <button className="primary" onClick={exportSvg}>
            Экспорт SVG
          </button>
          <input
            ref={projectFileRef}
            hidden
            type="file"
            accept=".json,application/json"
            onChange={(event) => void importProject(event.target.files)}
          />
        </div>
      </header>

      <div className="workspace">
        {/* LEFT PANEL: SVG COMPONENT LIBRARY */}
        <aside className="sidebar left-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">
                БИБЛИОТЕКА · РАЗМЕР {detail} · {visibleAssets.length} ИЗ {detailAssets.length}
              </span>
              <h2>Компоненты</h2>
            </div>
            <button
              className="icon-button"
              onClick={() => fileRef.current?.click()}
              title="Импортировать дополнительные SVG или ZIP"
            >
              ＋
            </button>
            <input
              ref={fileRef}
              hidden
              type="file"
              accept=".svg,.zip"
              multiple
              onChange={(event) => {
                void onImport(event.target.files);
                event.target.value = "";
              }}
            />
          </div>

          <div
            className="import-box"
            onClick={() => fileRef.current?.click()}
            onDragOver={(event) => event.preventDefault()}
            onDrop={onDropFiles}
          >
            <div className="upload-icon">↥</div>
            <div>
              <strong>Дополнительный импорт</strong>
              <span>SVG или ZIP · геометрия сохраняется 1:1</span>
            </div>
          </div>

          <div className="search">
            <span>⌕</span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Поиск по названию или смыслу…"
            />
            {search && (
              <button className="clear-btn" onClick={() => setSearch("")} title="Очистить поиск">
                ×
              </button>
            )}
          </div>

          <div className="role-filter">
            <button
              className={roleFilter === "all" ? "active" : ""}
              onClick={() => setRoleFilter("all")}
            >
              Все ({detailAssets.length})
            </button>
            <button
              className={roleFilter === "composition_object" ? "active" : ""}
              onClick={() => setRoleFilter("composition_object")}
            >
              Главные ({detailAssets.filter((a) => a.role === "composition_object").length})
            </button>
            <button
              className={roleFilter === "background" ? "active" : ""}
              onClick={() => setRoleFilter("background")}
            >
              Фоновые ({detailAssets.filter((a) => a.role === "background").length})
            </button>
          </div>

          <div className="library-list">
            {visibleAssets.map((asset) => (
              <button
                className="asset-row"
                key={asset.id}
                onClick={() => addAsset(asset)}
                title={`${asset.description}\nИсточник: ${asset.sourceIllustration}`}
              >
                <span
                  className="asset-thumb"
                  dangerouslySetInnerHTML={{
                    __html: svgInnerMarkup(asset.svg, activePalette, asset.role, `lib_${asset.id}`),
                  }}
                />
                <span className="asset-info">
                  <strong>{asset.name}</strong>
                  <small>
                    <span
                      className={`role-dot ${asset.role === "background" ? "bg" : "main"}`}
                    />
                    {asset.detailLevel} ·{" "}
                    {asset.role === "background" ? "Фоновый (монохром)" : "Главный (цветной)"}
                  </small>
                </span>
                <span className="asset-detail">＋</span>
              </button>
            ))}
          </div>

          {visibleAssets.length === 0 && (
            <div className="library-note">
              По текущему фильтру компоненты не найдены. Попробуйте сбросить поиск или категорию.
            </div>
          )}
        </aside>

        {/* CENTER AREA: INTERACTIVE VECTOR CANVAS */}
        <main className="canvas-area">
          <div className="canvas-toolbar">
            <div className="toolbar-group">
              <div className="segmented" title="Переключение детализации L / S для всей композиции">
                <span>Размер</span>
                {(["L", "S"] as DetailLevel[]).map((level) => (
                  <button
                    className={detail === level ? "active" : ""}
                    key={level}
                    onClick={() => changeDetail(level)}
                  >
                    {level === "L" ? "L · Детальный" : "S · Компактный"}
                  </button>
                ))}
              </div>

              <div className="format-select">
                <span>Формат</span>
                {FORMATS.map((option) => (
                  <button
                    className={format.id === option.id ? "active" : ""}
                    key={option.id}
                    onClick={() => setFormat(option)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="toolbar-actions">
              <button
                className="secondary"
                disabled={items.filter((i) => i.visible).length === 0}
                onClick={recomposeCurrentItems}
                title="Автоматически сбалансировать текущие объекты на холсте"
              >
                ↻ Перекомпоновать
              </button>
              <button
                className="secondary danger-text"
                disabled={items.length === 0}
                onClick={() => {
                  setItems([]);
                  setSelectedId(undefined);
                  setNotice("Холст очищен");
                }}
                title="Удалить все объекты с холста"
              >
                Очистить
              </button>
            </div>
          </div>

          <div
            className="canvas-stage"
            onPointerDown={(e) => {
              if (e.target === e.currentTarget) setSelectedId(undefined);
            }}
          >
            <div className="canvas-ruler top">
              <span>0</span>
              <span>{Math.round(format.width / 2)} px</span>
              <b>{format.width} px</b>
            </div>
            <div className="canvas-ruler side">
              <span>0</span>
              <span>{Math.round(format.height / 2)} px</span>
              <b>{format.height} px</b>
            </div>

            <div
              className="artboard"
              style={{ aspectRatio: `${format.width}/${format.height}` }}
            >
              <svg
                ref={canvasRef}
                viewBox={`0 0 ${format.width} ${format.height}`}
                onPointerMove={onCanvasPointerMove}
                onPointerUp={stopCanvasDrag}
                onPointerCancel={stopCanvasDrag}
                onPointerDown={(e) => {
                  if (e.target === e.currentTarget) setSelectedId(undefined);
                }}
              >
                <rect
                  width={format.width}
                  height={format.height}
                  fill="#FFFFFF"
                  onPointerDown={() => setSelectedId(undefined)}
                />

                {items.map((item) => {
                  const asset = assets.find((candidate) => candidate.id === item.assetId);
                  if (!asset?.svg || !item.visible) return null;
                  const role = effectiveItemRole(item, asset);
                  return (
                    <g
                      key={item.id}
                      onPointerDown={(event) => startMoveDrag(event, item)}
                      className={item.id === selectedId ? "scene-item selected" : "scene-item"}
                      transform={`translate(${item.x} ${item.y}) rotate(${item.rotation}) scale(${item.scale}) translate(${-asset.width / 2} ${-asset.height / 2})`}
                      opacity={item.opacity}
                    >
                      <rect
                        x={0}
                        y={0}
                        width={asset.width}
                        height={asset.height}
                        fill="transparent"
                      />
                      <g
                        dangerouslySetInnerHTML={{
                          __html: svgInnerMarkup(
                            asset.svg,
                            activePalette,
                            role,
                            `canvas_${item.id.slice(0, 8)}`,
                          ),
                        }}
                      />
                    </g>
                  );
                })}

                {/* Vector bounding box with proportional corner scale handles & rotation handle */}
                {selected && selectedAsset && selectionBox && (
                  <g
                    className="selection-overlay"
                    transform={`translate(${selected.x} ${selected.y}) rotate(${selected.rotation})`}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <rect
                      x={-selectionBox.halfW}
                      y={-selectionBox.halfH}
                      width={selectionBox.w}
                      height={selectionBox.h}
                      fill="none"
                      stroke="#ed6d47"
                      strokeWidth={2}
                      strokeDasharray="6 4"
                      pointerEvents="none"
                    />
                    {/* Rotation stem & handle */}
                    <line
                      x1={0}
                      y1={-selectionBox.halfH}
                      x2={0}
                      y2={-selectionBox.halfH - 28}
                      stroke="#ed6d47"
                      strokeWidth={2}
                      pointerEvents="none"
                    />
                    <circle
                      cx={0}
                      cy={-selectionBox.halfH - 28}
                      r={8}
                      fill="#ffffff"
                      stroke="#ed6d47"
                      strokeWidth={2.5}
                      className="rotate-handle"
                      onPointerDown={(e) => startRotateDrag(e, selected)}
                    />
                    {/* 4 Corner handles for proportional scaling */}
                    {(
                      [
                        [-selectionBox.halfW, -selectionBox.halfH],
                        [selectionBox.halfW, -selectionBox.halfH],
                        [-selectionBox.halfW, selectionBox.halfH],
                        [selectionBox.halfW, selectionBox.halfH],
                      ] as Array<[number, number]>
                    ).map(([hx, hy], idx) => (
                      <rect
                        key={idx}
                        x={hx - 7}
                        y={hy - 7}
                        width={14}
                        height={14}
                        rx={3}
                        fill="#ffffff"
                        stroke="#ed6d47"
                        strokeWidth={2.5}
                        className="scale-handle"
                        onPointerDown={(e) => startScaleDrag(e, selected, selectedAsset)}
                      />
                    ))}
                  </g>
                )}
              </svg>

              {items.filter(
                (item) => item.visible && assets.some((asset) => asset.id === item.assetId),
              ).length === 0 && (
                <div className="empty-canvas">
                  <span>✦</span>
                  <strong>Соберите векторную иллюстрацию</strong>
                  <small>
                    Введите метафору справа, перечислите нужные объекты или добавьте SVG из
                    библиотеки слева
                  </small>
                </div>
              )}
            </div>
          </div>

          <div className="canvas-footer">
            <span>
              Слоёв: {items.length} (видимых: {items.filter((i) => i.visible).length}) · Размер{" "}
              {detail} · Палитра: {activePalette?.name ?? "Исходные цвета"}
            </span>
            <span>
              {format.label} · {format.width} × {format.height} px
            </span>
          </div>
        </main>

        {/* RIGHT PANEL: AUTO-COMPOSITION, COLOR SCHEMES, INSPECTOR, LAYERS */}
        <aside className="sidebar right-panel">
          {/* 1. SMART AUTO-COMPOSITION */}
          <section className="compose-section">
            <div className="section-title">
              <h3>Автосборка композиции</h3>
              <span className={`badge ${aiAvailable ? "badge-ai" : ""}`}>
                {aiAvailable ? "AI + СЕМАНТИКА" : "СЕМАНТИКА"}
              </span>
            </div>

            <div className="mode-selector">
              <button
                className={compositionMode === "metaphor" ? "active" : ""}
                onClick={() => setCompositionMode("metaphor")}
              >
                По метафоре
              </button>
              <button
                className={compositionMode === "components" ? "active" : ""}
                onClick={() => setCompositionMode("components")}
              >
                По компонентам
              </button>
            </div>

            {compositionMode === "metaphor" ? (
              <div className="compose-box">
                <input
                  className="text-input"
                  value={composePrompt}
                  onChange={(e) => setComposePrompt(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && composePrompt.trim()) {
                      void runMetaphorComposition();
                    }
                  }}
                  placeholder="Например: Цифровая трансформация бизнеса"
                />

                <div className="preset-chips">
                  {METAPHOR_PRESETS.map((preset) => (
                    <button
                      key={preset}
                      className="chip"
                      onClick={() => void runMetaphorComposition(preset)}
                      title="Нажмите для мгновенной сборки по этой метафоре"
                    >
                      {preset}
                    </button>
                  ))}
                </div>

                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={includeBackgrounds}
                    onChange={(e) => setIncludeBackgrounds(e.target.checked)}
                  />
                  <span>Добавлять монохромные фоновые объекты</span>
                </label>

                {aiWarning && <div className="inline-note">{aiWarning}</div>}

                <div className="compose-buttons">
                  <button
                    className="primary full"
                    disabled={!composePrompt.trim()}
                    onClick={() => void runMetaphorComposition()}
                  >
                    Собрать композицию
                  </button>
                </div>

                {suggestions.length > 0 && (
                  <div className="suggestions">
                    {themeSummary && <div className="theme-caption">{themeSummary}</div>}
                    {suggestions.map((s, idx) => {
                      const effRole = s.roleOverride ?? s.asset.role;
                      return (
                        <div className="suggestion" key={`${s.asset.id}-${idx}`}>
                          <span className="suggestion-head">
                            <span
                              className={`role-dot ${effRole === "background" ? "bg" : "main"}`}
                            />
                            <strong>{s.asset.name}</strong>
                            <small>{effRole === "background" ? "фон" : "главный"}</small>
                          </span>
                          <small className="suggestion-reason">{s.reason}</small>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : (
              <div className="compose-box">
                <label className="field-label">
                  Названия компонентов через запятую:
                  <input
                    className="text-input"
                    value={componentsTextInput}
                    onChange={(e) => setComponentsTextInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") runComponentsComposition();
                    }}
                    placeholder="Книга, Лампа, Папка (фон)…"
                  />
                </label>

                <div className="field-label">Или отметьте объекты библиотеки ({detail}):</div>
                <div className="component-picker-list">
                  {detailAssets.map((asset) => {
                    const checked = pickedAssetIds.includes(asset.id);
                    return (
                      <button
                        type="button"
                        key={asset.id}
                        className={`picker-item ${checked ? "checked" : ""}`}
                        onClick={() => togglePickedAsset(asset.id)}
                      >
                        <span className="picker-check">{checked ? "✓" : ""}</span>
                        <span className="picker-name">{asset.name}</span>
                        <small className={asset.role === "background" ? "tag-bg" : "tag-main"}>
                          {asset.role === "background" ? "фон" : "главный"}
                        </small>
                      </button>
                    );
                  })}
                </div>

                {missingComponentNames.length > 0 && (
                  <div className="warning-box">
                    <strong>Не найдены в библиотеке (без замены):</strong>{" "}
                    {missingComponentNames.join(", ")}
                  </div>
                )}

                {compositionNotes.map((note, idx) => (
                  <div className="inline-note" key={idx}>
                    {note}
                  </div>
                ))}

                <div className="compose-buttons">
                  <button
                    className="primary full"
                    disabled={!componentsTextInput.trim() && pickedAssetIds.length === 0}
                    onClick={runComponentsComposition}
                  >
                    Собрать из выбранных
                  </button>
                  {pickedAssetIds.length > 0 && (
                    <button className="secondary" onClick={() => setPickedAssetIds([])}>
                      Сбросить ({pickedAssetIds.length})
                    </button>
                  )}
                </div>
              </div>
            )}
          </section>

          {/* 2. COLOR SCHEMES */}
          <section className="palette-section">
            <div className="section-title">
              <h3>Цветовые схемы</h3>
              <button onClick={addCustomPalette} title="Добавить новую цветовую схему">
                ＋
              </button>
            </div>

            <div className="palette-cards">
              {palettes.map((palette) => {
                const isActive = palette.id === activePaletteId;
                const roles = palette.roles;
                return (
                  <button
                    type="button"
                    key={palette.id}
                    className={`palette-card ${isActive ? "active" : ""}`}
                    onClick={() => {
                      setActivePaletteId(palette.id);
                      setPaletteWarning(undefined);
                      setNotice(`Применена цветовая схема «${palette.name}»`);
                    }}
                  >
                    <div className="palette-card-info">
                      <strong>
                        {palette.preset ? "★ " : ""}
                        {palette.name}
                      </strong>
                      {roles && (
                        <small>
                          Главные + монохром фона
                        </small>
                      )}
                    </div>
                    {roles && (
                      <div className="swatch-group" title="Акценты главных объектов | Монохром фона">
                        <span className="swatch" style={{ background: roles.accentPrimary }} />
                        <span className="swatch" style={{ background: roles.accentSecondary }} />
                        <span className="swatch" style={{ background: roles.accentSoft }} />
                        <span className="swatch-divider" />
                        <span className="swatch" style={{ background: roles.bgStroke }} />
                        <span className="swatch" style={{ background: roles.bgFill }} />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>

            {activePalette && !activePalette.preset && (
              <div className="custom-palette-editor">
                <div className="custom-palette-header">
                  <input
                    className="text-input"
                    value={activePalette.name}
                    onChange={(e) =>
                      setPalettes((cur) =>
                        cur.map((p) =>
                          p.id === activePalette.id ? { ...p, name: e.target.value } : p,
                        ),
                      )
                    }
                    placeholder="Название схемы"
                  />
                  <button
                    className="secondary danger-text"
                    onClick={deleteActiveCustomPalette}
                    title="Удалить пользовательскую схему"
                  >
                    Удалить
                  </button>
                </div>

                {activePalette.roles && (
                  <>
                    <div className="role-group-label">Цвета главных объектов (запрещены в фоне):</div>
                    <div className="color-role-grid">
                      <label>
                        <input
                          type="color"
                          value={normalizeColor(activePalette.roles.accentPrimary)}
                          onChange={(e) => updateActivePaletteRole("accentPrimary", e.target.value)}
                        />
                        <span>Акцент 1</span>
                      </label>
                      <label>
                        <input
                          type="color"
                          value={normalizeColor(activePalette.roles.accentSecondary)}
                          onChange={(e) =>
                            updateActivePaletteRole("accentSecondary", e.target.value)
                          }
                        />
                        <span>Акцент 2</span>
                      </label>
                      <label>
                        <input
                          type="color"
                          value={normalizeColor(activePalette.roles.accentSoft)}
                          onChange={(e) => updateActivePaletteRole("accentSoft", e.target.value)}
                        />
                        <span>Мягкий</span>
                      </label>
                    </div>

                    <div className="role-group-label">
                      Монохром фоновых объектов (доступны и в главных):
                    </div>
                    <div className="color-role-grid">
                      <label>
                        <input
                          type="color"
                          value={normalizeColor(activePalette.roles.bgStroke)}
                          onChange={(e) => updateActivePaletteRole("bgStroke", e.target.value)}
                        />
                        <span>Контур фона</span>
                      </label>
                      <label>
                        <input
                          type="color"
                          value={normalizeColor(activePalette.roles.bgFill)}
                          onChange={(e) => updateActivePaletteRole("bgFill", e.target.value)}
                        />
                        <span>Заливка фона</span>
                      </label>
                      <label>
                        <input
                          type="color"
                          value={normalizeColor(activePalette.roles.bgMid)}
                          onChange={(e) => updateActivePaletteRole("bgMid", e.target.value)}
                        />
                        <span>Полутон</span>
                      </label>
                    </div>
                  </>
                )}

                <div className="direct-pair-row">
                  <input
                    type="color"
                    value={normalizeColor(customFromColor)}
                    onChange={(e) => setCustomFromColor(e.target.value)}
                    title="Исходный цвет SVG"
                  />
                  <span>→</span>
                  <input
                    type="color"
                    value={normalizeColor(customToColor)}
                    onChange={(e) => setCustomToColor(e.target.value)}
                    title="Целевой цвет"
                  />
                  <button className="secondary" onClick={addDirectColorPair}>
                    + Пара для импорта
                  </button>
                </div>

                {paletteWarning && <div className="warning-box">{paletteWarning}</div>}
              </div>
            )}
          </section>

          {/* 3. SELECTED OBJECT INSPECTOR */}
          <section>
            <div className="section-title">
              <h3>Свойства объекта</h3>
              {selected && <small className="mono-tag">{selectedAsset?.detailLevel}</small>}
            </div>

            {selected && selectedAsset ? (
              <div className="inspector">
                <div className="selected-title">
                  <span
                    className="asset-thumb large"
                    dangerouslySetInnerHTML={{
                      __html: svgInnerMarkup(
                        selectedAsset.svg,
                        activePalette,
                        selectedEffectiveRole,
                        `insp_${selected.id.slice(0, 8)}`,
                      ),
                    }}
                  />
                  <div className="selected-meta">
                    <strong>{selectedAsset.name}</strong>
                    <small>{selectedAsset.sourceIllustration}</small>
                  </div>
                </div>

                {/* Role switcher: Main <-> Background */}
                <div className="role-switcher">
                  <span className="field-label">Роль объекта в композиции:</span>
                  <div className="mode-selector">
                    <button
                      className={selectedEffectiveRole === "composition_object" ? "active" : ""}
                      onClick={() => switchItemRole(selected.id, "composition_object")}
                    >
                      Главный (цветной)
                    </button>
                    <button
                      className={selectedEffectiveRole === "background" ? "active" : ""}
                      onClick={() => switchItemRole(selected.id, "background")}
                    >
                      Фоновый (монохром)
                    </button>
                  </div>
                </div>

                <div className="coord-grid">
                  <label>
                    Центр X
                    <input
                      type="number"
                      value={Math.round(selected.x)}
                      onChange={(event) => updateSelected({ x: Number(event.target.value) })}
                    />
                  </label>
                  <label>
                    Центр Y
                    <input
                      type="number"
                      value={Math.round(selected.y)}
                      onChange={(event) => updateSelected({ y: Number(event.target.value) })}
                    />
                  </label>
                </div>

                <label>
                  Пропорциональный масштаб <output>{selected.scale.toFixed(2)}×</output>
                  <input
                    type="range"
                    min="0.08"
                    max="3"
                    step="0.01"
                    value={selected.scale}
                    onChange={(event) => updateSelected({ scale: Number(event.target.value) })}
                  />
                </label>

                <label>
                  Поворот <output>{Math.round(selected.rotation)}°</output>
                  <input
                    type="range"
                    min="-180"
                    max="180"
                    value={selected.rotation}
                    onChange={(event) => updateSelected({ rotation: Number(event.target.value) })}
                  />
                </label>

                <label>
                  Непрозрачность <output>{Math.round(selected.opacity * 100)}%</output>
                  <input
                    type="range"
                    min="0.1"
                    max="1"
                    step="0.01"
                    value={selected.opacity}
                    onChange={(event) => updateSelected({ opacity: Number(event.target.value) })}
                  />
                </label>

                <div className="inspector-actions">
                  <button onClick={centerSelected} title="Поместить в центр холста">
                    В центр
                  </button>
                  <button onClick={duplicateSelected} title="Дублировать (Ctrl+D)">
                    Копия
                  </button>
                  <button onClick={() => moveLayer(selected.id, "down")} title="На слой ниже">
                    ↓ Ниже
                  </button>
                  <button onClick={() => moveLayer(selected.id, "up")} title="На слой выше">
                    ↑ Выше
                  </button>
                  <button
                    className="danger"
                    onClick={() => {
                      setItems((current) => current.filter((item) => item.id !== selected.id));
                      setSelectedId(undefined);
                      setNotice("Объект удалён");
                    }}
                  >
                    Удалить
                  </button>
                </div>
              </div>
            ) : (
              <div className="empty-inspector">
                Выберите объект на холсте или в слоях
                <br />
                <small>Доступны масштаб за углы, поворот, смена роли Главный/Фоновый и слои</small>
              </div>
            )}
          </section>

          {/* 4. LAYERS MANAGEMENT */}
          <section className="layers-section">
            <div className="section-title">
              <h3>
                Слои <span>{items.length}</span>
              </h3>
              {items.length > 1 && (
                <button
                  onClick={() => setItems((current) => [...current].reverse())}
                  title="Инвертировать порядок слоёв"
                >
                  ⇅
                </button>
              )}
            </div>

            {items.length === 0 ? (
              <div className="empty-layers">Слоёв пока нет</div>
            ) : (
              <div className="layers">
                {[...items].reverse().map((item) => {
                  const asset = assets.find((candidate) => candidate.id === item.assetId);
                  const effRole = asset ? effectiveItemRole(item, asset) : "composition_object";
                  return (
                    <div className="layer-row" key={item.id}>
                      <button
                        className={item.id === selectedId ? "layer active" : "layer"}
                        onClick={() => setSelectedId(item.id)}
                      >
                        <span
                          className={`role-dot ${effRole === "background" ? "bg" : "main"}`}
                          title={effRole === "background" ? "Фоновый объект" : "Главный объект"}
                        />
                        <span className="layer-name">{asset?.name ?? "Недоступный объект"}</span>
                        <small>
                          {effRole === "background" ? "фон" : "главн."} · {asset?.detailLevel}
                        </small>
                      </button>
                      <button
                        className="layer-mini-btn"
                        onClick={() => moveLayer(item.id, "up")}
                        title="Поднять выше"
                      >
                        ↑
                      </button>
                      <button
                        className="layer-mini-btn"
                        onClick={() => moveLayer(item.id, "down")}
                        title="Опустить ниже"
                      >
                        ↓
                      </button>
                      <button
                        className="layer-visibility"
                        onClick={() => toggleVisibility(item.id)}
                        title={item.visible ? "Скрыть слой" : "Показать слой"}
                      >
                        {item.visible ? "◉" : "○"}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
