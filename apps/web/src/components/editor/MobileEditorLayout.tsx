/**
 * Layout mobile do editor (Fase 1 — responsividade).
 *
 * O grid desktop (Mídia | Palco | Ajustes + timeline) não cabe numa tela
 * estreita. No mobile mostramos UMA coisa por vez: o Preview fixo no topo e,
 * abaixo, o painel da aba selecionada (Mídia · Timeline · Ajustes · IA), com uma
 * bottom-nav estilo app. Os painéis são os MESMOS componentes do desktop
 * (conectados às stores), então nada é duplicado.
 */
import React, { useState } from "react";
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

export const MobileEditorLayout: React.FC = () => {
  const [tab, setTab] = useState<MobileTab>("timeline");

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-bg text-fg font-sans">
      <Toolbar />

      {/* Palco sempre visível no topo. */}
      <div className="shrink-0 bg-stage-bg" style={{ height: "38vh" }}>
        <PanelErrorBoundary name="Stage">
          <Preview />
        </PanelErrorBoundary>
      </div>

      {/* Conteúdo da aba (tela cheia abaixo do palco). */}
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
