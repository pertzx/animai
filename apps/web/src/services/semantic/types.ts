/**
 * Semantic Media Analyzer (prompt.txt) — tipos base.
 *
 * O analisador roda 100% localmente (modelos open-source, WebGPU/WASM) e
 * produz uma Timeline Semântica de eventos com timestamps. A IA nunca recebe
 * o vídeo: ela consome apenas os SemanticEvent[] gerados aqui.
 */

/** Evento semântico — unidade de saída de todo plugin. */
export interface SemanticEvent {
  /** Início em segundos. */
  start: number;
  /** Fim em segundos (== start para eventos instantâneos). */
  end: number;
  /** Categoria: "speech", "object", "face_smile", "scene_cut", … */
  type: string;
  /** 0..1 */
  confidence: number;
  metadata: Record<string, unknown>;
}

/** Tipos de analisador (plugins independentes, ativáveis/desativáveis). */
export type AnalyzerId =
  | "speech"
  | "ocr"
  | "scene"
  | "object"
  | "tracker"
  | "face"
  | "expression"
  | "pose"
  | "hands"
  | "audio"
  | "music"
  | "environment";

/** Um frame amostrado do vídeo (imagem + tempo na timeline). */
export interface AnalyzerFrame {
  /** Tempo do frame em segundos. */
  time: number;
  /** Bitmap pronto para modelos de visão (dimensões já reduzidas). */
  bitmap: ImageBitmap;
  width: number;
  height: number;
  /** Índice do frame na amostragem. */
  index: number;
}

/** Contexto passado a cada análise (config resolvida + acesso a áudio). */
export interface AnalyzerContext {
  /** Duração total da mídia em segundos. */
  durationSec: number;
  /** Config efetiva do analisador. */
  config: ResolvedAnalyzerConfig;
  /** PCM mono 16 kHz da mídia (para plugins de áudio); null se indisponível. */
  audioPcm: Float32Array | null;
  /** Blob da mídia (para plugins que precisam do arquivo, ex.: STT). */
  mediaBlob: Blob;
  /** Reporta progresso 0..1 (para a UI). */
  reportProgress?: (fraction: number) => void;
  /** Aborta a análise quando sinalizado. */
  signal: AbortSignal;
}

/**
 * Interface comum de todo analisador. Um plugin baseado em frames processa
 * cada frame amostrado; um plugin de nível de sequência (áudio, STT)
 * implementa `analyzeSequence`. `analyze` agrega tudo em SemanticEvent[].
 */
export interface SemanticAnalyzerPlugin {
  readonly id: AnalyzerId;
  readonly label: string;
  /** Precisa de frames de vídeo? (false para plugins puramente de áudio). */
  readonly usesFrames: boolean;
  /** Precisa do PCM de áudio? */
  readonly usesAudio: boolean;

  /** Carrega modelos/recursos. Idempotente. */
  init(context: AnalyzerContext): Promise<void>;

  /**
   * Analisa um frame (plugins de visão). Retorna eventos parciais desse
   * instante — o Timeline Builder consolida depois. Pode devolver detecções
   * intermediárias em `context`-scoped state.
   */
  analyzeFrame?(
    frame: AnalyzerFrame,
    context: AnalyzerContext,
  ): Promise<SemanticEvent[]>;

  /**
   * Analisa a mídia inteira de uma vez (áudio/STT). Chamado uma vez.
   */
  analyzeSequence?(context: AnalyzerContext): Promise<SemanticEvent[]>;

  /**
   * Finaliza: consolida eventos acumulados entre frames (ex.: tracking,
   * agrupar detecções contíguas). Recebe os eventos brutos deste plugin.
   */
  finalize?(
    rawEvents: SemanticEvent[],
    context: AnalyzerContext,
  ): SemanticEvent[];

  /** Libera modelos/GPU. */
  dispose(): void;
}

// ── Configuração ────────────────────────────────────────────────────

export interface PerformanceConfig {
  /** Frames analisados por segundo de vídeo. */
  analysisFps: number;
  /** Lado maior da resolução de análise, em pixels. */
  analysisResolution: number;
  /** Máx. de objetos por frame. */
  maxObjects: number;
  useWebGPU: boolean;
  useWasm: boolean;
}

export interface PrecisionConfig {
  /** Confiança mínima para aceitar uma detecção. */
  minConfidence: number;
}

export interface AnalyzerConfig {
  performance: PerformanceConfig;
  precision: PrecisionConfig;
  /** Quais analisadores estão ativos. */
  enabled: Record<AnalyzerId, boolean>;
  /** Classes de objeto que o usuário quer detectar (vazio = todas). */
  objectClasses: string[];
}

/** Config resolvida (sem opcionais) passada aos plugins. */
export type ResolvedAnalyzerConfig = AnalyzerConfig;

/** Timeline semântica final. */
export interface SemanticTimeline {
  durationSec: number;
  generatedAt: number;
  /** Eventos ordenados por start. */
  events: SemanticEvent[];
  /** Resumo legível "00:05 Pessoa aparece …" para UI e IA. */
  summary: SemanticSummaryLine[];
  /** Contagem por tipo (para painéis). */
  counts: Record<string, number>;
}

export interface SemanticSummaryLine {
  time: number;
  text: string;
}
