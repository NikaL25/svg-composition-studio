import { LocalComponentRecommender, type ComponentSuggestion } from "./ai";
import type {
  AiCompositionResult,
  AiProvider,
  AiProviderConfig,
  AiProviderError,
  ComponentRole,
  DetailLevel,
  LibraryAsset,
} from "./types";

const DEFAULT_CONFIG: AiProviderConfig = {
  id: "external-ai",
  baseUrl: (import.meta.env.VITE_AI_BASE_URL as string | undefined)?.trim() ?? "",
  apiKey: (import.meta.env.VITE_AI_API_KEY as string | undefined)?.trim() ?? "",
  model: (import.meta.env.VITE_AI_MODEL as string | undefined)?.trim() ?? "gemini-2.5-flash",
  timeoutMs: Number.parseInt((import.meta.env.VITE_AI_TIMEOUT_MS as string | undefined) ?? "12000", 10),
  maxRetries: Number.parseInt((import.meta.env.VITE_AI_MAX_RETRIES as string | undefined) ?? "1", 10),
};

function createAiError(
  code: AiProviderError["code"],
  message: string,
  retryable: boolean,
): AiProviderError {
  return { code, message, retryable };
}

function isGeminiEndpoint(baseUrl: string): boolean {
  return baseUrl.includes("generativelanguage.googleapis.com");
}

function isPlaceholderEndpoint(baseUrl: string): boolean {
  return !baseUrl || baseUrl.includes("api.example.com");
}

/**
 * External AI provider strictly constrained to semantic selection of EXISTING library components.
 * AI never receives or generates SVG paths — it operates solely on catalog IDs, roles, and descriptions.
 */
export class ExternalAiProvider implements AiProvider {
  id = "external-ai";
  private config: AiProviderConfig;

  constructor(config: Partial<AiProviderConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async isAvailable(): Promise<boolean> {
    if (isPlaceholderEndpoint(this.config.baseUrl)) return false;
    if (isGeminiEndpoint(this.config.baseUrl)) {
      return Boolean(this.config.apiKey && this.config.apiKey.startsWith("AIza"));
    }
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3500);
      const response = await fetch(`${this.config.baseUrl.replace(/\/$/, "")}/health`, {
        signal: controller.signal,
        method: "GET",
      });
      clearTimeout(timeout);
      return response.ok;
    } catch {
      return false;
    }
  }

  async generateComposition(
    prompt: string,
    assets: LibraryAsset[],
    config: AiProviderConfig = this.config,
  ): Promise<AiCompositionResult> {
    if (isPlaceholderEndpoint(config.baseUrl)) {
      throw createAiError("network", "Внешний AI-провайдер не настроен; используется локальный семантический движок.", false);
    }

    return this._executeWithRetries(prompt, assets, config, config.maxRetries);
  }

  private async _executeWithRetries(
    prompt: string,
    assets: LibraryAsset[],
    config: AiProviderConfig,
    retriesLeft: number,
  ): Promise<AiCompositionResult> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

      let response: Response;
      if (isGeminiEndpoint(config.baseUrl)) {
        const catalogSummary = assets.map((a) => ({
          id: a.id,
          name: a.name,
          role: a.role,
          category: a.category,
          description: a.description,
        }));

        const systemInstruction = [
          "Ты — арт-директор конструктора векторных иллюстраций.",
          "Выбери от 2 до 5 подходящих по смыслу и совместимых между собой объектов ТОЛЬКО из предложенного JSON-каталога.",
          "КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО придумывать несуществующие assetId или генерировать SVG.",
          "Верни строго JSON формата: {\"reasoning\": \"краткое объяснение на русском\", \"items\": [{\"assetId\": \"...\", \"reason\": \"почему выбран\"}]}",
        ].join(" ");

        const url = `${config.baseUrl.replace(/\/$/, "")}/models/${encodeURIComponent(config.model)}:generateContent?key=${encodeURIComponent(config.apiKey ?? "")}`;
        response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [
              {
                role: "user",
                parts: [
                  {
                    text: `${systemInstruction}\n\nЗапрос пользователя: "${prompt}"\n\nКаталог доступных объектов:\n${JSON.stringify(catalogSummary)}`,
                  },
                ],
              },
            ],
            generationConfig: {
              responseMimeType: "application/json",
              temperature: 0.2,
            },
          }),
          signal: controller.signal,
        });
      } else {
        response = await fetch(`${config.baseUrl.replace(/\/$/, "")}/compose`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
          },
          body: JSON.stringify({
            prompt,
            model: config.model,
            assets: assets.map((a) => ({
              id: a.id,
              name: a.name,
              role: a.role,
              detailLevel: a.detailLevel,
              category: a.category,
              keywords: a.keywords,
            })),
          }),
          signal: controller.signal,
        });
      }

      clearTimeout(timeout);

      if (!response.ok) {
        if (response.status === 400 || response.status === 401 || response.status === 403) {
          throw createAiError("invalid_key", "Внешний AI-ключ недействителен — выполнен локальный подбор.", false);
        }
        if (response.status === 429) {
          throw createAiError("rate_limit", "Лимит внешнего AI исчерпан — выполнен локальный подбор.", true);
        }
        throw createAiError("unknown", `AI HTTP ${response.status}`, true);
      }

      const payload = await response.json();
      let parsed: AiCompositionResult;

      if (isGeminiEndpoint(config.baseUrl)) {
        const rawText: string = payload?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
        parsed = JSON.parse(rawText) as AiCompositionResult;
      } else {
        parsed = payload as AiCompositionResult;
      }

      if (!parsed || !Array.isArray(parsed.items)) {
        throw createAiError("unknown", "Некорректный формат ответа AI-провайдера.", false);
      }

      // Strict whitelist validation: allow ONLY existing library asset IDs!
      const validIds = new Set(assets.map((a) => a.id));
      const sanitizedItems = parsed.items.filter((it) => it && typeof it.assetId === "string" && validIds.has(it.assetId));

      if (sanitizedItems.length === 0) {
        throw createAiError("unknown", "AI не выбрал допустимые компоненты из каталога.", false);
      }

      return {
        reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : "Подобрано по смыслу запроса",
        items: sanitizedItems,
      };
    } catch (error) {
      if ((error as AiProviderError)?.code) {
        const typedErr = error as AiProviderError;
        if (typedErr.retryable && retriesLeft > 0) {
          return this._executeWithRetries(prompt, assets, config, retriesLeft - 1);
        }
        throw typedErr;
      }
      if (error instanceof DOMException && error.name === "AbortError") {
        if (retriesLeft > 0) {
          return this._executeWithRetries(prompt, assets, config, retriesLeft - 1);
        }
        throw createAiError("timeout", "Таймаут внешнего AI — выполнен локальный подбор.", false);
      }
      if (retriesLeft > 0) {
        return this._executeWithRetries(prompt, assets, config, retriesLeft - 1);
      }
      throw createAiError("network", "Внешний AI недоступен — выполнен локальный подбор.", false);
    }
  }
}

export class AiCompositionService {
  private external: ExternalAiProvider;
  private local: LocalComponentRecommender;

  constructor() {
    this.external = new ExternalAiProvider();
    this.local = new LocalComponentRecommender();
  }

  async isExternalAvailable(): Promise<boolean> {
    return this.external.isAvailable();
  }

  async generateComposition(
    prompt: string,
    assets: LibraryAsset[],
    detail: DetailLevel,
    options: { preferExternal?: boolean; includeBackgrounds?: boolean } = {},
  ): Promise<{
    suggestions: ComponentSuggestion[];
    themeSummary: string;
    usedExternal: boolean;
    error?: AiProviderError;
  }> {
    const filtered = assets.filter((a) => a.detailLevel === detail && Boolean(a.svg));
    const includeBackgrounds = options.includeBackgrounds ?? true;

    if (options.preferExternal) {
      try {
        const result = await this.external.generateComposition(prompt, filtered);
        const suggestions: ComponentSuggestion[] = [];
        for (const item of result.items) {
          const asset = filtered.find((a) => a.id === item.assetId);
          if (!asset) continue;
          const desiredRole: ComponentRole | undefined =
            item.role === "background" || item.role === "composition_object" ? item.role : undefined;
          if (!includeBackgrounds && (desiredRole ?? asset.role) === "background") continue;
          suggestions.push({
            asset,
            roleOverride: desiredRole && desiredRole !== asset.role ? desiredRole : undefined,
            score: 10,
            reason: item.reason ?? result.reasoning,
          });
        }
        if (suggestions.length > 0) {
          return {
            suggestions,
            themeSummary: result.reasoning,
            usedExternal: true,
          };
        }
      } catch (err) {
        const localRes = this.local.recommendWithSummary(prompt, filtered, detail, includeBackgrounds);
        return {
          suggestions: localRes.suggestions,
          themeSummary: localRes.themeSummary,
          usedExternal: false,
          error: err as AiProviderError,
        };
      }
    }

    const localRes = this.local.recommendWithSummary(prompt, filtered, detail, includeBackgrounds);
    return {
      suggestions: localRes.suggestions,
      themeSummary: localRes.themeSummary,
      usedExternal: false,
    };
  }
}
