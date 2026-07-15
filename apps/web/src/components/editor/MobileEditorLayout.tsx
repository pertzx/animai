/**
 * Layout mobile do editor — estilo CapCut.
 *
 * Estrutura:
 *  - Preview grande no topo (~55 dvh)
 *  - ToolbarBottom com ações de edição (cortar, dividir, etc.)
 *  - Aba content (Mídia · Timeline · Ajustes · IA)
 *  - Bottom-nav (tabs) no final
 *  - DrawerMobile acessível pelo botão hamburger no canto superior esquerdo
 */
import React, { useState } from "react";
import { Clapperboard, LayoutList, SlidersHorizontal, Sparkles, Menu } from "lucide-react";
import { AssetsPanel } from "./AssetsPanel";
import { Preview } from "./Preview";
import { InspectorPanel } from "./InspectorPanel";
import { Timeline } from "./Timeline";
import { ChatPanel } from "../chat/ChatPanel";
import { PanelErrorBoundary } from "../ErrorBoundary";
import { useUIStore } from "../../stores/ui-store";
import ToolbarBottom from "../ToolbarBottom";
import DrawerMobile from "../DrawerMobile";

type MobileTab = "media" | "timeline" | "inspector" | "chat";

const TABS: Array<{ id: MobileTab; label: string; Icon: typeof LayoutList }> = [
  { id: "media", label: "Mídia", Icon: Clapperboard },
  { id: "timeline", label: "Timeline", Icon: LayoutList },
  { id: "inspector", label: "Ajustes", Icon: SlidersHorizontal },
  { id: "chat", label: "IA", Icon: Sparkles },
];

export const MobileEditorLayout: React.FC = () => {
  const [tab, setTab] = useState<MobileTab>("timeline");
  const togglePanel = useUIStore((s) => s.togglePanel);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-bg text-fg font-sans">
      {/* Hamburger para abrir o drawer lateral (CapCut‑style) */}
      <div className="absolute top-2 left-2 z-10">
        <button
          onClick={() => togglePanel("mobileDrawer")}
          aria-label="Abrir menu"
          className="rounded-full bg-black/40 p-2 backdrop-blur-sm"
        >
          <Menu className="text-white" size={22} />
        </button>
      </div>

      {/* Palco — ocupa a maior parte da tela (CapCut‑style) */}
      <div className="shrink-0 bg-stage-bg" style={{ height: "55dvh" }}>
        <PanelErrorBoundary name="Stage">
          <Preview />
        </PanelErrorBoundary>
      </div>

      {/* Barra de ferramentas com ações de edição (ícones grandes) */}
      <ToolbarBottom />

      {/* Conteúdo da aba ativa */}
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

      {/* Bottom‑nav estilo app (tabs de painéis) */}
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

      {/* Drawer lateral (abre via hamburger) */}
      <DrawerMobile />
    </div>
  );
};

export default MobileEditorLayout;