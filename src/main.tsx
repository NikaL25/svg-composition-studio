import { StrictMode, useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent, PointerEvent as ReactPointerEvent } from "react";
import { createRoot } from "react-dom/client";
import { libraryFileCount, loadLibraryAssets, mergeImportedAssets } from "./catalog";
import { LocalComponentRecommender } from "./ai";
import { importFiles } from "./importer";
import { composeScene } from "./layout";
import { downloadProject, loadProject, saveProject, snapshotProject } from "./project";
import { assetFromSvg, svgInnerMarkup } from "./svg";
import type { CanvasFormat, ComponentRole, DetailLevel, LibraryAsset, Palette, SceneItem } from "./types";
import "./styles.css";

const formats: CanvasFormat[] = [
  { id: "square", label: "Квадрат", width: 1080, height: 1080 },
  { id: "portrait", label: "Портрет", width: 1080, height: 1350 },
  { id: "landscape", label: "Ландшафт", width: 1200, height: 675 },
];
const recommender = new LocalComponentRecommender();

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

function restoreProject(snapshot: ReturnType<typeof loadProject>, library: LibraryAsset[]): RestoredProject | undefined {
  if (!snapshot) return undefined;
  const detail = isDetail(snapshot.detail) ? snapshot.detail : "L";
  const format = formats.find((candidate) => candidate.id === snapshot.format?.id) ?? formats[0];
  const assets = [...library];
  const legacyById = new Map<string, Partial<LibraryAsset>>();

  for (const raw of (snapshot.assets ?? []) as Array<Partial<LibraryAsset> & { detailLevels?: DetailLevel[]; fileName?: string }>) {
    if (!raw || typeof raw.id !== "string" || typeof raw.name !== "string") continue;
    legacyById.set(raw.id, raw);
    if (typeof raw.svg !== "string" || assets.some((asset) => asset.id === raw.id)) continue;
    const sourcePath = typeof raw.sourcePath === "string" ? raw.sourcePath : raw.fileName ?? `project/${raw.name}.svg`;
    const role = isRole(raw.role) ? raw.role : undefined;
    const level = isDetail(raw.detailLevel) ? raw.detailLevel : raw.detailLevels?.find(isDetail) ?? detail;
    assets.push(assetFromSvg(raw.name, raw.svg, sourcePath, {
      id: raw.id,
      role,
      detailLevel: level,
      source: "imported",
    }));
  }

  const missingItems: string[] = [];
  const items = (snapshot.items ?? []).flatMap((item) => {
    if (!item || typeof item.assetId !== "string") return [];
    if (assets.some((asset) => asset.id === item.assetId)) return [item];
    const oldAsset = legacyById.get(item.assetId);
    const replacement = oldAsset && assets.find((asset) =>
      asset.name.toLocaleLowerCase() === oldAsset.name?.toLocaleLowerCase()
      && (!isRole(oldAsset.role) || asset.role === oldAsset.role)
      && asset.detailLevel === detail,
    );
    if (replacement) return [{ ...item, assetId: replacement.id }];
    missingItems.push(oldAsset?.name ?? "Неизвестный объект");
    return [];
  });

  const palettes = Array.isArray(snapshot.palettes) ? snapshot.palettes : [];
  const activePaletteId = palettes.some((palette) => palette.id === snapshot.activePaletteId) ? snapshot.activePaletteId : undefined;
  return { assets, items, palettes, format, detail, activePaletteId, missingItems };
}

function App() {
  const [assets, setAssets] = useState<LibraryAsset[]>([]);
  const [detail, setDetail] = useState<DetailLevel>("L");
  const [format, setFormat] = useState<CanvasFormat>(formats[0]);
  const [items, setItems] = useState<SceneItem[]>([]);
  const [palettes, setPalettes] = useState<Palette[]>([]);
  const [activePaletteId, setActivePaletteId] = useState<string>();
  const [roleFilter, setRoleFilter] = useState<ComponentRole | "all">("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string>();
  const [notice, setNotice] = useState(`Загрузка SVG-библиотеки: ${libraryFileCount} файлов`);
  const [composePrompt, setComposePrompt] = useState("");
  const [suggestions, setSuggestions] = useState<ReturnType<LocalComponentRecommender["recommend"]>>([]);
  const [paletteEntry, setPaletteEntry] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const projectFileRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{ id: string; offsetX: number; offsetY: number }>();
  const activePalette = palettes.find((palette) => palette.id === activePaletteId);
  const visibleAssets = useMemo(() => assets.filter((asset) => asset.svg
    && asset.detailLevel === detail
    && (roleFilter === "all" || asset.role === roleFilter)
    && asset.name.toLocaleLowerCase().includes(search.toLocaleLowerCase())), [assets, detail, roleFilter, search]);
  const selected = items.find((item) => item.id === selectedId);
  const selectedAsset = selected ? assets.find((asset) => asset.id === selected.assetId) : undefined;

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
          setNotice(restored.missingItems.length
            ? `Проект восстановлен; пропущены недоступные объекты: ${[...new Set(restored.missingItems)].join(", ")}`
            : `Проект восстановлен · ${library.length} SVG в библиотеке`);
        } else {
          setAssets(library);
          setNotice(`Загружено SVG-компонентов: ${library.length}`);
        }
        setHydrated(true);
      } catch (error) {
        if (active) setNotice(error instanceof Error ? error.message : "Не удалось загрузить SVG-библиотеку");
      }
    })();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      saveProject(snapshotProject(assets, items, palettes, format, detail, activePaletteId));
    } catch {
      setNotice("Не удалось сохранить проект в локальном хранилище: превышен доступный объём");
    }
  }, [assets, items, palettes, format, detail, activePaletteId, hydrated]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!selectedId || event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLTextAreaElement) return;
      const step = event.shiftKey ? 20 : 5;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "d") {
        event.preventDefault();
        duplicateSelected();
      } else if (event.key === "Delete" || event.key === "Backspace") {
        setItems((current) => current.filter((item) => item.id !== selectedId));
        setSelectedId(undefined);
        event.preventDefault();
      } else if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
        const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
        const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
        setItems((current) => current.map((item) => item.id === selectedId ? { ...item, x: item.x + dx, y: item.y + dy } : item));
        event.preventDefault();
      } else if (event.key.toLowerCase() === "r") {
        setItems((current) => current.map((item) => item.id === selectedId ? { ...item, rotation: item.rotation + 15 } : item));
        event.preventDefault();
      } else if (event.key === "Escape") {
        setSelectedId(undefined);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedId, items, assets]);

  async function onImport(fileList: FileList | null) {
    if (!fileList?.length) return;
    try {
      const imported = await importFiles(fileList, detail);
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
    const restored = restoreProject(snapshot, assets.filter((asset) => asset.source === "library"));
    if (!restored) throw new Error("Файл не является сохранённым проектом SVG Composition Studio");
    setAssets(restored.assets);
    setItems(restored.items);
    setPalettes(restored.palettes);
    setFormat(restored.format);
    setDetail(restored.detail);
    setActivePaletteId(restored.activePaletteId);
    setSelectedId(undefined);
    setSuggestions([]);
    setNotice(restored.missingItems.length
      ? `Проект загружен; пропущены недоступные объекты: ${[...new Set(restored.missingItems)].join(", ")}`
      : "Проект загружен");
  }

  async function importProject(fileList: FileList | null) {
    const file = fileList?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (parsed.version !== 1 || !Array.isArray(parsed.assets) || !Array.isArray(parsed.items) || !Array.isArray(parsed.palettes)) {
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
    setItems((current) => [...current, {
      id,
      assetId: asset.id,
      x: format.width / 2,
      y: format.height / 2,
      scale: Math.min(1, 360 / Math.max(asset.width, asset.height)),
      rotation: 0,
      opacity: 1,
      visible: true,
    }]);
    setSelectedId(id);
    setNotice(`Добавлен объект «${asset.name}» · ${asset.detailLevel} · ${asset.role === "background" ? "фоновый" : "главный"}`);
  }

  function updateSelected(patch: Partial<SceneItem>) {
    if (selectedId) setItems((current) => current.map((item) => item.id === selectedId ? { ...item, ...patch } : item));
  }

  function duplicateSelected() {
    if (!selected) return;
    const duplicate = { ...selected, id: crypto.randomUUID(), x: selected.x + 24, y: selected.y + 24 };
    setItems((current) => [...current, duplicate]);
    setSelectedId(duplicate.id);
    setNotice("Объект продублирован");
  }

  function scenePoint(event: ReactPointerEvent) {
    const rect = canvasRef.current?.getBoundingClientRect();
    return rect ? { x: ((event.clientX - rect.left) / rect.width) * format.width, y: ((event.clientY - rect.top) / rect.height) * format.height } : { x: 0, y: 0 };
  }

  function startDrag(event: ReactPointerEvent, item: SceneItem) {
    event.stopPropagation();
    const point = scenePoint(event);
    dragRef.current = { id: item.id, offsetX: item.x - point.x, offsetY: item.y - point.y };
    setSelectedId(item.id);
    (event.currentTarget as SVGGElement).setPointerCapture(event.pointerId);
  }

  function dragItem(event: ReactPointerEvent) {
    const drag = dragRef.current;
    if (!drag) return;
    const point = scenePoint(event);
    setItems((current) => current.map((item) => item.id === drag.id ? { ...item, x: point.x + drag.offsetX, y: point.y + drag.offsetY } : item));
  }

  function changeDetail(nextDetail: DetailLevel) {
    if (nextDetail === detail) return;
    const missing: string[] = [];
    const replacements = items.map((item) => {
      const currentAsset = assets.find((asset) => asset.id === item.assetId);
      if (!currentAsset || currentAsset.detailLevel === nextDetail) return item;
      const counterpart = assets.find((asset) => asset.name === currentAsset.name && asset.role === currentAsset.role && asset.detailLevel === nextDetail);
      if (!counterpart) {
        missing.push(`${currentAsset.name} (${currentAsset.role === "background" ? "фон" : "главный объект"})`);
        return item;
      }
      return { ...item, assetId: counterpart.id };
    });
    setItems(replacements);
    setDetail(nextDetail);
    setNotice(missing.length
      ? `Для размера ${nextDetail} нет варианта: ${[...new Set(missing)].join(", ")}. Текущие объекты сохранены.`
      : `Выбран размер ${nextDetail}; варианты объектов обновлены`);
  }

  function moveLayer(direction: "up" | "down") {
    if (!selectedId) return;
    setItems((current) => {
      const index = current.findIndex((item) => item.id === selectedId);
      const next = direction === "up" ? index + 1 : index - 1;
      if (index < 0 || next < 0 || next >= current.length) return current;
      const copy = [...current];
      [copy[index], copy[next]] = [copy[next], copy[index]];
      return copy;
    });
  }

  function toggleVisibility(id: string) {
    setItems((current) => current.map((item) => item.id === id ? { ...item, visible: !item.visible } : item));
  }

  function exportSvg() {
    try {
      const body = items.filter((item) => item.visible).map((item) => {
        const asset = assets.find((candidate) => candidate.id === item.assetId);
        if (!asset?.svg) return "";
        const sourceSvg = svgInnerMarkup(asset.svg, activePalette);
        return `<g transform="translate(${item.x} ${item.y}) rotate(${item.rotation}) scale(${item.scale}) translate(${-asset.width / 2} ${-asset.height / 2})" opacity="${item.opacity}">${sourceSvg}</g>`;
      }).join("");
      const svg = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${format.width}" height="${format.height}" viewBox="0 0 ${format.width} ${format.height}"><rect width="100%" height="100%" fill="white"/>${body}</svg>`;
      const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = "composition.svg";
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice("SVG экспортирован: объекты сохранены отдельными группами с исходными векторами");
    } catch (error) {
      setNotice(error instanceof Error ? `Не удалось экспортировать SVG: ${error.message}` : "Не удалось экспортировать SVG");
    }
  }

  function addPalette() {
    const palette: Palette = { id: crypto.randomUUID(), name: `Новая схема ${palettes.length + 1}`, colors: {} };
    setPalettes((current) => [...current, palette]);
    setActivePaletteId(palette.id);
    setPaletteEntry("");
  }

  function updatePalette(patch: Partial<Palette>) {
    if (activePaletteId) setPalettes((current) => current.map((palette) => palette.id === activePaletteId ? { ...palette, ...patch } : palette));
  }

  function updatePaletteEntry(value: string) {
    setPaletteEntry(value);
    if (!activePalette) return;
    const [from, to] = value.split("→").map((part) => part.trim());
    if (!from || !to || !CSS.supports("color", from) || !CSS.supports("color", to)) return;
    updatePalette({ colors: { ...activePalette.colors, [from]: to } });
  }

  function runComposition() {
    const next = recommender.recommend(composePrompt, assets, detail);
    setSuggestions(next);
    if (!next.length) {
      setNotice("Совпадений с доступными SVG нет. Попробуйте название объекта или уточните метафору.");
      return;
    }
    const composition = composeScene(next.map((suggestion) => suggestion.asset), format);
    setItems(composition);
    setSelectedId(composition[0]?.id);
    setNotice(`Композиция собрана локально из ${composition.length} исходных SVG. Её можно вручную изменить или пересобрать.`);
  }

  return <div className="app-shell">
    <header className="topbar">
      <div className="brand"><span className="brand-mark">✦</span><span>SVG Composition Studio</span><small>web editor</small></div>
      <div className="top-actions"><span className="status-dot" />{notice}
        <button className="secondary top-project" onClick={() => downloadProject(snapshotProject(assets, items, palettes, format, detail, activePaletteId))}>Сохранить проект</button>
        <button className="secondary top-project" onClick={() => projectFileRef.current?.click()}>Открыть проект</button>
        <button className="primary" onClick={exportSvg}>Экспорт SVG</button>
        <input ref={projectFileRef} hidden type="file" accept=".json,application/json" onChange={(event) => void importProject(event.target.files)} />
      </div>
    </header>

    <div className="workspace">
      <aside className="sidebar left-panel">
        <div className="panel-heading"><div><span className="eyebrow">LIBRARY · {visibleAssets.length}</span><h2>Компоненты</h2></div>
          <button className="icon-button" onClick={() => fileRef.current?.click()} title="Импортировать дополнительные SVG">＋</button>
          <input ref={fileRef} hidden type="file" accept=".svg,.zip" multiple onChange={(event) => { void onImport(event.target.files); event.target.value = ""; }} />
        </div>
        <div className="import-box" onClick={() => fileRef.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={onDropFiles}>
          <div className="upload-icon">↥</div><div><strong>Дополнительный импорт</strong><span>SVG-файлы или ZIP-архив</span><span>Основная библиотека загружена автоматически</span></div>
        </div>
        <div className="search"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Поиск компонентов" /></div>
        <div className="role-filter">
          <button className={roleFilter === "all" ? "active" : ""} onClick={() => setRoleFilter("all")}>Все</button>
          <button className={roleFilter === "composition_object" ? "active" : ""} onClick={() => setRoleFilter("composition_object")}>Основные</button>
          <button className={roleFilter === "background" ? "active" : ""} onClick={() => setRoleFilter("background")}>Фоновые</button>
        </div>
        <div className="library-list">{visibleAssets.map((asset) => <button className="asset-row ready" key={asset.id} onClick={() => addAsset(asset)} title={`${asset.name} · ${asset.detailLevel}`}>
          <span className="asset-thumb" dangerouslySetInnerHTML={{ __html: svgInnerMarkup(asset.svg, activePalette) }} />
          <span className="asset-info"><strong>{asset.name}</strong><small>{asset.detailLevel} · {asset.role === "background" ? "Фоновый объект" : "Главный объект"}</small></span>
          <span className="asset-detail">＋</span>
        </button>)}</div>
        {visibleAssets.length === 0 && <div className="library-note">Для выбранных фильтров SVG-компоненты не найдены.</div>}
      </aside>

      <main className="canvas-area">
        <div className="canvas-toolbar">
          <div className="segmented"><span>Детализация</span>{(["L", "S"] as DetailLevel[]).map((level) => <button className={detail === level ? "active" : ""} key={level} onClick={() => changeDetail(level)}>{level}</button>)}</div>
          <div className="format-select"><span>Формат</span>{formats.map((option) => <button className={format.id === option.id ? "active" : ""} key={option.id} onClick={() => setFormat(option)}>{option.label}</button>)}</div>
        </div>
        <div className="canvas-stage">
          <div className="canvas-ruler top">0 <span>{format.width / 2}px</span><b>{format.width}px</b></div>
          <div className="canvas-ruler side">0 <span>{format.height / 2}px</span><b>{format.height}px</b></div>
          <div className="artboard" style={{ aspectRatio: `${format.width}/${format.height}` }}>
            <svg ref={canvasRef} viewBox={`0 0 ${format.width} ${format.height}`} onClick={() => setSelectedId(undefined)}>
              {items.map((item) => {
                const asset = assets.find((candidate) => candidate.id === item.assetId);
                if (!asset?.svg || !item.visible) return null;
                return <g key={item.id} onPointerDown={(event) => startDrag(event, item)} onPointerMove={dragItem} onPointerUp={() => { dragRef.current = undefined; }} onPointerCancel={() => { dragRef.current = undefined; }} onClick={(event) => event.stopPropagation()} className={item.id === selectedId ? "scene-item selected" : "scene-item"} transform={`translate(${item.x} ${item.y}) rotate(${item.rotation}) scale(${item.scale})`} opacity={item.opacity}>
                  <g dangerouslySetInnerHTML={{ __html: svgInnerMarkup(asset.svg, activePalette) }} />
                </g>;
              })}
            </svg>
            {items.filter((item) => item.visible && assets.some((asset) => asset.id === item.assetId)).length === 0 && <div className="empty-canvas"><span>✦</span><strong>Добавьте объект на холст</strong><small>Выберите SVG в каталоге или соберите композицию по запросу</small></div>}
          </div>
        </div>
        <div className="canvas-footer"><span>{items.filter((item) => item.visible).length} объектов на холсте</span><span>{format.width} × {format.height} px</span></div>
      </main>

      <aside className="sidebar right-panel">
        <section>
          <div className="panel-heading compact"><div><span className="eyebrow">INSPECTOR</span><h2>Свойства</h2></div></div>
          {selected && selectedAsset ? <div className="inspector">
            <div className="selected-title"><span className="asset-thumb large" dangerouslySetInnerHTML={{ __html: svgInnerMarkup(selectedAsset.svg, activePalette) }} />
              <div><strong>{selectedAsset.name}</strong><small>{selectedAsset.detailLevel} · {selectedAsset.role === "background" ? "Фоновый объект" : "Главный объект"}</small></div>
            </div>
            <label>Позиция X<input type="number" value={Math.round(selected.x)} onChange={(event) => updateSelected({ x: Number(event.target.value) })} /></label>
            <label>Позиция Y<input type="number" value={Math.round(selected.y)} onChange={(event) => updateSelected({ y: Number(event.target.value) })} /></label>
            <label>Масштаб <output>{selected.scale.toFixed(2)}×</output><input type="range" min="0.1" max="3" step="0.01" value={selected.scale} onChange={(event) => updateSelected({ scale: Number(event.target.value) })} /></label>
            <label>Поворот <output>{Math.round(selected.rotation)}°</output><input type="range" min="-180" max="180" value={selected.rotation} onChange={(event) => updateSelected({ rotation: Number(event.target.value) })} /></label>
            <label>Непрозрачность <output>{Math.round(selected.opacity * 100)}%</output><input type="range" min="0" max="1" step="0.01" value={selected.opacity} onChange={(event) => updateSelected({ opacity: Number(event.target.value) })} /></label>
            <div className="inspector-actions">
              <button onClick={duplicateSelected} title="Ctrl+D">Дублировать</button>
              <button onClick={() => moveLayer("down")}>↓ Ниже</button><button onClick={() => moveLayer("up")}>↑ Выше</button>
              <button className="danger" onClick={() => { setItems((current) => current.filter((item) => item.id !== selected.id)); setSelectedId(undefined); }}>Удалить</button>
            </div>
          </div> : <div className="empty-inspector">Выберите объект на холсте<br /><small>Здесь появятся его свойства</small></div>}
        </section>

        <section className="layers-section"><div className="section-title"><h3>Слои <span>{items.length}</span></h3><button onClick={() => setItems((current) => [...current].reverse())} title="Инвертировать порядок слоёв">⇄</button></div>
          <div className="layers">{[...items].reverse().map((item) => { const asset = assets.find((candidate) => candidate.id === item.assetId); return <div className="layer-row" key={item.id}>
            <button className={item.id === selectedId ? "layer active" : "layer"} onClick={() => setSelectedId(item.id)}><span>◇</span><span>{asset?.name ?? "Недоступный объект"}</span><small>{asset?.detailLevel}</small></button>
            <button className="layer-visibility" onClick={() => toggleVisibility(item.id)} title={item.visible ? "Скрыть" : "Показать"}>{item.visible ? "◉" : "○"}</button>
          </div>; })}</div>
        </section>

        <section className="palette-section"><div className="section-title"><h3>Цветовые схемы</h3><button onClick={addPalette} title="Создать пустую схему">＋</button></div>
          <select value={activePaletteId ?? ""} onChange={(event) => { setActivePaletteId(event.target.value || undefined); setPaletteEntry(""); }}><option value="">Исходные цвета</option>{palettes.map((palette) => <option value={palette.id} key={palette.id}>{palette.name}</option>)}</select>
          {activePalette && <><input value={activePalette.name} onChange={(event) => updatePalette({ name: event.target.value })} placeholder="Название схемы" />
            <p className="hint">Схема создана пустой. Добавьте точную пару исходного и целевого цветов; значения оригинальных схем не заданы.</p>
            <input value={paletteEntry} onChange={(event) => updatePaletteEntry(event.target.value)} placeholder="Исходный цвет → целевой цвет" aria-label="Пара цветов" />
            <div className="palette-colors">{Object.entries(activePalette.colors).map(([from, to]) => <div key={from}><span>{from}</span><span>→</span><span>{to}</span></div>)}</div>
          </>}
        </section>

        <section className="compose-section"><div className="section-title"><h3>Автокомпоновка</h3><span className="badge">ЛОКАЛЬНО</span></div>
          <p>Подбор по названию и локальным смысловым связям. Внешняя модель не подключена. Используются только SVG текущего размера и категории.</p>
          <input value={composePrompt} onChange={(event) => setComposePrompt(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") runComposition(); }} placeholder="Метафора или объекты через запятую" />
          <button className="secondary full" onClick={runComposition}>{suggestions.length ? "Перекомпоновать" : "Собрать композицию"}</button>
          {suggestions.length > 0 && <div className="suggestions">{suggestions.map((suggestion) => <button className="suggestion" key={suggestion.asset.id} onClick={() => addAsset(suggestion.asset)}>
            <span>{suggestion.asset.name} · {suggestion.asset.detailLevel} · {suggestion.asset.role === "background" ? "фон" : "главный"}</span><small>{suggestion.reason}</small>
          </button>)}</div>}
        </section>
      </aside>
    </div>
  </div>;
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
