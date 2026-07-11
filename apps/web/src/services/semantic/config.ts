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

export type AnalyzerMode = "economico" | "balanceado" | "avancado" | "manual";

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

/** Default adaptado ao dispositivo (low → econômico, mid → balanceado, …). */
export function defaultModeForTier(
  tier: "low" | "mid" | "high" | null,
): Exclude<AnalyzerMode, "manual"> {
  if (tier === "high") return "avancado";
  if (tier === "low") return "economico";
  return "balanceado";
}

export function getSavedMode(): AnalyzerMode {
  return (localStorage.getItem(MODE_KEY) as AnalyzerMode) ?? "balanceado";
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
