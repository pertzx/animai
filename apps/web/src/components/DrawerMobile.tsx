import React from 'react';
import { useUIStore } from '../stores/ui-store';
import { X } from 'lucide-react';

/**
 * Drawer lateral usado na UI mobile‑first (CapCut style).
 *
 * O estado de visibilidade é controlado pelo painel "mobileDrawer" no
 * `ui-store.ts`. O layout mobile inclui um botão hamburger que chama
 * `togglePanel('mobileDrawer')` – este componente observa o estado e, quando
 * `visible` é true, exibe um painel deslizante a partir da esquerda.
 *
 * Conteúdo interno pode ser preenchido posteriormente (por enquanto um
 * placeholder simples). O drawer fecha ao clicar no ícone X ou ao clicar
 * fora da área do painel.
 */
const DrawerMobile: React.FC = () => {
  const { panels, togglePanel } = useUIStore();
  const visible = panels.mobileDrawer?.visible ?? false;

  const handleClose = () => togglePanel('mobileDrawer');

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-20 flex">
      {/* Overlay escuro */}
      <div
        className="flex-1 bg-black bg-opacity-40"
        onClick={handleClose}
        aria-label="Fechar menu"
      />

      {/* Drawer próprio */}
      <aside className="w-64 bg-gray-800 text-white p-4 flex flex-col">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold">Menu</h2>
          <button onClick={handleClose} aria-label="Fechar menu">
            <X className="text-white" size={20} />
          </button>
        </div>
        {/* Placeholder – later can render AssetsPanel, Inspector, etc. */}
        <p className="text-sm text-gray-300">Drawer de navegação móvel (CapCut).</p>
      </aside>
    </div>
  );
};

export default DrawerMobile;
