/**
 * Assinatura de config por plugin (Opt 9 — cache granular).
 *
 * Cada detector depende só de um subconjunto da config. A assinatura inclui
 * exatamente os campos que mudam a saída daquele plugin, para que trocar um
 * parâmetro invalide apenas os detectores afetados — e reaproveite o resto.
 *
 * Regra de ouro: na dúvida, INCLUIR o campo. Incluir demais só causa
 * reprocessamento a mais (correto, só menos econômico); incluir de menos
 * devolve resultado obsoleto (incorreto).
 */

import type { AnalyzerConfig, AnalyzerId } from "./types";

/** Plugins de áudio/STT dependem só da mídia, não da config de visão. */
const MEDIA_ONLY: AnalyzerId[] = ["speech", "audio", "music"];

export function pluginSignature(
  id: AnalyzerId,
  config: AnalyzerConfig,
): string {
  // Whisper/áudio: nunca reprocessa por causa de um ajuste de visão.
  if (MEDIA_ONLY.includes(id)) return `${id}:v1`;

  const p = config.performance;
  const base: Record<string, unknown> = {
    v: 1,
    // Amostragem de frames afeta todo plugin de visão.
    fps: p.analysisFps,
    res: p.analysisResolution,
  };
  // Scene é histograma de corte — não usa limiar de confiança.
  if (id !== "scene") base.minConf = config.precision.minConfidence;
  if (id === "object") {
    base.maxObjects = p.maxObjects;
    base.classes = [...config.objectClasses].sort();
    base.tracker = config.enabled.tracker;
  }
  return `${id}:${JSON.stringify(base)}`;
}
