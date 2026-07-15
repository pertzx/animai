import React from 'react';
import { Preview } from '../components/editor/Preview';
import { Menu } from 'lucide-react';
import ToolbarBottom from '../components/ToolbarBottom';
import Timeline from '../components/editor/Timeline';
import DrawerMobile from '../components/DrawerMobile';
import { useUIStore } from '../stores/ui-store';

/**
 * Layout mobile‑first inspirado no CapCut.
 *
 * Estrutura (grid de 4 áreas):
 * - preview (cobre ~60% da altura)
 * - toolbar inferior fixa na base
 * - timeline logo acima da toolbar
 * - drawer que abre a partir do botão hamburger (DrawerMobile)
 */
const CapCutMobileLayout: React.FC = () => {
  return (
    <div className="flex flex-col h-screen bg-gray-900 text-white">
      {/* Hamburger para abrir drawer */}
      <div className="absolute top-2 left-2 z-10">
        <button onClick={() => useUIStore.getState().togglePanel('mobileDrawer')} aria-label="Abrir menu">
          <Menu className="text-white" size={28} />
        </button>
      </div>
      {/* Preview - ocupa a maior parte da tela */}
      <div className="flex-1 relative">
        <Preview />
      </div>

      {/* Timeline - barra horizontal scrollável */}
      <div className="h-24 border-t border-gray-700 bg-gray-800">
        <Timeline />
      </div>

      {/* Toolbar inferior fixa */}
      <ToolbarBottom />

      {/* Drawer lateral - aberto via hamburger (gerenciado internamente) */}
      <DrawerMobile />
    </div>
  );
};

export default CapCutMobileLayout;
