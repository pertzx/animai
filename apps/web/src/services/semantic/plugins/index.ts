/**
 * Registry de plugins do Semantic Media Analyzer. Instancia apenas os
 * analisadores ativos na config. O tracker não é um plugin próprio: é aplicado
 * dentro do ObjectAnalyzer.finalize quando `tracker` está ativo, mas continua
 * exposto como toggle independente na UI.
 */

import type { AnalyzerConfig, SemanticAnalyzerPlugin } from "../types";
import { SpeechAnalyzer } from "./speech";
import { OcrAnalyzer } from "./ocr";
import { SceneAnalyzer } from "./scene";
import { AudioAnalyzer, MusicAnalyzer } from "./audio";
import { ObjectAnalyzer } from "./object";
import { FaceAnalyzer } from "./face";
import { PoseAnalyzer } from "./pose";
import { HandsAnalyzer } from "./hands";
import { EnvironmentAnalyzer } from "./environment";

export function createPlugins(
  config: AnalyzerConfig,
): SemanticAnalyzerPlugin[] {
  const on = config.enabled;
  const plugins: SemanticAnalyzerPlugin[] = [];

  if (on.speech) plugins.push(new SpeechAnalyzer());
  if (on.ocr) plugins.push(new OcrAnalyzer());
  if (on.scene) plugins.push(new SceneAnalyzer());
  if (on.audio) plugins.push(new AudioAnalyzer());
  if (on.music) plugins.push(new MusicAnalyzer());
  if (on.object || on.tracker) plugins.push(new ObjectAnalyzer());
  // Face habilita expressão (mesma inferência do FaceLandmarker).
  if (on.face || on.expression) plugins.push(new FaceAnalyzer());
  if (on.pose) plugins.push(new PoseAnalyzer());
  if (on.hands) plugins.push(new HandsAnalyzer());
  if (on.environment) plugins.push(new EnvironmentAnalyzer());

  return plugins;
}
