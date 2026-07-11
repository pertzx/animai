/**
 * AI agent tools (prd.txt §3.3).
 *
 * Each tool maps to mutations on the project store, which routes through the
 * editor's action system — so everything the AI does lands in the same
 * undo/redo history as manual edits. Tool errors are returned (not thrown)
 * so the agent loop can feed them back to the model for self-correction.
 */

import type { Transition, TransitionType, Subtitle } from "@openreel/core";
import { shortId } from "../../lib/short-id";
import { useProjectStore } from "../../stores/project-store";
import { apiRequest, useAuthStore } from "../../stores/auth-store";
import type { VideoEffectType } from "../../bridges/effects-bridge";
import {
  getCurrentProjectContext,
  buildProjectContext,
} from "./project-context";
import { insightsManager } from "./insights-manager";
import { transcriptionManager } from "./transcription-manager";

/** OpenAI-compatible tool definition sent to the LLM. */
export interface AiToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  /** Bulk-destructive tools require user confirmation before running (prd.txt §4). */
  destructive?: boolean;
}

export interface AiToolResult {
  ok: boolean;
  result?: unknown;
  error?: string;
}

const VIDEO_EFFECT_TYPES: VideoEffectType[] = [
  "brightness",
  "contrast",
  "saturation",
  "hue",
  "blur",
  "sharpen",
  "vignette",
  "grain",
  "temperature",
  "tint",
  "chromaKey",
  "shadow",
  "glow",
  "motion-blur",
  "radial-blur",
  "chromatic-aberration",
];

const TRANSITION_TYPES = [
  "crossfade",
  "dipToBlack",
  "dipToWhite",
  "wipe",
  "slide",
  "zoom",
  "push",
];

export const AI_TOOLS: AiToolDefinition[] = [
  {
    name: "get_project_state",
    description:
      "Retorna o JSON global do projeto: timeline, tracks, clipes (com ids e tempos em segundos), efeitos, transições, textos, legendas e mídia disponível. Use antes de editar para obter ids atualizados.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_transcript",
    description:
      "Retorna a transcrição (speech-to-text local) de uma mídia, com segmentos {start, end, text} em segundos do tempo da mídia. Sem mediaId, retorna todas as transcrições.",
    parameters: {
      type: "object",
      properties: {
        mediaId: { type: "string", description: "Id da mídia (opcional)" },
      },
      required: [],
    },
  },
  {
    name: "get_media_insights",
    description:
      "Análise local completa de uma mídia: perfil de áudio (segmentos de energia, silêncio, BPM) e texto embutido na tela (OCR). O contexto do projeto já traz um resumo em media[].insights — use esta tool apenas quando a mídia ainda não tem insights (a tool dispara a análise e espera terminar) ou quando precisar de todos os segmentos sem compactação.",
    parameters: {
      type: "object",
      properties: {
        mediaId: { type: "string", description: "Id da mídia (opcional)" },
      },
      required: [],
    },
  },
  {
    name: "run_semantic_analysis",
    description:
      "Roda o Semantic Media Analyzer local (visão + áudio, sem enviar o vídeo a lugar nenhum) e gera a Timeline Semântica da mídia: pessoas/objetos/veículos/animais detectados e rastreados, rostos e expressões (sorriso, surpresa…), poses, gestos, cenas/cortes, textos na tela, fala, música, silêncio e ambiente. Demora (pode levar minutos). Use antes de find_moments/cut_silences se a mídia ainda não foi analisada.",
    parameters: {
      type: "object",
      properties: {
        mediaId: { type: "string", description: "Id da mídia (opcional; usa a 1ª com vídeo)" },
        force: { type: "boolean", description: "Reanalisar mesmo se já houver timeline" },
      },
      required: [],
    },
  },
  {
    name: "get_semantic_timeline",
    description:
      "Retorna a Timeline Semântica já gerada de uma mídia (eventos {start,end,type,confidence,metadata}). Filtre por types para reduzir tokens. Não dispara análise — se não existir, chame run_semantic_analysis antes.",
    parameters: {
      type: "object",
      properties: {
        mediaId: { type: "string" },
        types: {
          type: "array",
          items: { type: "string" },
          description: "Filtra por tipos (ex.: [\"object\",\"face_smile\",\"silence\"])",
        },
        limit: { type: "number", default: 200 },
      },
      required: [],
    },
  },
  {
    name: "find_moments",
    description:
      "Busca momentos na Timeline Semântica por intenção. query aceita: silêncio, fala, sorriso, surpresa, rosto, pessoa, animal, veículo, carro, objeto (ou um rótulo), gesto, pose, música, corte de cena, texto, ambiente. Retorna intervalos {start,end} ordenados por relevância — use com split_clip/trim_clip/delete_clip/apply_camera_move para editar por intenção.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string" },
        mediaId: { type: "string" },
        maxResults: { type: "number", default: 30 },
      },
      required: ["query"],
    },
  },
  {
    name: "cut_silences",
    description:
      "Remove automaticamente os trechos de silêncio da timeline usando a Timeline Semântica (divide os clipes e apaga os pedaços silenciosos). Requer análise semântica ou de áudio prévia da mídia.",
    parameters: {
      type: "object",
      properties: {
        mediaId: { type: "string" },
        minSilenceSec: { type: "number", default: 0.8 },
      },
      required: [],
    },
  },
  {
    name: "split_clip",
    description:
      "Divide um clipe em dois no tempo indicado (segundos, tempo da timeline).",
    parameters: {
      type: "object",
      properties: {
        clipId: { type: "string" },
        timeSec: { type: "number", description: "Tempo da timeline em segundos" },
      },
      required: ["clipId", "timeSec"],
    },
  },
  {
    name: "trim_clip",
    description:
      "Ajusta os pontos de entrada/saída de um clipe (segundos relativos à mídia de origem). Informe inPointSec, outPointSec ou ambos.",
    parameters: {
      type: "object",
      properties: {
        clipId: { type: "string" },
        inPointSec: { type: "number" },
        outPointSec: { type: "number" },
      },
      required: ["clipId"],
    },
  },
  {
    name: "move_clip",
    description:
      "Move um clipe para outro tempo de início na timeline e opcionalmente outra track.",
    parameters: {
      type: "object",
      properties: {
        clipId: { type: "string" },
        startTimeSec: { type: "number" },
        trackId: { type: "string", description: "Track de destino (opcional)" },
      },
      required: ["clipId", "startTimeSec"],
    },
  },
  {
    name: "delete_clip",
    description: "Remove um clipe da timeline.",
    parameters: {
      type: "object",
      properties: { clipId: { type: "string" } },
      required: ["clipId"],
    },
  },
  {
    name: "delete_clips",
    description:
      "Remove vários clipes da timeline de uma vez. Ação destrutiva em massa: o usuário confirma antes da execução.",
    parameters: {
      type: "object",
      properties: {
        clipIds: { type: "array", items: { type: "string" } },
      },
      required: ["clipIds"],
    },
    destructive: true,
  },
  {
    name: "add_clip",
    description:
      "Adiciona uma mídia da biblioteca à timeline. Sem trackId, cria uma track nova adequada ao tipo da mídia.",
    parameters: {
      type: "object",
      properties: {
        mediaId: { type: "string" },
        trackId: { type: "string" },
        startTimeSec: { type: "number", default: 0 },
      },
      required: ["mediaId"],
    },
  },
  {
    name: "list_catalog",
    description:
      "Lista o catálogo do admin (efeitos, transições, animações e templates publicados) com id, nome, descrição e payload. Use catalogItemId em apply_effect para aplicar um efeito do catálogo.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "apply_effect",
    description: `Aplica um efeito de vídeo a um clipe. Tipos nativos: ${VIDEO_EFFECT_TYPES.join(", ")}. Params opcionais dependem do efeito (ex.: {"intensity": 0.5}). Alternativa: informe catalogItemId de um efeito do catálogo do admin (veja list_catalog).`,
    parameters: {
      type: "object",
      properties: {
        clipId: { type: "string" },
        effectType: { type: "string", enum: VIDEO_EFFECT_TYPES },
        params: { type: "object" },
        catalogItemId: { type: "string" },
      },
      required: ["clipId"],
    },
  },
  {
    name: "remove_effect",
    description: "Remove um efeito de um clipe pelo id do efeito.",
    parameters: {
      type: "object",
      properties: {
        clipId: { type: "string" },
        effectId: { type: "string" },
      },
      required: ["clipId", "effectId"],
    },
  },
  {
    name: "apply_transition",
    description: `Cria uma transição entre dois clipes adjacentes da mesma track. Tipos: ${TRANSITION_TYPES.join(", ")}.`,
    parameters: {
      type: "object",
      properties: {
        clipAId: { type: "string", description: "Clipe à esquerda" },
        clipBId: { type: "string", description: "Clipe à direita" },
        type: { type: "string", enum: TRANSITION_TYPES },
        durationSec: { type: "number", default: 1 },
      },
      required: ["clipAId", "clipBId", "type"],
    },
  },
  {
    name: "list_templates",
    description:
      "Lista os templates de edição disponíveis (id, nome, categoria) para usar com apply_template.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "apply_template",
    description: "Aplica um template de edição a um clipe.",
    parameters: {
      type: "object",
      properties: {
        templateId: { type: "string" },
        clipId: { type: "string" },
        overrides: { type: "object" },
      },
      required: ["templateId", "clipId"],
    },
  },
  {
    name: "add_text",
    description:
      "Adiciona um texto/título na timeline. Cria a track de texto se necessário. animationPreset opcional (ex.: typewriter, fade, slide, bounce).",
    parameters: {
      type: "object",
      properties: {
        text: { type: "string" },
        startTimeSec: { type: "number" },
        durationSec: { type: "number", default: 3 },
        animationPreset: { type: "string" },
      },
      required: ["text", "startTimeSec"],
    },
  },
  {
    name: "add_captions",
    description:
      "Gera legendas na timeline a partir da transcrição local de uma mídia, sincronizadas com os clipes dessa mídia. Requer transcrição existente (veja get_transcript).",
    parameters: {
      type: "object",
      properties: {
        mediaId: {
          type: "string",
          description:
            "Mídia de origem. Sem mediaId, usa todas as mídias transcritas na timeline.",
        },
      },
      required: [],
    },
  },
  {
    name: "apply_camera_move",
    description:
      "Movimento de câmera 2D estilo Alight Motion aplicado à cena: keyframes {timeSec, x, y, zoom} (x/y em pixels do projeto com 0,0 no centro; zoom 1 = normal). O movimento é convertido em keyframes de position/scale nos clipes de vídeo/imagem do intervalo (funciona no preview e no export; um undo desfaz tudo). Ex.: zoom-in lento = [{timeSec:0,x:0,y:0,zoom:1},{timeSec:5,x:0,y:0,zoom:1.3}].",
    parameters: {
      type: "object",
      properties: {
        keyframes: {
          type: "array",
          items: {
            type: "object",
            properties: {
              timeSec: { type: "number" },
              x: { type: "number" },
              y: { type: "number" },
              zoom: { type: "number" },
            },
            required: ["timeSec", "zoom"],
          },
        },
        clipIds: {
          type: "array",
          items: { type: "string" },
          description: "Opcional: limitar a clipes específicos",
        },
      },
      required: ["keyframes"],
    },
  },
  {
    name: "list_components",
    description:
      "Lista os componentes reutilizáveis salvos pelo usuário (biblioteca cross-project): id, nome, duração, nº de clipes.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "insert_component",
    description:
      "Insere um componente da biblioteca do usuário na timeline do projeto atual (re-importa as mídias e recria os clipes com efeitos/keyframes).",
    parameters: {
      type: "object",
      properties: {
        componentId: { type: "string" },
        atSec: { type: "number", default: 0 },
      },
      required: ["componentId"],
    },
  },
  {
    name: "save_component",
    description:
      "Salva os clipes SELECIONADOS pelo usuário na timeline como componente reutilizável na biblioteca (use editorState.selectedClips para confirmar que há seleção).",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
        transparentBackground: { type: "boolean", default: true },
      },
      required: ["name"],
    },
  },
  {
    name: "add_vector",
    description:
      "Adiciona um vetor (SVG) à timeline como clipe gráfico. Use presetId da biblioteca (veja list_vector_presets) OU desenhe você mesmo passando markup SVG completo em svg (viewBox 0 0 100 100, use #ffffff para permitir tint). Ideal para setas, destaques, balões de fala e desenhos custom.",
    parameters: {
      type: "object",
      properties: {
        presetId: { type: "string", description: "Id de um vetor pré-pronto" },
        svg: {
          type: "string",
          description: "Markup SVG completo (alternativa ao presetId)",
        },
        startTimeSec: { type: "number", default: 0 },
        durationSec: { type: "number", default: 5 },
      },
      required: [],
    },
  },
  {
    name: "list_vector_presets",
    description:
      "Lista os vetores pré-prontos disponíveis (id, nome, categoria) para usar com add_vector.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "import_attachment",
    description:
      "Importa um arquivo anexado pelo usuário no chat para a biblioteca de mídia do projeto. Use o id do anexo informado na mensagem (att-xxxx). Com addToTimelineAtSec, também adiciona o arquivo à timeline nesse tempo.",
    parameters: {
      type: "object",
      properties: {
        attachmentId: { type: "string" },
        addToTimelineAtSec: {
          type: "number",
          description: "Opcional: adiciona à timeline neste tempo (segundos)",
        },
      },
      required: ["attachmentId"],
    },
  },
  {
    name: "web_search",
    description:
      "Pesquisa na web e retorna resultados (título, url, resumo). Use para buscar referências externas: tendências de edição, informações sobre músicas/pessoas/eventos citados no vídeo, fatos atuais.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Termos da pesquisa" },
        maxResults: { type: "number", default: 5 },
      },
      required: ["query"],
    },
  },
  {
    name: "adjust_audio",
    description:
      "Ajusta o áudio de um clipe: volume (0 a 2, 1 = original), fade in/out em segundos, ou muta/desmuta a track do clipe.",
    parameters: {
      type: "object",
      properties: {
        clipId: { type: "string" },
        volume: { type: "number" },
        fadeInSec: { type: "number" },
        fadeOutSec: { type: "number" },
        trackMuted: { type: "boolean" },
      },
      required: ["clipId"],
    },
  },
];

export function getToolDefinition(name: string): AiToolDefinition | undefined {
  return AI_TOOLS.find((t) => t.name === name);
}

type Store = ReturnType<typeof useProjectStore.getState>;

function findClip(store: Store, clipId: string) {
  for (const track of store.project.timeline.tracks) {
    const clip = track.clips.find((c) => c.id === clipId);
    if (clip) return { clip, track };
  }
  return null;
}

/** Patch clip fields that have no dedicated store action (volume/fade). */
function patchClip(
  clipId: string,
  patch: { volume?: number; fade?: { fadeIn: number; fadeOut: number } },
): boolean {
  let found = false;
  useProjectStore.setState((state) => ({
    project: {
      ...state.project,
      modifiedAt: Date.now(),
      timeline: {
        ...state.project.timeline,
        tracks: state.project.timeline.tracks.map((track) => ({
          ...track,
          clips: track.clips.map((clip) => {
            if (clip.id !== clipId) return clip;
            found = true;
            return { ...clip, ...patch };
          }),
        })),
      },
    },
  }));
  return found;
}

const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;
const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.length > 0 ? v : undefined;

/** Primeira mídia de vídeo do projeto (fallback quando a IA não passa id). */
function firstVideoMediaId(store: Store): string | null {
  return (
    store.project.mediaLibrary.items.find((m) => m.type === "video")?.id ?? null
  );
}

interface SemanticEventLike {
  start: number;
  end: number;
  type: string;
  confidence: number;
  metadata: Record<string, unknown>;
}

/** Mapeia a intenção da busca (query) para um predicado sobre os eventos. */
function buildMomentMatcher(
  query: string,
): (e: SemanticEventLike) => boolean {
  const q = query.toLowerCase();
  const has = (...words: string[]) => words.some((w) => q.includes(w));

  if (has("silêncio", "silencio", "silence"))
    return (e) => e.type === "silence";
  if (has("fala", "falando", "speech", "voz"))
    return (e) => e.type === "speech";
  if (has("sorri", "smile"))
    return (e) => e.type === "face_smile";
  if (has("surpres", "surprise"))
    return (e) => e.type === "face_surprise";
  if (has("rosto", "face", "cara"))
    return (e) => e.type.startsWith("face");
  if (has("gesto", "gesture", "mão", "mao"))
    return (e) => e.type === "gesture";
  if (has("pose"))
    return (e) => e.type === "pose";
  if (has("música", "musica", "music"))
    return (e) => e.type === "music";
  if (has("corte", "cena", "scene", "cut", "transi"))
    return (e) => e.type === "scene_cut" || e.type === "scene_fade";
  if (has("texto", "text"))
    return (e) => e.type === "onscreen_text";
  if (has("ambiente", "cenário", "cenario", "environment", "lugar"))
    return (e) => e.type === "environment";

  const animals = ["cachorro", "gato", "pássaro", "passaro", "cavalo", "animal"];
  const vehicles = ["carro", "moto", "ônibus", "onibus", "caminhão", "caminhao", "bicicleta", "veículo", "veiculo"];
  if (has(...animals)) {
    const set = new Set(["Cachorro", "Gato", "Pássaro", "Cavalo"]);
    return (e) => e.type === "object" && set.has(String(e.metadata.label));
  }
  if (has(...vehicles)) {
    const set = new Set(["Carro", "Moto", "Ônibus", "Caminhão", "Bicicleta"]);
    return (e) => e.type === "object" && set.has(String(e.metadata.label));
  }
  if (has("pessoa", "gente", "person"))
    return (e) => e.type === "object" && String(e.metadata.label) === "Pessoa";

  // Genérico: casa contra o rótulo do objeto ou o texto na tela.
  return (e) =>
    (e.type === "object" &&
      String(e.metadata.label ?? "").toLowerCase().includes(q)) ||
    (e.type === "onscreen_text" &&
      String(e.metadata.text ?? "").toLowerCase().includes(q));
}

/**
 * Remove silêncios da timeline: para cada clipe da mídia, corta as janelas
 * silenciosas (mapeadas do tempo de mídia para o tempo do clipe) via
 * split + delete. Agrupado no histórico (um undo desfaz tudo).
 */
async function cutSilencesOnTimeline(
  store: Store,
  mediaId: string,
  silences: SemanticEventLike[],
): Promise<number> {
  let removed = 0;
  store.beginHistoryGroup("IA: cortar silêncios");
  try {
    for (const silence of silences.sort((a, b) => b.start - a.start)) {
      // Reavalia clipes a cada iteração (splits mudam a timeline).
      const clips = useProjectStore
        .getState()
        .project.timeline.tracks.flatMap((t) => t.clips)
        .filter((c) => c.mediaId === mediaId);
      for (const clip of clips) {
        const clipMediaStart = clip.inPoint;
        const clipMediaEnd = clip.outPoint;
        // Interseção do silêncio (tempo de mídia) com a janela do clipe.
        const s = Math.max(silence.start, clipMediaStart);
        const e = Math.min(silence.end, clipMediaEnd);
        if (e - s < 0.3) continue;
        // Converte para tempo da timeline.
        const tlStart = clip.startTime + (s - clipMediaStart);
        const tlEnd = clip.startTime + (e - clipMediaStart);
        // split no fim, split no início, e apaga o pedaço do meio.
        if (tlEnd < clip.startTime + clip.duration - 0.05) {
          await store.splitClip(clip.id, tlEnd);
        }
        const splitStart = await store.splitClip(clip.id, tlStart);
        // Após split no início, o pedaço silencioso é o clipe seguinte.
        const after = useProjectStore
          .getState()
          .project.timeline.tracks.flatMap((t) => t.clips)
          .find(
            (c) =>
              c.mediaId === mediaId &&
              Math.abs(c.startTime - tlStart) < 0.05,
          );
        if (splitStart.success && after) {
          await store.removeClip(after.id);
          removed++;
        }
        break; // um clipe por silêncio por iteração
      }
    }
  } finally {
    store.endHistoryGroup();
  }
  return removed;
}

export async function executeAiTool(
  name: string,
  args: Record<string, unknown>,
): Promise<AiToolResult> {
  const store = useProjectStore.getState();
  try {
    switch (name) {
      case "get_project_state":
        return { ok: true, result: getCurrentProjectContext() };

      case "get_transcript": {
        const context = getCurrentProjectContext();
        const mediaId = str(args.mediaId);
        const transcripts = mediaId
          ? context.transcripts.filter((t) => t.mediaId === mediaId)
          : context.transcripts;
        if (mediaId && transcripts.length === 0) {
          // Dispara a transcrição agora para a próxima tentativa funcionar.
          transcriptionManager.enqueue(mediaId);
          return {
            ok: false,
            error: `Nenhuma transcrição para a mídia ${mediaId}. A transcrição local foi iniciada agora — tente novamente em ~1 minuto, ou o áudio pode não conter fala (use get_media_insights para o perfil de áudio).`,
          };
        }
        return { ok: true, result: transcripts };
      }

      case "get_media_insights": {
        const mediaId = str(args.mediaId);
        const names = new Map(
          store.project.mediaLibrary.items.map((m) => [m.id, m.name]),
        );

        if (mediaId && !names.has(mediaId)) {
          return { ok: false, error: `Mídia ${mediaId} não existe no projeto.` };
        }

        // Garante a análise das mídias pedidas, disparando-a se necessário
        // (a tool espera a análise local terminar — pode levar ~1 min).
        const targetIds = mediaId
          ? [mediaId]
          : store.project.mediaLibrary.items
              .filter((m) => m.type !== "image")
              .map((m) => m.id);
        const selected = (
          await Promise.all(
            targetIds.map((id) => insightsManager.waitForInsight(id)),
          )
        ).filter((i): i is NonNullable<typeof i> => i !== null);

        if (selected.length === 0) {
          return {
            ok: false,
            error:
              "A análise local falhou ou não terminou a tempo. Peça ao usuário para clicar em 'reanalisar mídias' no painel do assistente e verificar avisos na tela.",
          };
        }
        return {
          ok: true,
          result: selected.map((i) => ({
            mediaId: i.mediaId,
            mediaName: names.get(i.mediaId) ?? "unknown",
            audio: i.audio ?? null,
            onScreenText:
              i.onScreenText && i.onScreenText.length > 0
                ? i.onScreenText
                : "nenhum texto legível detectado nos frames amostrados",
          })),
        };
      }

      case "run_semantic_analysis": {
        const { ensureSemanticTimeline } = await import("../semantic/run");
        const mediaId = str(args.mediaId) ?? firstVideoMediaId(store);
        if (!mediaId) {
          return { ok: false, error: "Nenhuma mídia de vídeo no projeto." };
        }
        const timeline = await ensureSemanticTimeline(mediaId, {
          force: args.force === true,
        });
        if (!timeline) {
          return {
            ok: false,
            error:
              "Não foi possível analisar a mídia (indisponível localmente ou sem duração).",
          };
        }
        return {
          ok: true,
          result: {
            mediaId,
            totalEvents: timeline.events.length,
            counts: timeline.counts,
            summary: timeline.summary.slice(0, 40).map((l) => l.text),
          },
        };
      }

      case "get_semantic_timeline": {
        const { getCachedTimeline } = await import("../semantic/run");
        const mediaId = str(args.mediaId) ?? firstVideoMediaId(store);
        if (!mediaId) return { ok: false, error: "Nenhuma mídia de vídeo." };
        const timeline = await getCachedTimeline(mediaId);
        if (!timeline) {
          return {
            ok: false,
            error: "Sem timeline semântica para esta mídia. Chame run_semantic_analysis primeiro.",
          };
        }
        const types = Array.isArray(args.types)
          ? args.types.map(String)
          : null;
        const limit = num(args.limit) ?? 200;
        let events = timeline.events;
        if (types) events = events.filter((e) => types.includes(e.type));
        return {
          ok: true,
          result: {
            mediaId,
            durationSec: timeline.durationSec,
            counts: timeline.counts,
            events: events.slice(0, limit),
          },
        };
      }

      case "find_moments": {
        const { getCachedTimeline } = await import("../semantic/run");
        const mediaId = str(args.mediaId) ?? firstVideoMediaId(store);
        if (!mediaId) return { ok: false, error: "Nenhuma mídia de vídeo." };
        const timeline = await getCachedTimeline(mediaId);
        if (!timeline) {
          return {
            ok: false,
            error: "Sem timeline semântica. Chame run_semantic_analysis primeiro.",
          };
        }
        const query = (str(args.query) ?? "").toLowerCase();
        const matcher = buildMomentMatcher(query);
        const moments = timeline.events
          .filter(matcher)
          .sort((a, b) => b.confidence - a.confidence)
          .slice(0, num(args.maxResults) ?? 30)
          .map((e) => ({
            start: e.start,
            end: e.end,
            type: e.type,
            confidence: e.confidence,
            label: e.metadata.label ?? e.metadata.text ?? e.metadata.pose ??
              e.metadata.gesture ?? e.metadata.scene ?? e.metadata.event,
          }))
          .sort((a, b) => a.start - b.start);
        return moments.length > 0
          ? { ok: true, result: { mediaId, moments } }
          : { ok: false, error: `Nenhum momento encontrado para "${query}".` };
      }

      case "cut_silences": {
        const { getCachedTimeline } = await import("../semantic/run");
        const mediaId = str(args.mediaId) ?? firstVideoMediaId(store);
        if (!mediaId) return { ok: false, error: "Nenhuma mídia de vídeo." };
        const timeline = await getCachedTimeline(mediaId);
        if (!timeline) {
          return {
            ok: false,
            error: "Sem timeline semântica. Chame run_semantic_analysis primeiro.",
          };
        }
        const minSilence = num(args.minSilenceSec) ?? 0.8;
        const silences = timeline.events.filter(
          (e) => e.type === "silence" && e.end - e.start >= minSilence,
        );
        if (silences.length === 0) {
          return { ok: false, error: "Nenhum silêncio relevante encontrado." };
        }
        const removed = await cutSilencesOnTimeline(store, mediaId, silences);
        return removed > 0
          ? { ok: true, result: `${removed} trecho(s) de silêncio removido(s).` }
          : {
              ok: false,
              error:
                "Silêncios detectados, mas nenhum clipe dessa mídia está na timeline.",
            };
      }

      case "split_clip": {
        const r = await store.splitClip(
          String(args.clipId),
          num(args.timeSec) ?? 0,
        );
        return r.success
          ? { ok: true, result: describeClips(String(args.clipId)) }
          : { ok: false, error: r.error?.message ?? "split falhou" };
      }

      case "trim_clip": {
        const r = await store.trimClip(
          String(args.clipId),
          num(args.inPointSec),
          num(args.outPointSec),
        );
        return r.success
          ? { ok: true, result: describeClips(String(args.clipId)) }
          : { ok: false, error: r.error?.message ?? "trim falhou" };
      }

      case "move_clip": {
        const r = await store.moveClip(
          String(args.clipId),
          num(args.startTimeSec) ?? 0,
          str(args.trackId),
        );
        return r.success
          ? { ok: true, result: describeClips(String(args.clipId)) }
          : { ok: false, error: r.error?.message ?? "move falhou" };
      }

      case "delete_clip": {
        const r = await store.removeClip(String(args.clipId));
        return r.success
          ? { ok: true, result: "clipe removido" }
          : { ok: false, error: r.error?.message ?? "remoção falhou" };
      }

      case "delete_clips": {
        const ids = Array.isArray(args.clipIds)
          ? args.clipIds.map(String)
          : [];
        if (ids.length === 0) return { ok: false, error: "clipIds vazio" };
        store.beginHistoryGroup("IA: remover clipes");
        const failures: string[] = [];
        try {
          for (const id of ids) {
            const r = await store.removeClip(id);
            if (!r.success) failures.push(id);
          }
        } finally {
          store.endHistoryGroup();
        }
        return failures.length === 0
          ? { ok: true, result: `${ids.length} clipes removidos` }
          : {
              ok: false,
              error: `Falha ao remover: ${failures.join(", ")}`,
            };
      }

      case "add_clip": {
        const mediaId = String(args.mediaId);
        const startTime = num(args.startTimeSec) ?? 0;
        const trackId = str(args.trackId);
        const r = trackId
          ? await store.addClip(trackId, mediaId, startTime)
          : await store.addClipToNewTrack(mediaId, startTime);
        return r.success
          ? { ok: true, result: latestTimelineSummary() }
          : { ok: false, error: r.error?.message ?? "add falhou" };
      }

      case "list_catalog": {
        const catalog = useAuthStore.getState().catalog;
        return {
          ok: true,
          result: catalog.map((c) => ({
            id: c.id,
            kind: c.kind,
            name: c.name,
            description: c.description,
            payload: c.payload,
          })),
        };
      }

      case "apply_effect": {
        let effectType = str(args.effectType);
        let params = (args.params as Record<string, unknown>) ?? undefined;
        const catalogItemId = str(args.catalogItemId);
        if (catalogItemId) {
          const authState = useAuthStore.getState();
          const item = authState.catalog.find((c) => c.id === catalogItemId);
          if (!item) {
            return { ok: false, error: "item do catálogo não encontrado" };
          }
          if (item.premium && !authState.user?.planFeatures?.premiumCatalog) {
            return {
              ok: false,
              error: `"${item.name}" é premium — o plano atual do usuário não inclui o catálogo premium. Sugira o upgrade ou use um efeito nativo.`,
            };
          }
          effectType =
            (item.payload.effectType as string | undefined) ?? effectType;
          params =
            (item.payload.params as Record<string, unknown> | undefined) ??
            params;
        }
        if (!effectType) {
          return {
            ok: false,
            error: "informe effectType ou catalogItemId",
          };
        }
        const effect = store.addVideoEffect(
          String(args.clipId),
          effectType as VideoEffectType,
          params,
        );
        return effect
          ? { ok: true, result: { effectId: effect.id, type: effect.type } }
          : {
              ok: false,
              error:
                "Não foi possível aplicar o efeito (clipe inexistente ou tipo inválido).",
            };
      }

      case "remove_effect": {
        const ok = store.removeVideoEffect(
          String(args.clipId),
          String(args.effectId),
        );
        return ok
          ? { ok: true, result: "efeito removido" }
          : { ok: false, error: "efeito ou clipe não encontrado" };
      }

      case "apply_transition": {
        const clipAId = String(args.clipAId);
        const clipBId = String(args.clipBId);
        const location = findClip(store, clipAId);
        if (!location) return { ok: false, error: "clipA não encontrado" };
        const transition: Transition = {
          id: shortId("tr"),
          clipAId,
          clipBId,
          type: String(args.type) as TransitionType,
          duration: num(args.durationSec) ?? 1,
          params: {},
        };
        const created = store.addClipTransition(transition);
        return created
          ? { ok: true, result: { transitionId: created.id } }
          : {
              ok: false,
              error:
                "Transição inválida: os clipes precisam ser adjacentes na mesma track.",
            };
      }

      case "list_templates": {
        const templates = store.getEditingTemplates().map((t) => ({
          id: t.id,
          name: t.name,
          category: t.category,
          description: t.description,
        }));
        return { ok: true, result: templates };
      }

      case "apply_template": {
        const applicationId = store.applyEditingTemplate(
          String(args.templateId),
          String(args.clipId),
          (args.overrides as Record<string, never>) ?? undefined,
        );
        return applicationId
          ? { ok: true, result: { applicationId } }
          : { ok: false, error: "template ou clipe não encontrado" };
      }

      case "add_text": {
        const startTime = num(args.startTimeSec) ?? 0;
        const duration = num(args.durationSec) ?? 3;
        let textTrack = store.project.timeline.tracks.find(
          (t) => t.type === "text" && !t.locked,
        );
        if (!textTrack) {
          const r = await store.addTrack("text");
          if (!r.success) {
            return { ok: false, error: "não foi possível criar track de texto" };
          }
          textTrack = useProjectStore
            .getState()
            .project.timeline.tracks.find((t) => t.type === "text");
        }
        if (!textTrack) return { ok: false, error: "track de texto indisponível" };
        const clip = store.createTextClip(
          textTrack.id,
          startTime,
          String(args.text),
          duration,
        );
        if (!clip) return { ok: false, error: "falha ao criar texto" };
        const preset = str(args.animationPreset);
        if (preset) {
          store.applyTextAnimationPreset(
            clip.id,
            preset as Parameters<Store["applyTextAnimationPreset"]>[1],
          );
        }
        return { ok: true, result: { textClipId: clip.id } };
      }

      case "add_captions": {
        const project = store.project;
        const transcripts = project.transcripts ?? [];
        const mediaId = str(args.mediaId);
        const selected = mediaId
          ? transcripts.filter((t) => t.mediaId === mediaId)
          : transcripts;
        if (selected.length === 0) {
          return {
            ok: false,
            error:
              "Nenhuma transcrição disponível. Aguarde a transcrição local ou verifique a mídia.",
          };
        }

        let created = 0;
        store.beginHistoryGroup("IA: gerar legendas");
        try {
          for (const transcript of selected) {
            const clips = project.timeline.tracks
              .flatMap((t) => t.clips)
              .filter((c) => c.mediaId === transcript.mediaId);
            for (const clip of clips) {
              const clipMediaStart = clip.inPoint;
              const clipMediaEnd = clip.outPoint;
              for (const seg of transcript.segments) {
                if (seg.end <= clipMediaStart || seg.start >= clipMediaEnd) {
                  continue;
                }
                const start =
                  clip.startTime + Math.max(0, seg.start - clipMediaStart);
                const end =
                  clip.startTime +
                  Math.min(clipMediaEnd - clipMediaStart, seg.end - clipMediaStart);
                const subtitle: Subtitle = {
                  id: shortId("sub"),
                  text: seg.text,
                  startTime: start,
                  endTime: Math.max(end, start + 0.3),
                };
                await store.addSubtitle(subtitle);
                created++;
              }
            }
          }
        } finally {
          store.endHistoryGroup();
        }
        return created > 0
          ? { ok: true, result: `${created} legendas criadas` }
          : {
              ok: false,
              error:
                "Nenhum clipe da mídia transcrita está na timeline; adicione a mídia à timeline primeiro.",
            };
      }

      case "apply_camera_move": {
        const { applyCameraMove } = await import("../camera");
        const raw = Array.isArray(args.keyframes) ? args.keyframes : [];
        const keyframes = raw
          .map((k) => {
            const kf = k as Record<string, unknown>;
            return {
              time: Number(kf.timeSec ?? kf.time ?? 0),
              x: Number(kf.x ?? 0),
              y: Number(kf.y ?? 0),
              zoom: Number(kf.zoom ?? 1),
            };
          })
          .filter((k) => Number.isFinite(k.time) && Number.isFinite(k.zoom));
        const clipIds = Array.isArray(args.clipIds)
          ? args.clipIds.map(String)
          : undefined;
        const result = await applyCameraMove(keyframes, { clipIds });
        return result.ok
          ? {
              ok: true,
              result: `Câmera aplicada a ${result.clipsAffected} clipe(s).`,
            }
          : { ok: false, error: result.error };
      }

      case "list_components": {
        const { listComponents } = await import("../component-library");
        return { ok: true, result: await listComponents() };
      }

      case "insert_component": {
        const { insertComponent } = await import("../component-library");
        const componentId = str(args.componentId);
        if (!componentId) return { ok: false, error: "componentId vazio" };
        const result = await insertComponent(
          componentId,
          num(args.atSec) ?? 0,
        );
        return result.ok
          ? {
              ok: true,
              result: `Componente "${result.name}" inserido (${result.clipsCreated} clipes).`,
            }
          : { ok: false, error: result.error };
      }

      case "save_component": {
        const { saveComponentFromSelection } = await import(
          "../component-library"
        );
        const result = await saveComponentFromSelection(
          str(args.name) ?? "Componente",
          args.transparentBackground !== false,
        );
        return result.ok
          ? { ok: true, result: result.component }
          : { ok: false, error: result.error };
      }

      case "list_vector_presets": {
        const { VECTOR_PRESETS } = await import("../vector-presets");
        return {
          ok: true,
          result: VECTOR_PRESETS.map((p) => ({
            id: p.id,
            name: p.name,
            category: p.category,
          })),
        };
      }

      case "add_vector": {
        const presetId = str(args.presetId);
        let svgContent = str(args.svg);
        if (presetId) {
          const { VECTOR_PRESETS } = await import("../vector-presets");
          const preset = VECTOR_PRESETS.find((p) => p.id === presetId);
          if (!preset) {
            return { ok: false, error: `Preset ${presetId} não existe (veja list_vector_presets)` };
          }
          svgContent = preset.svg;
        }
        if (!svgContent || !svgContent.includes("<svg")) {
          return {
            ok: false,
            error: "Informe presetId ou um markup <svg> válido em svg.",
          };
        }
        // Garante uma track de gráficos para receber o vetor.
        let graphicsTrack = store.project.timeline.tracks.find(
          (t) => t.type === "graphics" && !t.locked,
        );
        if (!graphicsTrack) {
          const r = await store.addTrack("graphics", 0);
          if (!r.success) {
            return { ok: false, error: "não foi possível criar track de gráficos" };
          }
          graphicsTrack = useProjectStore
            .getState()
            .project.timeline.tracks.find((t) => t.type === "graphics");
        }
        if (!graphicsTrack) {
          return { ok: false, error: "track de gráficos indisponível" };
        }
        const clip = store.importSVG(
          svgContent,
          graphicsTrack.id,
          num(args.startTimeSec) ?? 0,
          num(args.durationSec) ?? 5,
        );
        return clip
          ? { ok: true, result: { svgClipId: clip.id, trackId: graphicsTrack.id } }
          : { ok: false, error: "falha ao importar o SVG" };
      }

      case "import_attachment": {
        const attachmentId = str(args.attachmentId);
        if (!attachmentId) return { ok: false, error: "attachmentId vazio" };
        const { getAttachment, removeAttachment } = await import(
          "./attachments"
        );
        const file = getAttachment(attachmentId);
        if (!file) {
          return {
            ok: false,
            error: `Anexo ${attachmentId} não encontrado (pode já ter sido importado).`,
          };
        }
        const r = await store.importMedia(file);
        if (!r.success) {
          return { ok: false, error: r.error?.message ?? "import falhou" };
        }
        removeAttachment(attachmentId);
        // Localiza o item recém-importado (mais recente com o mesmo nome).
        const items = useProjectStore.getState().project.mediaLibrary.items;
        const imported = [...items]
          .reverse()
          .find((m) => m.name === file.name);
        if (!imported) {
          return { ok: true, result: "importado (id não localizado)" };
        }
        const atSec = num(args.addToTimelineAtSec);
        if (atSec !== undefined) {
          const addResult = await useProjectStore
            .getState()
            .addClipToNewTrack(imported.id, atSec);
          if (!addResult.success) {
            return {
              ok: true,
              result: {
                mediaId: imported.id,
                warning: "importado, mas falhou ao adicionar à timeline",
              },
            };
          }
        }
        return {
          ok: true,
          result: {
            mediaId: imported.id,
            name: imported.name,
            type: imported.type,
            addedToTimeline: atSec !== undefined,
          },
        };
      }

      case "web_search": {
        const query = str(args.query);
        if (!query) return { ok: false, error: "query vazia" };
        const data = await apiRequest<{
          query: string;
          results: Array<{ title: string; url: string; snippet: string }>;
        }>("/api/ai/search", {
          method: "POST",
          body: JSON.stringify({
            query,
            maxResults: num(args.maxResults) ?? 5,
          }),
        });
        return data.results.length > 0
          ? { ok: true, result: data }
          : { ok: false, error: `Nenhum resultado para "${query}"` };
      }

      case "adjust_audio": {
        const clipId = String(args.clipId);
        const location = findClip(store, clipId);
        if (!location) return { ok: false, error: "clipe não encontrado" };

        const changes: string[] = [];
        const volume = num(args.volume);
        const fadeIn = num(args.fadeInSec);
        const fadeOut = num(args.fadeOutSec);

        if (volume !== undefined || fadeIn !== undefined || fadeOut !== undefined) {
          const fade =
            fadeIn !== undefined || fadeOut !== undefined
              ? {
                  fadeIn: fadeIn ?? location.clip.fade?.fadeIn ?? 0,
                  fadeOut: fadeOut ?? location.clip.fade?.fadeOut ?? 0,
                }
              : undefined;
          patchClip(clipId, {
            ...(volume !== undefined
              ? { volume: Math.max(0, Math.min(2, volume)) }
              : {}),
            ...(fade ? { fade } : {}),
          });
          if (volume !== undefined) changes.push(`volume=${volume}`);
          if (fade) changes.push(`fade=${fade.fadeIn}s/${fade.fadeOut}s`);
        }

        if (typeof args.trackMuted === "boolean") {
          await store.muteTrack(location.track.id, args.trackMuted);
          changes.push(`track ${args.trackMuted ? "mutada" : "desmutada"}`);
        }

        return changes.length > 0
          ? { ok: true, result: changes.join(", ") }
          : { ok: false, error: "nenhum parâmetro de áudio informado" };
      }

      default:
        return { ok: false, error: `Tool desconhecida: ${name}` };
    }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function describeClips(clipId: string) {
  const state = useProjectStore.getState();
  const location = findClip(state, clipId);
  return location
    ? {
        clip: {
          id: location.clip.id,
          startSec: location.clip.startTime,
          endSec: location.clip.startTime + location.clip.duration,
          trackId: location.track.id,
        },
      }
    : latestTimelineSummary();
}

function latestTimelineSummary() {
  const context = buildProjectContext(useProjectStore.getState().project);
  return {
    durationSec: context.project.durationSec,
    tracks: context.tracks.map((t) => ({
      id: t.id,
      type: t.type,
      clipCount: t.clips.length,
    })),
  };
}
