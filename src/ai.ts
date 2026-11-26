import type { ComponentRole, DetailLevel, LibraryAsset } from "./types";

export type ComponentSuggestion = {
  asset: LibraryAsset;
  /** Optional role override when the desired role uses monochrome projection on a main asset. */
  roleOverride?: ComponentRole;
  score: number;
  reason: string;
};

export type MetaphorRecommendation = {
  suggestions: ComponentSuggestion[];
  themeSummary: string;
};

export type ExactComponentResolution = {
  matched: ComponentSuggestion[];
  notFound: string[];
  notices: string[];
};

export interface ComponentRecommender {
  recommend(
    prompt: string,
    assets: LibraryAsset[],
    detail: DetailLevel,
    includeBackgrounds?: boolean,
  ): ComponentSuggestion[];
}

type ThematicConcept = {
  id: string;
  label: string;
  triggers: string[];
  /** Ordered primary families (`familyId`) best expressing this metaphor. */
  mainFamilies: Array<{ familyId: string; weight: number; reason: string }>;
  /** Complementary background families providing context without clutter. */
  backgroundFamilies: Array<{ familyId: string; reason: string }>;
};

/**
 * Curated semantic & metaphor knowledge graph strictly mapped onto the 10 authentic library families.
 * Ensures high semantic relevance AND inter-object thematic compatibility.
 */
const THEMATIC_CONCEPTS: ThematicConcept[] = [
  {
    id: "digital-transformation",
    label: "Цифровая трансформация и модернизация бизнеса",
    triggers: [
      "цифров", "трансформац", "модернизац", "диджитал", "digital", "transformation",
      "автоматизац", "цифровизац", "обновлен", "интеграц", "переход", "технолог",
    ],
    mainFamilies: [
      { familyId: "telefon", weight: 7, reason: "Цифровые каналы связи и клиентские сервисы" },
      { familyId: "pazly", weight: 7, reason: "Интеграция бизнес-процессов и модульная перестройка" },
      { familyId: "lampa", weight: 6, reason: "Технологические инновации и новые решения" },
      { familyId: "papka", weight: 5, reason: "Оцифровка документов и корпоративных данных" },
    ],
    backgroundFamilies: [
      { familyId: "moneta", reason: "Фоновый контекст бизнес-эффективности" },
      { familyId: "koshelek", reason: "Фоновый контекст экономики предприятия" },
    ],
  },
  {
    id: "teamwork",
    label: "Командная работа, синергия и коммуникации",
    triggers: [
      "команд", "коллектив", "сотрудничеств", "синерг", "вмест", "общен", "коммуникац",
      "встреч", "созвон", "партнер", "взаимодейств", "team", "collaboration", "community", "поддержк",
    ],
    mainFamilies: [
      { familyId: "pazly", weight: 8, reason: "Слаженное взаимодействие участников команды" },
      { familyId: "naushniki", weight: 7, reason: "Онлайн-созвоны, диалог и активное слушание" },
      { familyId: "telefon", weight: 6, reason: "Оперативная связь и координация" },
    ],
    backgroundFamilies: [
      { familyId: "lampa", reason: "Фоновый контекст совместного поиска идей" },
      { familyId: "vaza", reason: "Фоновый контекст комфортной командной атмосферы" },
    ],
  },
  {
    id: "growth-development",
    label: "Рост, обучение и саморазвитие",
    triggers: [
      "рост", "развит", "саморазвит", "обучен", "образован", "учеб", "знани", "карьер",
      "прогресс", "навык", "компетенц", "потенциал", "growth", "education", "learning", "курс", "ментор",
    ],
    mainFamilies: [
      { familyId: "kniga", weight: 8, reason: "Фундаментальные знания и обучение" },
      { familyId: "lampa", weight: 7, reason: "Новые идеи, озарение и развитие мышления" },
      { familyId: "moneta", weight: 6, reason: "Рост ценности и измеримый результат" },
      { familyId: "naushniki", weight: 5, reason: "Образовательные подкасты и аудиокурсы" },
    ],
    backgroundFamilies: [
      { familyId: "ruchka", reason: "Фоновый контекст конспектов и целеполагания" },
      { familyId: "vaza", reason: "Фоновый контекст гармоничного развития" },
    ],
  },
  {
    id: "artificial-intelligence",
    label: "Искусственный интеллект, алгоритмы и аналитика",
    triggers: [
      "искусственн", "интеллект", "нейросет", "нейрон", "алгоритм", "машинн", "ai", "ml",
      "llm", "gpt", "умн", "когнитив", "аналитик", "прогноз", "инновац", "генератив", "бот",
    ],
    mainFamilies: [
      { familyId: "lampa", weight: 8, reason: "Интеллектуальный инсайт и генерация решений" },
      { familyId: "pazly", weight: 8, reason: "Алгоритмическая сборка паттернов и связей" },
      { familyId: "kniga", weight: 6, reason: "Корпус знаний и обучение модели" },
    ],
    backgroundFamilies: [
      { familyId: "papka", reason: "Фоновый контекст структурированных датасетов" },
      { familyId: "telefon", reason: "Фоновый контекст умных цифровых интерфейсов" },
    ],
  },
  {
    id: "data-security",
    label: "Безопасность данных, конфиденциальность и комплаенс",
    triggers: [
      "безопасн", "защит", "данн", "конфиденциальн", "приватн", "кибер", "комплаенс",
      "аудит", "надежн", "сохранност", "риск", "security", "privacy", "data", "регламент", "проверк",
    ],
    mainFamilies: [
      { familyId: "papka", weight: 8, reason: "Защищённое хранилище корпоративных данных и реестров" },
      { familyId: "ruchka", weight: 7, reason: "Верификация, подпись и юридический регламент" },
      { familyId: "koshelek", weight: 6, reason: "Сохранность финансовых и цифровых активов" },
    ],
    backgroundFamilies: [
      { familyId: "pazly", reason: "Фоновый контекст целостности системной архитектуры" },
      { familyId: "kniga", reason: "Фоновый контекст политик и стандартов безопасности" },
    ],
  },
  {
    id: "finance-business",
    label: "Финансы, инвестиции и коммерция",
    triggers: [
      "финанс", "деньг", "бюджет", "инвестиц", "прибыл", "доход", "капитал", "банк",
      "оплат", "платеж", "коммерц", "экономик", "выгод", "монетизац", "стоимост", "продаж", "бизнес",
    ],
    mainFamilies: [
      { familyId: "koshelek", weight: 8, reason: "Управление бюджетом и платёжными потоками" },
      { familyId: "moneta", weight: 8, reason: "Капитал, доходность и ценность продукта" },
      { familyId: "ruchka", weight: 6, reason: "Заключение сделок и финансовых контрактов" },
    ],
    backgroundFamilies: [
      { familyId: "papka", reason: "Фоновый контекст финансовой отчётности" },
      { familyId: "telefon", reason: "Фоновый контекст мобильного банкинга и связи" },
    ],
  },
  {
    id: "documents-law",
    label: "Документооборот, право и управление проектами",
    triggers: [
      "документ", "договор", "контракт", "архив", "юрид", "прав", "бумаг", "отчет",
      "учет", "порядок", "орган", "планирован", "стратег", "менеджмент", "проект", "задач",
    ],
    mainFamilies: [
      { familyId: "papka", weight: 8, reason: "Систематизация проектной документации" },
      { familyId: "ruchka", weight: 8, reason: "Подписание договоров и утверждение планов" },
      { familyId: "kniga", weight: 6, reason: "Нормативная база и свод правил" },
    ],
    backgroundFamilies: [
      { familyId: "pazly", reason: "Фоновый контекст согласованности этапов проекта" },
    ],
  },
  {
    id: "creative-culture",
    label: "Креатив, дизайн, медиа и гармония",
    triggers: [
      "креатив", "творчеств", "дизайн", "искусств", "гармон", "баланс", "уют", "музык",
      "подкаст", "медиа", "вдохновен", "эстетик", "культур", "автор", "контент", "бренд",
    ],
    mainFamilies: [
      { familyId: "vaza", weight: 8, reason: "Визуальная эстетика, форма и баланс" },
      { familyId: "lampa", weight: 7, reason: "Творческое вдохновение и яркая идея" },
      { familyId: "naushniki", weight: 6, reason: "Медиа-контент, ритм и погружение в поток" },
    ],
    backgroundFamilies: [
      { familyId: "ruchka", reason: "Фоновый контекст авторского эскиза" },
      { familyId: "kniga", reason: "Фоновый контекст культурного контекста" },
    ],
  },
];

/** English -> Russian canonical family lookup for direct component naming. */
const DIRECT_NAME_ALIASES: Record<string, string> = {
  ваза: "vaza",
  вазу: "vaza",
  вазы: "vaza",
  vase: "vaza",
  книга: "kniga",
  книгу: "kniga",
  книги: "kniga",
  book: "kniga",
  кошелек: "koshelek",
  кошелька: "koshelek",
  кошельку: "koshelek",
  бумажник: "koshelek",
  wallet: "koshelek",
  лампа: "lampa",
  лампу: "lampa",
  лампы: "lampa",
  lamp: "lampa",
  монета: "moneta",
  монету: "moneta",
  монеты: "moneta",
  монетка: "moneta",
  coin: "moneta",
  наушники: "naushniki",
  наушник: "naushniki",
  гарнитура: "naushniki",
  headphones: "naushniki",
  пазлы: "pazly",
  пазл: "pazly",
  пазлов: "pazly",
  мозаика: "pazly",
  puzzle: "pazly",
  puzzles: "pazly",
  папка: "papka",
  папку: "papka",
  папки: "papka",
  скоросшиватель: "papka",
  folder: "papka",
  ручка: "ruchka",
  ручку: "ruchka",
  ручки: "ruchka",
  перо: "ruchka",
  pen: "ruchka",
  телефон: "telefon",
  телефона: "telefon",
  трубка: "telefon",
  смартфон: "telefon",
  phone: "telefon",
};

/** Compatibility clusters: prevents pairing semantically unrelated filler items. */
const COMPATIBILITY_MATRIX: Record<string, string[]> = {
  vaza: ["kniga", "lampa", "naushniki", "ruchka"],
  kniga: ["lampa", "ruchka", "papka", "naushniki", "pazly", "vaza"],
  koshelek: ["moneta", "papka", "telefon", "ruchka", "pazly"],
  lampa: ["kniga", "pazly", "telefon", "naushniki", "vaza", "ruchka"],
  moneta: ["koshelek", "telefon", "papka", "lampa", "kniga"],
  naushniki: ["pazly", "telefon", "kniga", "lampa", "vaza"],
  pazly: ["lampa", "telefon", "naushniki", "papka", "kniga", "koshelek"],
  papka: ["ruchka", "telefon", "pazly", "koshelek", "kniga", "moneta"],
  ruchka: ["papka", "kniga", "koshelek", "lampa", "vaza"],
  telefon: ["naushniki", "pazly", "papka", "koshelek", "lampa", "moneta"],
};

export function normalizeText(value: string): string {
  return value
    .toLocaleLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Lightweight Russian + English stemmer for resilient morphological matching. */
function stemToken(word: string): string {
  if (word.length <= 3) return word;
  return word
    .replace(
      /(остями|остей|остью|ости|ость|ением|ениям|ениях|ение|ении|ений|ацией|ации|ацию|ация|овать|ировать|ами|ями|ого|его|ому|ему|ыми|ими|ая|яя|ое|ее|ые|ие|ой|ей|ий|ый|ую|юю|ам|ям|ах|ях|ов|ев|ом|ем|а|я|о|е|ы|и|у|ю|ь)$/u,
      "",
    ) || word.slice(0, 4);
}

function tokenizeAndStem(text: string): { raw: string[]; stems: string[] } {
  const raw = normalizeText(text).split(/\s+/).filter(Boolean);
  const stems = raw.map(stemToken).filter((s) => s.length >= 2);
  return { raw, stems };
}

function findAssetForFamily(
  assets: LibraryAsset[],
  familyId: string,
  detail: DetailLevel,
  desiredRole: ComponentRole,
): { asset: LibraryAsset; roleOverride?: ComponentRole; usedMonochromeProjection?: boolean } | undefined {
  const exact = assets.find(
    (a) => a.svg && a.detailLevel === detail && a.familyId === familyId && a.role === desiredRole,
  );
  if (exact) return { asset: exact };

  // If background SVG variant does not exist in L (e.g. L Wallet), project main L variant into monochrome background
  if (desiredRole === "background") {
    const mainVariant = assets.find(
      (a) => a.svg && a.detailLevel === detail && a.familyId === familyId && a.role === "composition_object",
    );
    if (mainVariant) {
      return { asset: mainVariant, roleOverride: "background", usedMonochromeProjection: true };
    }
  }
  return undefined;
}

export class LocalComponentRecommender implements ComponentRecommender {
  recommendWithSummary(
    prompt: string,
    assets: LibraryAsset[],
    detail: DetailLevel,
    includeBackgrounds: boolean = true,
  ): MetaphorRecommendation {
    const normalizedQuery = normalizeText(prompt);
    if (!normalizedQuery) return { suggestions: [], themeSummary: "" };

    const { raw: queryTokens, stems: queryStems } = tokenizeAndStem(prompt);
    const backgroundOnlyRequested =
      /(?:^|\s)(?:только фон|фоновые объекты|без главных)(?:$|\s)/i.test(normalizedQuery);

    const familyScores = new Map<string, { score: number; reasons: Set<string> }>();
    const bgCandidates = new Map<string, { score: number; reason: string }>();
    const matchedConceptLabels: string[] = [];

    const addMainScore = (familyId: string, delta: number, reason: string) => {
      const entry = familyScores.get(familyId) ?? { score: 0, reasons: new Set<string>() };
      entry.score += delta;
      entry.reasons.add(reason);
      familyScores.set(familyId, entry);
    };

    // 1. Check thematic metaphor concepts
    for (const concept of THEMATIC_CONCEPTS) {
      let conceptHits = 0;
      for (const trigger of concept.triggers) {
        const normTrigger = normalizeText(trigger);
        if (
          normalizedQuery.includes(normTrigger) ||
          queryTokens.some((tok) => tok.length >= 4 && (tok.startsWith(normTrigger) || normTrigger.startsWith(tok))) ||
          queryStems.some((st) => st.length >= 4 && normTrigger.length >= 4 && (normTrigger.startsWith(st) || st.startsWith(normTrigger)))
        ) {
          conceptHits += 1;
        }
      }

      if (conceptHits > 0) {
        matchedConceptLabels.push(concept.label);
        for (const item of concept.mainFamilies) {
          addMainScore(item.familyId, item.weight * conceptHits, item.reason);
        }
        for (const bg of concept.backgroundFamilies) {
          const prev = bgCandidates.get(bg.familyId);
          const nextScore = conceptHits * 4 + (prev?.score ?? 0);
          bgCandidates.set(bg.familyId, { score: nextScore, reason: bg.reason });
        }
      }
    }

    // 2. Check asset-level names, keywords, descriptions, and imported SVG names
    const availableInDetail = assets.filter((a) => a.detailLevel === detail && Boolean(a.svg));
    const distinctFamilies = [...new Set(availableInDetail.map((a) => a.familyId))];

    for (const familyId of distinctFamilies) {
      const sample = availableInDetail.find((a) => a.familyId === familyId && a.role === "composition_object")
        ?? availableInDetail.find((a) => a.familyId === familyId);
      if (!sample) continue;

      const normName = normalizeText(sample.name);
      const nameStem = stemToken(normName);

      // Direct mention of object name
      const directHit =
        normalizedQuery.includes(normName) ||
        queryTokens.some((t) => DIRECT_NAME_ALIASES[t] === familyId) ||
        (nameStem.length >= 3 && queryStems.includes(nameStem));

      if (directHit) {
        addMainScore(familyId, 12, `Прямое упоминание объекта «${sample.name}»`);
      }

      // Keyword stem matching
      let kwHits = 0;
      let matchedKw = "";
      for (const kw of sample.keywords) {
        const normKw = normalizeText(kw);
        if (!normKw || normKw === normName) continue;
        const kwStem = stemToken(normKw);
        if (
          normalizedQuery.includes(normKw) ||
          (kwStem.length >= 4 && queryStems.some((qs) => qs.length >= 4 && (qs === kwStem || qs.startsWith(kwStem) || kwStem.startsWith(qs))))
        ) {
          kwHits += 1;
          if (!matchedKw) matchedKw = kw;
        }
      }

      if (kwHits > 0) {
        addMainScore(familyId, kwHits * 3, `Семантическая связь («${matchedKw}»)`);
      }
    }

    if (familyScores.size === 0 && bgCandidates.size === 0) {
      return { suggestions: [], themeSummary: "" };
    }

    // 3. Rank main objects and enforce semantic compatibility with the top hero object
    const rankedMain = [...familyScores.entries()]
      .sort((a, b) => b[1].score - a[1].score);

    const heroFamilyId = rankedMain[0]?.[0];
    const compatibleWithHero = heroFamilyId ? COMPATIBILITY_MATRIX[heroFamilyId] : undefined;

    const selectedMainIds: string[] = [];
    for (const [familyId, info] of rankedMain) {
      if (selectedMainIds.length === 0) {
        selectedMainIds.push(familyId);
        continue;
      }
      if (selectedMainIds.length >= 3) break;
      // Direct mentions always pass; metaphor matches prefer semantically compatible objects
      const isDirect = [...info.reasons].some((r) => r.startsWith("Прямое упоминание"));
      const isCompatible = !compatibleWithHero || compatibleWithHero.includes(familyId) || info.score >= 10;
      if (isDirect || isCompatible) {
        selectedMainIds.push(familyId);
      }
    }

    // If only 1 object matched a broad metaphor, pick 1 compatible supporting partner from matched concepts or compatibility list
    if (selectedMainIds.length === 1 && rankedMain.length > 1) {
      selectedMainIds.push(rankedMain[1][0]);
    }

    const suggestions: ComponentSuggestion[] = [];

    if (!backgroundOnlyRequested) {
      for (const familyId of selectedMainIds) {
        const resolved = findAssetForFamily(assets, familyId, detail, "composition_object");
        const scoreInfo = familyScores.get(familyId);
        if (resolved && scoreInfo) {
          suggestions.push({
            asset: resolved.asset,
            roleOverride: resolved.roleOverride,
            score: scoreInfo.score,
            reason: [...scoreInfo.reasons][0] ?? "Смысловое соответствие теме",
          });
        }
      }
    }

    // 4. Add 1-2 monochrome background objects (not duplicating main families!) for depth & visual context
    if (includeBackgrounds || backgroundOnlyRequested) {
      const usedFamilies = new Set(selectedMainIds);
      const rankedBgs = [...bgCandidates.entries()]
        .filter(([fid]) => backgroundOnlyRequested || !usedFamilies.has(fid))
        .sort((a, b) => b[1].score - a[1].score);

      // Also consider lower-ranked main matches as subtle background context if no explicit bgCandidate
      if (rankedBgs.length === 0) {
        for (const [fid, info] of rankedMain) {
          if (!usedFamilies.has(fid)) {
            rankedBgs.push([fid, { score: info.score, reason: "Дополнительный фоновый контекст темы" }]);
          }
        }
      }

      const maxBgs = backgroundOnlyRequested ? 4 : Math.min(2, Math.max(1, selectedMainIds.length >= 3 ? 2 : 1));
      for (const [fid, bgInfo] of rankedBgs.slice(0, maxBgs)) {
        const resolved = findAssetForFamily(assets, fid, detail, "background");
        if (resolved) {
          suggestions.push({
            asset: resolved.asset,
            roleOverride: resolved.roleOverride,
            score: bgInfo.score,
            reason: bgInfo.reason,
          });
        }
      }
    }

    const themeSummary = matchedConceptLabels.length > 0
      ? `Тема: ${matchedConceptLabels.slice(0, 2).join(" · ")}`
      : `Семантический подбор по запросу «${prompt.trim()}»`;

    return { suggestions, themeSummary };
  }

  recommend(
    prompt: string,
    assets: LibraryAsset[],
    detail: DetailLevel,
    includeBackgrounds: boolean = true,
  ): ComponentSuggestion[] {
    return this.recommendWithSummary(prompt, assets, detail, includeBackgrounds).suggestions;
  }
}

/**
 * Scenario 2: Strict lookup by explicit component names entered by the user.
 * Splits by comma, semicolon, or newline; supports role qualifiers like "(фон)" or "фоновый".
 * NEVER substitutes missing components — reports every unfound name explicitly!
 */
export function resolveComponentsByNames(
  rawInput: string,
  assets: LibraryAsset[],
  detail: DetailLevel,
): ExactComponentResolution {
  const chunks = rawInput
    .split(/[,;\n]+/)
    .map((part) => part.trim())
    .filter(Boolean);

  const matched: ComponentSuggestion[] = [];
  const notFound: string[] = [];
  const notices: string[] = [];

  const detailAssets = assets.filter((a) => a.detailLevel === detail && Boolean(a.svg));

  for (const chunk of chunks) {
    const wantsBackground = /(?:\(\s*фон[^)]*\)|\bфонов\p{L}*|\bфон\b|\bbackground\b)/iu.test(chunk);
    const cleanedName = normalizeText(
      chunk
        .replace(/\(\s*(?:фон|главн)[^)]*\)/giu, "")
        .replace(/\b(?:фоновый|фоновая|фоновое|фон|главный|главная|основной|background|main)\b/giu, ""),
    );

    if (!cleanedName) continue;

    const desiredRole: ComponentRole = wantsBackground ? "background" : "composition_object";
    const aliasFamilyId = DIRECT_NAME_ALIASES[cleanedName];

    // Match either by exact normalized name, imported asset name, or canonical family alias
    const candidateMainOrExact = detailAssets.find(
      (a) =>
        a.role === desiredRole &&
        (normalizeText(a.name) === cleanedName || (aliasFamilyId && a.familyId === aliasFamilyId)),
    );

    if (candidateMainOrExact) {
      matched.push({
        asset: candidateMainOrExact,
        score: 10,
        reason: `Точное совпадение: ${candidateMainOrExact.name} (${desiredRole === "background" ? "фоновый" : "главный"}, ${detail})`,
      });
      continue;
    }

    // Check if the component exists in the opposite role (e.g. L Wallet requested as background)
    const oppositeRoleAsset = detailAssets.find(
      (a) =>
        normalizeText(a.name) === cleanedName || (aliasFamilyId && a.familyId === aliasFamilyId),
    );

    if (oppositeRoleAsset && desiredRole === "background") {
      matched.push({
        asset: oppositeRoleAsset,
        roleOverride: "background",
        score: 9,
        reason: `${oppositeRoleAsset.name}: монохромный фоновый режим (${detail})`,
      });
      notices.push(
        `Для «${oppositeRoleAsset.name}» в размере ${detail} нет отдельного фонового SVG — применён монохромный фоновый режим к оригинальному вектору.`,
      );
      continue;
    }

    // Component genuinely does not exist in library — do NOT invent or substitute!
    notFound.push(chunk);
  }

  return { matched, notFound, notices };
}
