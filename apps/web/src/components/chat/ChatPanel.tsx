/**
 * AI chat panel (prd.txt §4) — Claude Code style: each assistant turn renders
 * linearly as thinking (collapsible) → text → tool cards with live status →
 * final text. Supports interruption and confirmation of bulk-destructive
 * actions.
 */

import React, { useEffect, useRef, useState } from "react";
import {
  Bot,
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  CircleStop,
  Coins,
  Globe,
  Loader2,
  Send,
  SkipForward,
  Sparkles,
  Trash2,
  TriangleAlert,
  Wrench,
  X,
} from "lucide-react";
import type { ChatBlock, ChatTurn } from "../../services/ai/agent";
import { ChatMarkdown } from "./ChatMarkdown";
import { useChatStore } from "../../stores/chat-store";
import { useProjectStore } from "../../stores/project-store";
import { apiRequest, useAuthStore } from "../../stores/auth-store";
import { Shield, LogOut, RefreshCw } from "lucide-react";
import {
  isAutoTranscribeEnabled,
  setAutoTranscribeEnabled,
  transcriptionManager,
} from "../../services/ai/transcription-manager";
import { insightsManager } from "../../services/ai/insights-manager";
import {
  describeAttachments,
  registerAttachment,
  removeAttachment,
  type AttachmentInfo,
} from "../../services/ai/attachments";
import { Paperclip } from "lucide-react";

const TOOL_LABELS: Record<string, string> = {
  get_project_state: "Lendo estado do projeto",
  get_transcript: "Lendo transcrição",
  split_clip: "Dividindo clipe",
  trim_clip: "Ajustando clipe",
  move_clip: "Movendo clipe",
  delete_clip: "Removendo clipe",
  delete_clips: "Removendo clipes",
  add_clip: "Adicionando mídia à timeline",
  apply_effect: "Aplicando efeito",
  remove_effect: "Removendo efeito",
  apply_transition: "Criando transição",
  list_templates: "Listando templates",
  apply_template: "Aplicando template",
  add_text: "Adicionando texto",
  add_captions: "Gerando legendas",
  adjust_audio: "Ajustando áudio",
  import_attachment: "Importando anexo",
  add_vector: "Adicionando vetor",
  list_vector_presets: "Listando vetores",
  list_components: "Listando componentes",
  insert_component: "Inserindo componente",
  save_component: "Salvando componente",
  apply_camera_move: "Aplicando movimento de câmera",
  set_element_depth: "Definindo profundidade 3D",
  web_search: "Pesquisando na web",
  list_catalog: "Consultando catálogo",
  get_media_insights: "Lendo análise da mídia",
  run_semantic_analysis: "Analisando o vídeo (semântico)",
  get_semantic_timeline: "Lendo timeline semântica",
  find_moments: "Procurando momentos",
  cut_silences: "Cortando silêncios",
};

const formatTokens = (n: number): string =>
  n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);

function parseJson<T>(text: string | undefined): T | null {
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

const ThinkingBlock: React.FC<{ text: string; streaming: boolean }> = ({
  text,
  streaming,
}) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded border border-border bg-bg-2 text-xs">
      <button
        className="flex w-full items-center gap-1.5 px-2 py-1.5 text-fg-muted hover:text-fg-2"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <Brain size={12} />
        <span>{streaming ? "Pensando…" : "Pensou"}</span>
      </button>
      {open && (
        <p className="whitespace-pre-wrap px-3 pb-2 text-fg-muted">{text}</p>
      )}
    </div>
  );
};

interface SearchResultItem {
  title: string;
  url: string;
  snippet: string;
}

/** Card especializado da tool web_search: preview da requisição + resultados. */
const WebSearchPreview: React.FC<{
  block: Extract<ChatBlock, { kind: "tool" }>;
  open: boolean;
}> = ({ block, open }) => {
  const query =
    parseJson<{ query?: string }>(block.args)?.query ?? "(sem query)";
  const results =
    block.status === "success"
      ? (parseJson<{ ok: boolean; result?: { results?: SearchResultItem[] } }>(
          block.result,
        )?.result?.results ?? [])
      : [];

  return (
    <div className="border-t border-border px-2 py-1.5 text-xs">
      <p className="flex items-center gap-1.5 text-fg-2">
        <Globe size={11} className="shrink-0 text-accent" />
        <span className="truncate" title={query}>
          “{query}”
        </span>
        {results.length > 0 && (
          <span className="ml-auto shrink-0 text-fg-muted">
            {results.length} resultados
          </span>
        )}
      </p>
      {open && results.length > 0 && (
        <ul className="mt-1.5 space-y-1.5">
          {results.map((r, i) => (
            <li key={i}>
              <a
                href={r.url}
                target="_blank"
                rel="noreferrer"
                className="block truncate text-accent hover:underline"
                title={r.url}
              >
                {r.title || r.url}
              </a>
              <p className="line-clamp-2 text-fg-muted">{r.snippet}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

const ToolBlock: React.FC<{ block: Extract<ChatBlock, { kind: "tool" }> }> = ({
  block,
}) => {
  const isSearch = block.name === "web_search";
  // Cards de pesquisa nascem expandidos para mostrar os resultados.
  const [open, setOpen] = useState(isSearch);
  const { resolveConfirmation } = useChatStore();
  const label = TOOL_LABELS[block.name] ?? block.name;

  const statusIcon =
    block.status === "running" ? (
      <Loader2 size={12} className="animate-spin text-accent" />
    ) : block.status === "success" ? (
      <Check size={12} className="text-status-success" />
    ) : block.status === "error" ? (
      <X size={12} className="text-status-error" />
    ) : block.status === "skipped" ? (
      <SkipForward size={12} className="text-fg-muted" />
    ) : (
      <TriangleAlert size={12} className="text-status-warning" />
    );

  return (
    <div className="rounded border border-border bg-bg-2 text-xs">
      <button
        className="flex w-full items-center gap-1.5 px-2 py-1.5"
        onClick={() => setOpen((v) => !v)}
      >
        <Wrench size={12} className="text-fg-muted" />
        <span className="text-fg-2">{label}</span>
        <code className="max-w-[10rem] truncate text-fg-muted">{block.name}</code>
        <span className="ml-auto">{statusIcon}</span>
      </button>
      {block.status === "pending-confirmation" && (
        <div className="border-t border-border px-2 py-2">
          <p className="mb-2 text-fg-2">
            Ação destrutiva em massa. Executar mesmo assim?
          </p>
          <div className="flex gap-2">
            <button
              className="rounded bg-status-error/20 px-2 py-1 text-status-error hover:bg-status-error/30"
              onClick={() => resolveConfirmation(true)}
            >
              Executar
            </button>
            <button
              className="rounded bg-bg-3 px-2 py-1 text-fg-2 hover:bg-hover"
              onClick={() => resolveConfirmation(false)}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
      {isSearch && block.status !== "pending-confirmation" && (
        <WebSearchPreview block={block} open={open} />
      )}
      {open && !isSearch && (
        <div className="space-y-1 border-t border-border px-2 py-1.5 text-fg-muted">
          <p className="break-all">
            <span className="text-fg-2">args:</span> {block.args || "{}"}
          </p>
          {block.result && (
            <p className="break-all">
              <span className="text-fg-2">resultado:</span>{" "}
              {block.result.slice(0, 400)}
            </p>
          )}
        </div>
      )}
    </div>
  );
};

const TurnView: React.FC<{ turn: ChatTurn; streaming: boolean }> = ({
  turn,
  streaming,
}) => {
  if (turn.role === "user") {
    const text = turn.blocks[0]?.kind === "text" ? turn.blocks[0].text : "";
    return (
      <div className="ml-8 rounded-lg bg-accent-soft px-3 py-2 text-sm text-fg">
        {text}
      </div>
    );
  }
  return (
    <div className="mr-2 space-y-1.5">
      {turn.blocks.map((block, i) => {
        const isLast = i === turn.blocks.length - 1;
        if (block.kind === "thinking") {
          return (
            <ThinkingBlock
              key={i}
              text={block.text}
              streaming={streaming && isLast}
            />
          );
        }
        if (block.kind === "tool") {
          return <ToolBlock key={block.toolCallId} block={block} />;
        }
        // Texto do assistente é hipertexto: renderiza Markdown/GFM completo.
        return <ChatMarkdown key={i} text={block.text} />;
      })}
      {streaming && turn.blocks.length === 0 && (
        <div className="flex items-center gap-2 text-xs text-fg-muted">
          <Loader2 size={12} className="animate-spin" /> Pensando…
        </div>
      )}
      {!streaming && turn.tokens !== undefined && turn.tokens > 0 && (
        <p className="flex items-center gap-1 text-[10px] text-fg-muted">
          <Coins size={10} /> {formatTokens(turn.tokens)} tokens nesta
          requisição
        </p>
      )}
    </div>
  );
};

export const ChatPanel: React.FC = () => {
  const {
    turns,
    running,
    compacting,
    totalTokens,
    lastRequestTokens,
    initForProject,
    sendMessage,
    interrupt,
    clearHistory,
  } = useChatStore();
  const projectId = useProjectStore((s) => s.project.id);
  const user = useAuthStore((s) => s.user);
  const [input, setInput] = useState("");
  const [autoStt, setAutoStt] = useState(isAutoTranscribeEnabled());
  const [sttStatus, setSttStatus] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<AttachmentInfo[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void initForProject(projectId);
  }, [projectId, initForProject]);

  useEffect(() => {
    return transcriptionManager.onStateChange(({ activeMediaId, status }) => {
      setSttStatus(activeMediaId ? status : null);
    });
  }, []);

  const [insightStatus, setInsightStatus] = useState<string | null>(null);
  useEffect(() => {
    return insightsManager.onStateChange(({ activeMediaId, status }) => {
      setInsightStatus(activeMediaId ? status : null);
    });
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns]);

  const submit = () => {
    const text = input.trim();
    if ((!text && attachments.length === 0) || running) return;
    const fullText =
      (text || "Veja os arquivos anexados.") + describeAttachments(attachments);
    setInput("");
    setAttachments([]);
    void sendMessage(fullText);
  };

  const onFilesSelected = (files: FileList | null) => {
    if (!files) return;
    const added = Array.from(files).map((f) => registerAttachment(f));
    setAttachments((prev) => [...prev, ...added]);
  };

  return (
    <div className="flex h-full w-full flex-col bg-bg-1">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Sparkles size={14} className="text-accent" />
        <span className="text-sm font-medium text-fg">Assistente</span>
        {compacting && (
          <span className="text-[10px] text-fg-muted">compactando memória…</span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <label
            className="flex cursor-pointer items-center gap-1 text-[10px] text-fg-muted"
            title="Transcrever automaticamente o áudio das mídias importadas (local, via Whisper)"
          >
            <input
              type="checkbox"
              checked={autoStt}
              onChange={(e) => {
                setAutoStt(e.target.checked);
                setAutoTranscribeEnabled(e.target.checked);
              }}
            />
            STT auto
          </label>
          <button
            className="text-fg-muted hover:text-accent"
            title="Reanalisar mídias (transcrição, áudio e texto na tela)"
            onClick={() => {
              const n = insightsManager.reanalyzeAll();
              useProjectStore
                .getState()
                .project.mediaLibrary.items.filter((m) => m.type !== "image")
                .forEach((m) => transcriptionManager.enqueue(m.id));
              if (n === 0) {
                setInsightStatus(null);
              }
            }}
          >
            <RefreshCw size={13} />
          </button>
          {user?.role === "admin" && (
            <button
              className="text-fg-muted hover:text-accent"
              title="Painel admin"
              onClick={() => (window.location.hash = "#/admin")}
            >
              <Shield size={13} />
            </button>
          )}
          <button
            className="text-fg-muted hover:text-status-error"
            title="Limpar conversa"
            onClick={() => void clearHistory()}
          >
            <Trash2 size={13} />
          </button>
          {user && (
            <button
              className="text-fg-muted hover:text-status-error"
              title={`Sair (${user.email})`}
              onClick={() => useAuthStore.getState().logout()}
            >
              <LogOut size={13} />
            </button>
          )}
        </div>
      </div>

      {sttStatus && (
        <div className="flex items-center gap-2 border-b border-border bg-bg-2 px-3 py-1 text-[11px] text-fg-muted">
          <Loader2 size={11} className="animate-spin" />
          Transcrevendo áudio localmente ({sttStatus})…
        </div>
      )}
      {insightStatus && (
        <div className="flex items-center gap-2 border-b border-border bg-bg-2 px-3 py-1 text-[11px] text-fg-muted">
          <Loader2 size={11} className="animate-spin" />
          Analisando mídia localmente ({insightStatus})…
        </div>
      )}

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {turns.length === 0 && (
          <div className="mt-8 space-y-2 text-center text-xs text-fg-muted">
            <Bot size={24} className="mx-auto text-fg-muted" />
            <p>
              Peça edições em linguagem natural:
              <br />
              “corte os silêncios”, “adicione legendas”,
              <br />
              “aplique um efeito vintage no primeiro clipe”…
            </p>
          </div>
        )}
        {turns.map((turn, i) => (
          <TurnView
            key={turn.id}
            turn={turn}
            streaming={running && i === turns.length - 1}
          />
        ))}
      </div>

      <div className="border-t border-border p-2">
        {attachments.length > 0 && (
          <div className="mb-1.5 flex flex-wrap gap-1.5">
            {attachments.map((a) => (
              <span
                key={a.id}
                className="flex items-center gap-1 rounded-full border border-border bg-bg-2 px-2 py-0.5 text-[10px] text-fg-2"
                title={`${a.mimeType} • ${(a.sizeBytes / 1048576).toFixed(1)}MB`}
              >
                <Paperclip size={9} />
                <span className="max-w-[9rem] truncate">{a.name}</span>
                <button
                  className="text-fg-muted hover:text-status-error"
                  onClick={() => {
                    removeAttachment(a.id);
                    setAttachments((prev) =>
                      prev.filter((x) => x.id !== a.id),
                    );
                  }}
                >
                  <X size={10} />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="flex items-end gap-1.5">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="video/*,audio/*,image/*"
            className="hidden"
            onChange={(e) => {
              onFilesSelected(e.target.files);
              e.target.value = "";
            }}
          />
          <button
            className="rounded p-2 text-fg-muted hover:text-accent disabled:opacity-40"
            title="Anexar arquivo (a IA decide o que fazer com ele)"
            disabled={!user || running}
            onClick={() => fileInputRef.current?.click()}
          >
            <Paperclip size={16} />
          </button>
          <textarea
            className="max-h-32 min-h-[2.25rem] flex-1 resize-none rounded border border-border bg-bg-2 px-2 py-1.5 text-sm text-fg outline-none placeholder:text-fg-muted focus:border-accent"
            placeholder={
              user ? "Peça uma edição…" : "Faça login para usar a IA"
            }
            value={input}
            disabled={!user}
            rows={1}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
          />
          {running ? (
            <button
              className="rounded bg-status-error/20 p-2 text-status-error hover:bg-status-error/30"
              title="Interromper"
              onClick={interrupt}
            >
              <CircleStop size={16} />
            </button>
          ) : (
            <button
              className="rounded bg-accent p-2 text-accent-fg disabled:opacity-40"
              title="Enviar"
              disabled={(!input.trim() && attachments.length === 0) || !user}
              onClick={submit}
            >
              <Send size={16} />
            </button>
          )}
        </div>
        {totalTokens > 0 && (
          <p className="mt-1 flex items-center gap-1 text-[10px] text-fg-muted">
            <Coins size={10} />
            <span>
              Tokens — projeto: {formatTokens(totalTokens)}
              {lastRequestTokens > 0 &&
                ` · última requisição: ${formatTokens(lastRequestTokens)}`}
            </span>
          </p>
        )}
        {user && (
          <p className="mt-1 flex items-center gap-2 text-[10px] text-fg-muted">
            <span>
              {user.planName} ·{" "}
              {user.balanceKind === "courtesy"
                ? `${user.aiBalancePercent}% do crédito grátis restante`
                : `${user.aiBalancePercent}% de IA restante este mês`}
            </span>
            {user.plan === "free" && (
              <button
                className="text-accent hover:underline"
                onClick={() =>
                  void apiRequest<{ url: string }>("/api/billing/checkout", {
                    method: "POST",
                    body: JSON.stringify({}),
                  })
                    .then((d) => {
                      window.location.href = d.url;
                    })
                    .catch(() => undefined)
                }
              >
                Fazer upgrade
              </button>
            )}
          </p>
        )}
      </div>
    </div>
  );
};
