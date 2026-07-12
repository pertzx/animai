/**
 * Configuração do Semantic Media Analyzer (prompt.txt).
 *
 * Modos prontos (Econômico / Balanceado / Avançado) + config manual por
 * detector. Persistido em localStorage; o default é escolhido pelo tier do
 * dispositivo (device-capabilities) para não travar celulares fracos.
 */

import type {
  AnalyzerConfig,
  AnalyzerId,
  ResolvedAnalyzerConfig,
} from "./types";

export type AnalyzerMode =
  | "critico"
  | "economico"
  | "balanceado"
  | "avancado"
  | "manual";

/** Máx. de modelos de visão inicializados ao mesmo tempo, por modo (Opt 3). */
export const MAX_CONCURRENT_MODELS: Record<
  Exclude<AnalyzerMode, "manual">,
  number
> = {
  critico: 1,
  economico: 1,
  balanceado: 2,
  avancado: 3,
};

export const ALL_ANALYZERS: AnalyzerId[] = [
  "speech",
  "ocr",
  "scene",
  "object",
  "tracker",
  "face",
  "expression",
  "pose",
  "hands",
  "audio",
  "music",
  "environment",
];

const noneEnabled = (): Record<AnalyzerId, boolean> =>
  Object.fromEntries(ALL_ANALYZERS.map((a) => [a, false])) as Record<
    AnalyzerId,
    boolean
  >;

function enabledFor(ids: AnalyzerId[]): Record<AnalyzerId, boolean> {
  const map = noneEnabled();
  for (const id of ids) map[id] = true;
  return map;
}

export const MODE_PRESETS: Record<
  Exclude<AnalyzerMode, "manual">,
  AnalyzerConfig
> = {
  // Hardware crítico (4 GB RAM, dual-core, Android low-end): mínimo absoluto,
  // sem modelos de visão pesados — evita OOM/swap. Só fala, áudio e cenas.
  critico: {
    performance: {
      analysisFps: 0.33,
      analysisResolution: 256,
      maxObjects: 3,
      useWebGPU: false,
      useWasm: true,
    },
    precision: { minConfidence: 0.5 },
    enabled: enabledFor(["speech", "audio", "scene"]),
    objectClasses: [],
  },
  // Celulares e PCs fracos: só o essencial e baixa frequência.
  economico: {
    performance: {
      analysisFps: 0.5,
      analysisResolution: 320,
      maxObjects: 5,
      useWebGPU: false,
      useWasm: true,
    },
    precision: { minConfidence: 0.5 },
    enabled: enabledFor(["speech", "ocr", "audio", "scene"]),
    objectClasses: [],
  },
  balanceado: {
    performance: {
      analysisFps: 1,
      analysisResolution: 480,
      maxObjects: 12,
      useWebGPU: true,
      useWasm: true,
    },
    precision: { minConfidence: 0.45 },
enabled: enabledFor([
        "speech",
        "ocr",
        "audio",
        "music",
        "scene",
        "object",
        "tracker",
        "face",
        "pose",
        "hands",
      ]),
    objectClasses: [],
  },
  // PCs fortes: todos os detectores.
  avancado: {
    performance: {
      analysisFps: 2,
      analysisResolution: 640,
      maxObjects: 25,
      useWebGPU: true,
      useWasm: true,
    },
    precision: { minConfidence: 0.4 },
    enabled: enabledFor(ALL_ANALYZERS),
    objectClasses: [],
  },
};

const STORAGE_KEY = "animai.semantic.config";
const MODE_KEY = "animai.semantic.mode";
const AUTO_IMPORT_KEY = "animai.semantic.autoImport";

/** Analisar automaticamente a mídia ao importar (default: ligado). */
export function isAutoAnalyzeEnabled(): boolean {
  return localStorage.getItem(AUTO_IMPORT_KEY) !== "false";
}

export function setAutoAnalyzeEnabled(enabled: boolean): void {
  localStorage.setItem(AUTO_IMPORT_KEY, String(enabled));
}

/**
 * Detecta hardware muito limitado (4 GB RAM ou ≤2 núcleos) — nesses casos o
 * modo crítico evita OOM/swap. navigator.deviceMemory/hardwareConcurrency são
 * suportados em Chromium (Desktop Web/WebView e Android WebView).
 */
export function isCriticalHardware(): boolean {
  const mem = (navigator as { deviceMemory?: number }).deviceMemory;
  const cores = navigator.hardwareConcurrency;
  if (typeof mem === "number" && mem <= 4) return true;
  if (typeof cores === "number" && cores <= 2) return true;
  return false;
}

/**
 * Máx. de modelos de visão que podem inicializar em paralelo (Opt 3). Carregar
 * 4 modelos de uma vez estoura a RAM (OOM/swap) em máquinas fracas; capar a
 * concorrência troca um pouco de tempo de init por estabilidade. Derivado do
 * modo salvo; em "manual", cai pelo hardware.
 */
export function getMaxConcurrentModels(): number {
  const mode = getSavedMode();
  if (mode === "manual") return isCriticalHardware() ? 1 : 2;
  return MAX_CONCURRENT_MODELS[mode];
}

/** Default adaptado ao dispositivo (crítico → mínimo; low → econômico; …). */
export function defaultModeForTier(
  tier: "low" | "mid" | "high" | null,
): Exclude<AnalyzerMode, "manual"> {
  // Hardware muito fraco vence o tier: modo crítico para não travar.
  if (isCriticalHardware()) return "critico";
  if (tier === "high") return "avancado";
  if (tier === "low") return "economico";
  return "balanceado";
}

export function getSavedMode(): AnalyzerMode {
  // Sem escolha salva, adota o default pelo hardware (crítico se for o caso).
  const saved = localStorage.getItem(MODE_KEY) as AnalyzerMode | null;
  if (saved) return saved;
  return isCriticalHardware() ? "critico" : "balanceado";
}

export function getAnalyzerConfig(): AnalyzerConfig {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try {
      return JSON.parse(raw) as AnalyzerConfig;
    } catch {
      /* cai no preset */
    }
  }
  const mode = getSavedMode();
  return mode === "manual"
    ? MODE_PRESETS.balanceado
    : MODE_PRESETS[mode as Exclude<AnalyzerMode, "manual">];
}

export function setAnalyzerMode(mode: AnalyzerMode): AnalyzerConfig {
  localStorage.setItem(MODE_KEY, mode);
  if (mode !== "manual") {
    const preset = MODE_PRESETS[mode];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(preset));
    return preset;
  }
  return getAnalyzerConfig();
}

export function saveAnalyzerConfig(config: AnalyzerConfig): void {
  localStorage.setItem(MODE_KEY, "manual");
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

export function resolveConfig(config: AnalyzerConfig): ResolvedAnalyzerConfig {
  return config;
}
