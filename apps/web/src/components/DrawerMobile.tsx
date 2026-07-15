import React from 'react';
import { X, Clapperboard, SlidersHorizontal, Sparkles } from 'lucide-react';
import { AssetsPanel } from './editor/AssetsPanel';
import { InspectorPanel } from './editor/InspectorPanel';
import { ChatPanel } from './chat/ChatPanel';

type DrawerTab = "media" | "inspector" | "chat";

interface DrawerMobileProps {
  onClose?: () => void;
}

/**
 * Drawer lateral estilo CapCut.
 * Aberto via botão ‹ no header. Contém acesso rápido a Assets, Inspector e Chat.
 */
const DrawerMobile: React.FC<DrawerMobileProps> = ({ onClose }) => {
  const [tab, setTab] = React.useState<DrawerTab>("media");

  const handleClose = () => onClose?.();

  return (
    <div className="fixed inset-0 z-30 flex">
      {/* Overlay escuro */}
      <div
        className="flex-1 bg-black/60"
        onClick={handleClose}
        aria-label="Fechar menu"
      />

      {/* Drawer próprio — ocupa 75% da largura */}
      <aside className="w-[75vw] max-w-sm bg-gray-900 text-white flex flex-col">
        {/* Cabeçalho do drawer */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <button onClick={handleClose} aria-label="Fechar" className="text-white/70 hover:text-white">
            <X size={22} />
          </button>
          <span className="text-sm font-medium">Menu</span>
          <div className="w-6" />
        </div>

        {/* Navegação interna: Mídia | Ajustes | IA */}
        <nav className="flex border-b border-white/10">
          <button
            onClick={() => setTab("media")}
            className={`flex-1 py-2 text-xs flex flex-col items-center gap-0.5 ${
              tab === "media" ? "text-accent border-b-2 border-accent" : "text-white/60"
            }`}
          >
            <Clapperboard size={18} />
            Mídia
          </button>
          <button
            onClick={() => setTab("inspector")}
            className={`flex-1 py-2 text-xs flex flex-col items-center gap-0.5 ${
              tab === "inspector" ? "text-accent border-b-2 border-accent" : "text-white/60"
            }`}
          >
            <SlidersHorizontal size={18} />
            Ajustes
          </button>
          <button
            onClick={() => setTab("chat")}
            className={`flex-1 py-2 text-xs flex flex-col items-center gap-0.5 ${
              tab === "chat" ? "text-accent border-b-2 border-accent" : "text-white/60"
            }`}
          >
            <Sparkles size={18} />
            IA
          </button>
        </nav>

        {/* Conteúdo */}
        <div className="flex-1 overflow-y-auto p-3">
          {tab === "media" && <AssetsPanel />}
          {tab === "inspector" && <InspectorPanel />}
          {tab === "chat" && <ChatPanel />}
        </div>
      </aside>
    </div>
  );
};

export default DrawerMobile;