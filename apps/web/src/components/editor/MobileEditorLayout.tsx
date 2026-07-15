/**
 * Layout mobile CapCut — proporções equilibradas.
 *
 *  ┌─────────────────────────────┐
 *  │ ‹ Nome do projeto  Exportar │ ~40 px
 *  ├─────────────────────────────┤
 *  │                             │
 *  │      VIDEO PREVIEW          │ ~40 dvh (ajustável)
 *  │                             │
 *  ├─────────────────────────────┤
 *  │ Cortar│Dividir│Vel.│Áudio…  │ ~48 px
 *  ├─────────────────────────────┤
 *  │                             │
 *  │        TIMELINE             │ ~35 dvh (cliques visíveis)
 *  │  ◄━━━━━━━●━━━━━━━━►        │
 *  │                             │
 *  └─────────────────────────────┘
 */

import React, { useState } from "react";
import {
  Scissors,
  Layers,
  Gauge,
  Volume2,
  Type,
  Plus,
} from "lucide-react";
import { Preview } from "./Preview";
import { Timeline } from "./Timeline";
import { useProjectStore } from "../../stores/project-store";
import { useTimelineStore } from "../../stores/timeline-store";
import DrawerMobile from "../DrawerMobile";

/** Botão de ação na barra de ferramentas */
const ActionBtn: React.FC<{
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
}> = ({ icon, label, onClick }) => (
  <button
    onClick={onClick}
    className="flex flex-col items-center gap-0.5 px-2 py-1 text-fg-muted hover:text-fg active:text-accent transition-colors min-w-0"
    title={label}
  >
    <span className="text-lg">{icon}</span>
    <span className="text-[10px] leading-tight whitespace-nowrap">{label}</span>
  </button>
);

export const MobileEditorLayout: React.FC = () => {
  const { project } = useProjectStore();
  const { playbackState, togglePlayback } = useTimelineStore();
  const [showDrawer, setShowDrawer] = useState(false);
  const isPlaying = playbackState === "playing";

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-black text-white font-sans relative">
      {/* ─── Header ─── */}
      <header className="flex items-center gap-2 px-3 py-2 bg-black/90 z-10 shrink-0">
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

      {/* ─── Preview ─── */}
      <div className="shrink-0 bg-stage-bg relative" style={{ height: "40dvh" }}>
        <Preview />
      </div>

      {/* ─── Action bar ─── */}
      <div className="shrink-0 flex items-center justify-evenly border-t border-white/10 bg-black/80 py-1.5 overflow-x-auto">
        <ActionBtn icon={<Scissors size={18} />} label="Cortar" />
        <ActionBtn icon={<Layers size={18} />} label="Dividir" />
        <ActionBtn icon={<Gauge size={18} />} label="Veloc." />
        <ActionBtn icon={<Volume2 size={18} />} label="Áudio" />
        <ActionBtn icon={<Type size={18} />} label="Texto" />
        <ActionBtn icon={<Plus size={18} />} label="Adicionar" />
      </div>

      {/* ─── Timeline ─── */}
      <div className="flex-1 min-h-[120px] border-t border-white/10 bg-black/70 overflow-hidden">
        <Timeline />
      </div>

      {/* ─── Play/Pause ─── */}
      {!isPlaying && (
        <button
          onClick={togglePlayback}
          className="absolute left-1/2 top-[40dvh] -translate-x-1/2 -translate-y-1/2 w-14 h-14 rounded-full bg-accent/80 flex items-center justify-center shadow-xl z-20"
          aria-label="Play"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="white">
            <polygon points="8,5 19,12 8,19" />
          </svg>
        </button>
      )}

      {/* ─── Drawer ─── */}
      {showDrawer && <DrawerMobile onClose={() => setShowDrawer(false)} />}
    </div>
  );
};

export default MobileEditorLayout;