import type { ComponentRole, DetailLevel, LibraryAsset } from "./types";

export type ComponentSuggestion = { asset: LibraryAsset; score: number; reason: string };

export interface ComponentRecommender {
  recommend(prompt: string, assets: LibraryAsset[], detail: DetailLevel): ComponentSuggestion[];
}

const semanticAliases: Record<string, string[]> = {
  книга: ["book", "знания", "учеба", "образование", "саморазвитие", "развитие", "чтение", "learning", "education", "growth", "курс"],
  наушники: ["headphones", "музыка", "звук", "аудио", "подкаст", "обучение", "образование", "саморазвитие", "развитие", "аудиокнига", "music", "audio", "podcast"],
  ваза: ["vase", "цветы", "интерьер", "декор", "пространство", "flowers", "decor"],
  лампа: ["lamp", "идея", "свет", "инсайт", "решение", "образование", "саморазвитие", "развитие", "light", "idea", "insight"],
  кошелек: ["wallet", "деньги", "финансы", "оплата", "finance", "payment"],
  монета: ["coin", "деньги", "стоимость", "награда", "value", "reward"],
  пазлы: ["puzzle", "головоломка", "сборка", "комбинация", "команда", "problem solving"],
  папка: ["folder", "файл", "проект", "документы", "document", "file"],
  ручка: ["pen", "письмо", "подпись", "документ", "writing", "signature"],
  телефон: ["phone", "связь", "звонок", "мобильный", "communication", "mobile"],
};

function normalize(value: string) {
  return value.toLocaleLowerCase().replace(/ё/g, "е").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function requestedRole(prompt: string): ComponentRole {
  return /(?:^|\s)(?:фон|фоновый|фоновая|background|decorative)(?:$|\s)/i.test(normalize(prompt))
    ? "background"
    : "composition_object";
}

export class LocalComponentRecommender implements ComponentRecommender {
  recommend(prompt: string, assets: LibraryAsset[], detail: DetailLevel) {
    const query = normalize(prompt);
    if (!query) return [];

    const role = requestedRole(prompt);
    const names = [...new Set(assets.filter((asset) => asset.detailLevel === detail && asset.role === role).map((asset) => asset.name))];
    const matches: ComponentSuggestion[] = [];
    for (const name of names) {
      const normalizedName = normalize(name);
      const aliases = (semanticAliases[normalizedName] ?? [normalizedName]).map(normalize);
      const direct = query.includes(normalizedName) || normalizedName.split(" ").every((part) => query.includes(part));
      const hits = aliases.filter((alias) => alias.length > 1 && query.includes(alias));
      if (!direct && hits.length === 0) continue;

      const asset = assets.find((candidate) => candidate.name === name && candidate.detailLevel === detail && candidate.role === role && candidate.svg);
      if (!asset) continue;
      matches.push({
        asset,
        score: (direct ? 4 : 0) + hits.length,
        reason: direct ? "Точное название объекта" : "Локальное совпадение по метафоре",
      });
    }

    return matches.sort((a, b) => b.score - a.score || a.asset.name.localeCompare(b.asset.name, "ru")).slice(0, 8);
  }
}
