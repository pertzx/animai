/**
 * Layout mobile do editor (Fase 1 — responsividade).
 *
 * O grid desktop (Mídia | Palco | Ajustes + timeline) não cabe numa tela
 * estreita. No mobile mostramos UMA coisa por vez: o Preview fixo no topo e,
 * abaixo, o painel da aba selecionada (Mídia · Timeline · Ajustes · IA), com uma
 * bottom-nav estilo app. Os painéis são os MESMOS componentes do desktop
 * (conectados às stores), então nada é duplicado.
 *
 * Fase 2: splitter arrastável entre preview e conteúdo, toolbar mobile.
 */
import React, { useState, useRef, useCallback } from "react";
import { Clapperboard, LayoutList, SlidersHorizontal, Sparkles } from "lucide-react";
import { Toolbar } from "./Toolbar";
import { AssetsPanel } from "./AssetsPanel";
import { Preview } from "./Preview";
import { InspectorPanel } from "./InspectorPanel";
import { Timeline } from "./Timeline";
import { ChatPanel } from "../chat/ChatPanel";
import { PanelErrorBoundary } from "../ErrorBoundary";

type MobileTab = "media" | "timeline" | "inspector" | "chat";

const TABS: Array<{ id: MobileTab; label: string; Icon: typeof LayoutList }> = [
  { id: "media", label: "Mídia", Icon: Clapperboard },
  { id: "timeline", label: "Timeline", Icon: LayoutList },
  { id: "inspector", label: "Ajustes", Icon: SlidersHorizontal },
  { id: "chat", label: "IA", Icon: Sparkles },
];

const MIN_PREVIEW = 15; // dvh
const MAX_PREVIEW = 70; // dvh
const DEFAULT_PREVIEW = 38; // dvh

export const MobileEditorLayout: React.FC = () => {
  const [tab, setTab] = useState<MobileTab>("timeline");
  const [previewVh, setPreviewVh] = useState(DEFAULT_PREVIEW);
  const dragging = useRef(false);
  const dragStartY = useRef(0);
  const dragStartVh = useRef(DEFAULT_PREVIEW);

  const startDrag = useCallback((e: React.PointerEvent) => {
    // Only handle primary touch/pen (not mouse scroll)
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    dragging.current = true;
    dragStartY.current = e.clientY;
    dragStartVh.current = previewVh;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [previewVh]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return;
    // movementY > 0 = drag down = smaller preview
    const deltaY = e.clientY - dragStartY.current;
    const deltaVh = (deltaY / window.innerHeight) * 100;
    const newVh = Math.min(MAX_PREVIEW, Math.max(MIN_PREVIEW, dragStartVh.current - deltaVh));
    setPreviewVh(newVh);
  }, []);

  const endDrag = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return;
    dragging.current = false;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
  }, []);

  return (
    <div
      className="flex h-full w-full flex-col overflow-hidden bg-bg text-fg font-sans"
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      {/* Toolbar no topo (versão mobile abaixo de 768px via CSS do Toolbar.tsx) */}
      <Toolbar />

      {/* Palco com splitter arrastável */}
      <div
        className="shrink-0 bg-stage-bg relative"
        style={{ height: `${previewVh}dvh` }}
      >
        <PanelErrorBoundary name="Stage">
          <Preview />
        </PanelErrorBoundary>

        {/* Splitter: barra horizontal que o usuário arrasta para redimensionar
            o preview vs o conteúdo abaixo. Touch-action:none para não competir
            com o scroll. Visual: linha fina com alça central. */}
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize preview area"
          title="Drag to resize preview"
          onPointerDown={startDrag}
          className="absolute bottom-0 left-0 right-0 z-10 cursor-row-resize select-none"
          style={{ touchAction: "none" }}
        >
          {/* Hit area expandida (44px) com linha visual fina (4px) */}
          <div className="absolute inset-x-0 bottom-0 h-6 flex items-center justify-center">
            {/* Linha visual */}
            <div className="w-full h-1 bg-border rounded-full" />
            {/* Alça central */}
            <div className="absolute left-1/2 -translate-x-1/2 w-8 h-3 bg-bg-2 border border-border rounded-md flex items-center justify-center">
              <div className="w-4 h-0.5 bg-fg-muted rounded-full" />
            </div>
          </div>
        </div>
      </div>

      {/* Conteúdo da aba (tela cheia abaixo do palco). O flex-1 garante que
          ocupa todo o espaço restante. */}
      <div className="min-h-0 flex-1 overflow-hidden border-t border-border bg-bg-1">
        {tab === "media" && (
          <PanelErrorBoundary name="Media">
            <AssetsPanel />
          </PanelErrorBoundary>
        )}
        {tab === "timeline" && (
          <PanelErrorBoundary name="Timeline">
            <Timeline />
          </PanelErrorBoundary>
        )}
        {tab === "inspector" && (
          <PanelErrorBoundary name="Inspector">
            <InspectorPanel />
          </PanelErrorBoundary>
        )}
        {tab === "chat" && (
          <PanelErrorBoundary name="AI Assistant">
            <ChatPanel />
          </PanelErrorBoundary>
        )}
      </div>

      {/* Bottom-nav estilo app; respeita a safe-area (notch inferior). */}
      <nav
        className="shrink-0 flex border-t border-border bg-bg-2"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {TABS.map(({ id, label, Icon }) => {
          const active = tab === id;
          return (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex min-h-[52px] flex-1 flex-col items-center justify-center gap-0.5 text-[10px] transition-colors ${
                active ? "text-accent" : "text-fg-muted hover:text-fg-2"
              }`}
              aria-pressed={active}
            >
              <Icon size={20} strokeWidth={active ? 2.4 : 1.8} />
              {label}
            </button>
          );
        })}
      </nav>
    </div>
  );
};

export default MobileEditorLayout;