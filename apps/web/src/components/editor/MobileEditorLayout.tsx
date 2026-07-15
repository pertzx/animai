/**
 * Layout mobile verdadeiramente inspirado no CapCut.
 *
 * Estrutura (top → bottom):
 *  ┌─────────────────────────┐
 *  │ ‹ Nome do projeto       │ ← header mínimo
 *  ├─────────────────────────┤
 *  │                         │
 *  │     VIDEO PREVIEW       │ ← maior parte da tela
 *  │    (canvas + overlay)   │
 *  │                         │
 *  ├─────────────────────────┤
 *  │ Cortar │ Dividir │ Vel. │ ← action bar (ferramentas)
 *  ├─────────────────────────┤
 *  │   ◄━━━━━━━●━━━━━━━━►   │ ← timeline horizontal fina
 *  └─────────────────────────┘
 *
 * Panels (Assets, Inspector, Chat) abrem como bottom sheets
 * ou drawer lateral (DrawerMobile).
 */

import React, { useState } from "react";
import {
  Scissors,
  Layers,
  Gauge,
  Volume2,
  Type,
  Plus,
  Play,
} from "lucide-react";
import { Preview } from "./Preview";
import { Timeline } from "./Timeline";
import DrawerMobile from "../DrawerMobile";
import { useProjectStore } from "../../stores/project-store";
import { useTimelineStore } from "../../stores/timeline-store";

/** Botão redondo grande para ação na toolbar */
const ToolBtn: React.FC<{
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
}> = ({ icon, label, onClick }) => (
  <button
    onClick={onClick}
    className="flex flex-col items-center gap-0.5 px-3 py-1 text-fg-muted hover:text-fg active:text-accent transition-colors"
    title={label}
  >
    <span className="text-xl">{icon}</span>
    <span className="text-[9px] leading-tight">{label}</span>
  </button>
);

export const MobileEditorLayout: React.FC = () => {
  const { project } = useProjectStore();
  const { playbackState, togglePlayback } = useTimelineStore();
  const [showDrawer, setShowDrawer] = useState(false);
  const isPlaying = playbackState === "playing";

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-black text-white font-sans">
      {/* ─── Header mínimo (CapCut style) ─── */}
      <header className="flex items-center gap-2 px-3 py-2 bg-black/80 z-10">
        <button
          onClick={() => setShowDrawer(true)}
          aria-label="Menu"
          className="text-white/80 hover:text-white"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <span className="text-sm font-medium truncate flex-1">
          {project.name || "Sem título"}
        </span>
        <button className="text-xs text-accent font-semibold">Exportar</button>
      </header>

      {/* ─── Preview (ocupa o máximo de espaço) ─── */}
      <div className="flex-1 relative bg-stage-bg">
        <Preview />
      </div>

      {/* ─── Action bar (ferramentas de edição) ─── */}
      <div className="flex items-center justify-around border-t border-white/10 bg-black/70 py-2">
        <ToolBtn icon={<Scissors size={20} />} label="Cortar" />
        <ToolBtn icon={<Layers size={20} />} label="Dividir" />
        <ToolBtn icon={<Gauge size={20} />} label="Veloc." />
        <ToolBtn icon={<Volume2 size={20} />} label="Áudio" />
        <ToolBtn icon={<Type size={20} />} label="Texto" />
        <ToolBtn icon={<Plus size={20} />} label="Adicionar" />
      </div>

      {/* ─── Timeline (faixa horizontal fina) ─── */}
      <div className="h-14 border-t border-white/10 bg-black/60 relative">
        <Timeline />
      </div>

      {/* ─── Play / Pause flutuante ─── */}
      {!isPlaying && (
        <button
          onClick={togglePlayback}
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-16 h-16 rounded-full bg-accent/90 flex items-center justify-center shadow-xl z-20"
          aria-label="Play"
        >
          <Play size={28} className="text-white ml-1" />
        </button>
      )}

      {/* ─── Drawer lateral (abre via ←) ─── */}
      {showDrawer && <DrawerMobile onClose={() => setShowDrawer(false)} />}
    </div>
  );
};

export default MobileEditorLayout;