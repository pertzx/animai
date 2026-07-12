/**
 * Visualizador do JSON da análise semântica de uma mídia (feedback do usuário:
 * "se eu der hover tem a opção de ver o json"). Se a análise ainda não existe
 * ou está em andamento, dispara/espera pelo gerenciador central.
 */

import React, { useEffect, useState } from "react";
import { Braces, Copy, Loader2, X } from "lucide-react";
import { semanticAnalysisManager } from "../../services/semantic/analysis-manager";
import { timelineToJson } from "../../services/semantic/timeline-builder";
import type { SemanticTimeline } from "../../services/semantic/types";

export const SemanticJsonDialog: React.FC<{
  mediaId: string;
  onClose: () => void;
}> = ({ mediaId, onClose }) => {
  const [timeline, setTimeline] = useState<SemanticTimeline | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    // Cache → na hora; em andamento → espera; senão dispara.
    semanticAnalysisManager
      .ensure(mediaId)
      .then((t) => {
        if (cancelled) return;
        if (t) setTimeline(t);
        else setError("Não foi possível analisar esta mídia.");
      })
      .catch(() => !cancelled && setError("Falha na análise."))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [mediaId]);

  const json = timeline
    ? JSON.stringify(timelineToJson(timeline), null, 2)
    : "";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="flex max-h-[80vh] w-[42rem] max-w-full flex-col rounded-xl border border-border bg-bg-1">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Braces size={16} className="text-accent" />
          <h3 className="text-sm font-medium text-fg">Análise semântica (JSON)</h3>
          <div className="ml-auto flex items-center gap-2">
            {timeline && (
              <button
                className="flex items-center gap-1 rounded border border-border px-2 py-1 text-xs text-fg-2 hover:border-accent hover:text-accent"
                onClick={() => {
                  void navigator.clipboard.writeText(json);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
              >
                <Copy size={12} /> {copied ? "Copiado!" : "Copiar"}
              </button>
            )}
            <button
              className="text-fg-muted hover:text-fg"
              onClick={onClose}
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-3">
          {loading ? (
            <div className="flex items-center gap-2 p-6 text-sm text-fg-muted">
              <Loader2 size={14} className="animate-spin" />
              Analisando a mídia localmente… (aguarde)
            </div>
          ) : error ? (
            <p className="p-4 text-sm text-status-error">{error}</p>
          ) : (
            <>
              {timeline && (
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {Object.entries(timeline.counts).map(([type, n]) => (
                    <span
                      key={type}
                      className="rounded-full bg-bg-3 px-2 py-0.5 text-[10px] text-fg-2"
                    >
                      {type}: {n}
                    </span>
                  ))}
                </div>
              )}
              <pre className="whitespace-pre-wrap break-all rounded bg-bg-2 p-3 font-mono text-[11px] text-fg-2">
                {json}
              </pre>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
