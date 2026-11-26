import { assetFromSvg, slugifyName } from "./svg";
import type { ComponentRole, DetailLevel, LibraryAsset } from "./types";

type FamilySpec = {
  familyId: string;
  index: number;
  category: string;
  description: string;
  keywords: string[];
};

/**
 * Rich metadata registry for the 10 semantic families across 2 detail sizes = 20 source illustrations.
 */
const FAMILY_REGISTRY: Record<string, FamilySpec> = {
  ваза: {
    familyId: "vaza",
    index: 1,
    category: "Среда и гармония",
    description: "Керамическая ваза — символ гармонии, баланса, эстетики рабочего пространства и культуры",
    keywords: [
      "ваза", "vase", "гармония", "баланс", "уют", "интерьер", "декор", "эстетика",
      "культура", "дизайн", "пространство", "офис", "атмосфера", "креатив", "спокойствие", "цветы",
    ],
  },
  книга: {
    familyId: "kniga",
    index: 2,
    category: "Знания и развитие",
    description: "Раскрытая книга — база знаний, обучение, документация, экспертиза и непрерывное развитие",
    keywords: [
      "книга", "book", "знания", "учеба", "обучение", "образование", "саморазвитие", "развитие",
      "рост", "чтение", "курс", "академия", "база знаний", "правила", "методология", "исследование",
      "интеллект", "наука", "экспертиза", "гайд", "справочник", " регламент",
    ],
  },
  кошелек: {
    familyId: "koshelek",
    index: 3,
    category: "Финансы и бизнес",
    description: "Кошелёк — управление бюджетом, бизнес-активы, финтех, платежи и финансовая устойчивость",
    keywords: [
      "кошелек", "кошелёк", "wallet", "деньги", "финансы", "бюджет", "оплата", "платежи",
      "бизнес", "капитал", "сбережения", "доход", "коммерция", "банк", "финтех", "активы",
      "защита средств", "транзакции", "экономика",
    ],
  },
  лампа: {
    familyId: "lampa",
    index: 4,
    category: "Идеи и технологии",
    description: "Настольная лампа — озарение, инновации, искусственный интеллект, фокус и поиск решений",
    keywords: [
      "лампа", "lamp", "свет", "идея", "инсайт", "озарение", "инновации", "искусственный интеллект",
      "ии", "ai", "нейросеть", "умный", "технологии", "трансформация", "креативность", "решение",
      "фокус", "развитие", "рост", "мышление", "стартап", "будущее", "автоматизация",
    ],
  },
  монета: {
    familyId: "moneta",
    index: 5,
    category: "Финансы и ценность",
    description: "Монета — рост ценности, инвестиции, прибыль, вознаграждение и экономический результат",
    keywords: [
      "монета", "coin", "деньги", "стоимость", "ценность", "прибыль", "рост", "инвестиции",
      "выгода", "награда", "бонус", "монетизация", "результат", "капитал", "бизнес", "токен",
      "экономика", "эффективность", "доходность",
    ],
  },
  наушники: {
    familyId: "naushniki",
    index: 6,
    category: "Коммуникации и медиа",
    description: "Наушники — онлайн-коммуникация, командные созвоны, аудиоконтент, поддержка и концентрация",
    keywords: [
      "наушники", "headphones", "музыка", "звук", "аудио", "подкаст", "связь", "коммуникация",
      "созвон", "встреча", "командная работа", "команда", "поддержка", "концентрация", "фокус",
      "медиа", "обучение", "аудиокнига", "диалог", "сервис",
    ],
  },
  пазлы: {
    familyId: "pazly",
    index: 7,
    category: "Команда и архитектура",
    description: "Элементы пазла — командная синергия, системная интеграция, алгоритмы и сборка решений",
    keywords: [
      "пазлы", "пазл", "puzzle", "головоломка", "сборка", "команда", "командная работа",
      "взаимодействие", "синергия", "интеграция", "система", "архитектура", "логика", "алгоритм",
      "искусственный интеллект", "ии", "ai", "цифровая трансформация", "трансформация", "структура",
      "модульность", "совместимость", "партнерство", "решение задач",
    ],
  },
  папка: {
    familyId: "papka",
    index: 8,
    category: "Данные и документы",
    description: "Деловая папка — структурированное хранение данных, конфиденциальность, проекты и архивы",
    keywords: [
      "папка", "folder", "файл", "файлы", "документы", "документ", "данные", "безопасность данных",
      "безопасность", "защита", "конфиденциальность", "архив", "база данных", "хранилище", "реестр",
      "проект", "порядок", "система", "структура", "цифровизация", "бизнес", "документооборот",
    ],
  },
  ручка: {
    familyId: "ruchka",
    index: 9,
    category: "Договорённости и контроль",
    description: "Ручка — подписание договоров, верификация, авторство, планирование и фиксация правил",
    keywords: [
      "ручка", "перо", "pen", "письмо", "подпись", "договор", "контракт", "согласование",
      "верификация", "безопасность", "регламент", "планирование", "заметки", "стратегия",
      "авторство", "документ", "юридический", "гарантия", "контроль", "решение",
    ],
  },
  телефон: {
    familyId: "telefon",
    index: 10,
    category: "Цифровые каналы",
    description: "Телефон — цифровая связь, клиентские коммуникации, оперативность и бизнес-взаимодействие",
    keywords: [
      "телефон", "phone", "связь", "звонок", "коммуникация", "цифровая трансформация", "цифровой",
      "бизнес", "командная работа", "клиент", "сервис", "поддержка", "сеть", "контакт",
      "оперативность", "онлайн", "технологии", "канал связи", "диалог",
    ],
  },
};

function hash(value: string): string {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(36);
}

function libraryAsset(sourcePath: string, svg: string): LibraryAsset {
  const normalizedPath = sourcePath.replace(/^\.\.\//, "").replace(/\\/g, "/");
  const segments = normalizedPath.split("/");
  const filename = segments[segments.length - 1] ?? "object.svg";
  const name = filename.replace(/\.svg$/i, "");
  const lowerName = name.toLocaleLowerCase().replace(/ё/g, "е");

  const detail: DetailLevel =
    segments.find((part): part is DetailLevel => part === "L" || part === "S") ?? "L";
  const role: ComponentRole = segments.includes("background_objects")
    ? "background"
    : "composition_object";

  const spec = FAMILY_REGISTRY[lowerName];
  const familyId = spec?.familyId ?? slugifyName(name);
  const illustrationNumber = spec
    ? (detail === "L" ? spec.index : spec.index + 10)
    : 0;
  const sourceIllustration = illustrationNumber > 0
    ? `Иллюстрация #${String(illustrationNumber).padStart(2, "0")} (${detail} · ${name})`
    : `${detail} · ${name}`;

  const id = `${familyId}-${detail}-${role === "background" ? "background" : "main"}-${hash(normalizedPath)}`;

  return assetFromSvg(name, svg, normalizedPath, {
    id,
    familyId,
    description: spec
      ? `${spec.description} (${role === "background" ? "фоновый монохромный вариант" : "главный цветной вариант"}, размер ${detail})`
      : undefined,
    category: spec?.category ?? "Библиотека",
    keywords: spec ? [...spec.keywords] : [lowerName],
    sourceIllustration,
    detailLevel: detail,
    role,
    source: "library",
  });
}

/** Lazy SVG module map: Vite emits every SVG as an unmodified static vector asset. */
const svgModules = import.meta.glob<string>("../svg/**/*.svg", {
  eager: false,
  query: "?url",
  import: "default",
});

export const libraryFileCount = Object.keys(svgModules).length;

let libraryPromise: Promise<LibraryAsset[]> | undefined;

export function loadLibraryAssets(): Promise<LibraryAsset[]> {
  if (!libraryPromise) {
    libraryPromise = (async () => {
      const entries = Object.entries(svgModules);
      const assets: LibraryAsset[] = [];

      const batchSize = 10;
      for (let i = 0; i < entries.length; i += batchSize) {
        const batch = entries.slice(i, i + batchSize);
        const results = await Promise.all(
          batch.map(async ([sourcePath, loadFn]) => {
            const url = await loadFn();
            const response = await fetch(url);
            if (!response.ok) {
              throw new Error(`Не удалось загрузить ${sourcePath}: HTTP ${response.status}`);
            }
            return libraryAsset(sourcePath, await response.text());
          }),
        );
        assets.push(...results);
      }

      return assets.sort((a, b) => a.name.localeCompare(b.name, "ru") || a.role.localeCompare(b.role));
    })().catch((error: unknown) => {
      libraryPromise = undefined;
      throw error;
    });
  }
  return libraryPromise;
}

/**
 * Finds the exact counterpart asset for the same family (or name), target detail level, and target role.
 */
export function findCounterpartAsset(
  assets: LibraryAsset[],
  current: LibraryAsset,
  targetDetail: DetailLevel,
  targetRole: ComponentRole,
): LibraryAsset | undefined {
  return assets.find(
    (candidate) =>
      Boolean(candidate.svg) &&
      candidate.detailLevel === targetDetail &&
      candidate.role === targetRole &&
      (candidate.familyId === current.familyId ||
        candidate.name.toLocaleLowerCase() === current.name.toLocaleLowerCase()),
  );
}

/** Imported assets are deduplicated by their unique id only, never overwriting same-named assets. */
export function mergeImportedAssets(existing: LibraryAsset[], imported: LibraryAsset[]): LibraryAsset[] {
  const ids = new Set(existing.map((asset) => asset.id));
  return [...existing, ...imported.filter((asset) => !ids.has(asset.id))];
}
