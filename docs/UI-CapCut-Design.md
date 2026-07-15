---
name: UI CapCut Design Spec
description: Especificação da nova UI inspirada no CapCut para o editor de vídeo AnimAI, cobrindo desktop e mobile.
type: project
---

# Especificação da UI CapCut para AnimAI

Esta documentação descreve o layout e comportamento da interface de usuário (UI) do editor de vídeo, inspirada no **CapCut**. Serve como referência única para desenvolvimento futuro, garantindo consistência entre as plataformas **desktop** e **mobile**.

## Visão Geral
- **Objetivo**: oferecer uma experiência familiar aos usuários do CapCut, mantendo a identidade visual do AnimAI.
- **Componentes principais**:
  1. **Timeline** – linha do tempo com faixas (tracks) de vídeo, áudio e efeitos.
  2. **Preview** – visualização em tempo real do vídeo.
  3. **Toolbars** – barra superior e inferior com ferramentas contextuais.
  4. **Painéis laterais** – mídia, efeitos, texto, áudio, configurações.
  5. **Overlay de controles** – play/pause, velocidade, exportação.

## Layout Desktop
```
+--------------------------------------------------------------+
|                         BARRA SUPERIOR                       |
|  [Arquivo] [Editar] [Visualizar] [Ajuda]   (logo AnimAI)     |
+--------------------------------------------------------------+
|                     PREVIEW (canvas 16:9)                  |
|   +---------------------------+   +----------------------+ |
|   |      Video Preview        |   |   Controle de voz    | |
|   +---------------------------+   +----------------------+ |
+--------------------------------------------------------------+
|  TOOLBAR INFERIOR (icons)                                   |
|  [Cortar] [Dividir] [Transição] [Texto] [Efeito] [Export]   |
+--------------------------------------------------------------+
|  TIMELINE (altura variável)                                 |
|  -------------------------------------------------------------------
|  | V1 | V2 | A1 | E1 | ... | (faixas)                               |
|  -------------------------------------------------------------------
|  PLAYHEAD →                                                    |
+--------------------------------------------------------------+
|  PAINEL LATERAL ESQUERDO   |   PAINEL CENTRAL (preview)   | PAINEL DIREITO |
|  [Mídia]                    |   (vazio)                    | [Propriedades] |
+--------------------------------------------------------------+
```
* **Barra Superior**: menus de aplicação, logo, botão de login.
* **Preview**: canvas WebGPU/WebCodecs com suporte a overlays.
* **Toolbar Inferior**: ícones de ação rápida, sempre fixos ao fundo.
* **Timeline**: scroll horizontal, zoom com roda do mouse, drag‑and‑drop.
* **Painéis Laterais**: colapsáveis, redimensionáveis, espelhados no padrão CapCut.

## Layout Mobile (portrait)
```
+---------------------------------------------------+
|  PREVIEW (full width, altura ~60% da tela)       |
+---------------------------------------------------+
|  TOOLBAR INFERIOR (icons)                        |
|  [Cortar] [Dividir] [Transição] … [Export]       |
+---------------------------------------------------+
|  TIMELINE (horizontal, scrollable)               |
|  ------------------------------------------------ |
|  | V1 | V2 | A1 | E1 | … | (faixas)            |
|  ------------------------------------------------ |
+---------------------------------------------------+
|  BOTÃO DE MENU (hamburger) → abre PAINEL LATERAL |
|  (Mídia, Efeitos, Texto, Áudio)                 |
+---------------------------------------------------+
```
* **Preview** ocupa a maior parte da tela, mantendo proporção 16:9.
* **Toolbar Inferior** fixa na base da tela – alcance fácil com polegar.
* **Timeline**: scroll horizontal com snap de clipes, suporte a pinch‑zoom.
* **Painel Lateral**: aberto como drawer a partir do botão hamburger; ocupa 80% da largura.

## Diretrizes de Design
1. **Consistência visual** – cores, tipografia e espaçamento seguem o tema já existente em `apps/web/src/styles/tailwind.config.ts`.
2. **Responsividade** – usar CSS Grid/Flex e media queries (`@media (min-width: 768px)`) para alternar entre layouts acima.
3. **Acessibilidade** – atributos `aria-label`, foco teclado nas toolbars, contraste ≥ 4.5:1.
4. **Estado de ferramenta** – ao selecionar um ícone a barra inferior destaca‑o com `bg-primary-500` e `shadow-md`.
5. **Undo/Redo** – todas as ações da barra inferior devem ser emitidas como **actions** do core (`packages/core/src/actions/`).

## Comportamento Interativo
| Interação | Desktop | Mobile |
|-----------|---------|--------|
| **Clique em clipe** | Seleciona clipe, exibe propriedades no painel direito. | Swipe para selecionar, painel aberto como drawer. |
| **Arrastar clipe** | Drag‑and‑drop entre faixas com preview de sobreposição. | Long‑press + drag, vibração leve haptics. |
| **Zoom da timeline** | Ctrl + rodinha do mouse ou botões `+/-`. | Pinch‑zoom com dois dedos. |
| **Exportar** | Modal central com opções de resolução/codec. | Full‑screen modal com botões grandes. |

## Componentes React sugeridos
- `Timeline.tsx` – container com `Track.tsx` e `Clip.tsx`.
- `ToolbarBottom.tsx` – ícones usando `react-icons` + estado via Zustand.
- `PreviewCanvas.tsx` – wrapper sobre `WebGLCanvas` existente.
- `DrawerMobile.tsx` – reutiliza `@radix-ui/react-drawer`.
- `ActionButton.tsx` – botão genérico que dispara uma **action**.

## Checklist de Implementação
- [ ] Criar esquema de layout (CSS Grid) em `apps/web/src/layouts/CapCutLayout.tsx`.
- [ ] Implementar barra inferior fixa com responsividade.
- [ ] Adaptar `Timeline` existente para suporte a drag‑and‑drop multi‑faixa.
- [ ] Adicionar drawer mobile para painéis laterais.
- [ ] Garantir que todas as ações criem objetos `Action` (undo/redo).
- [ ] Testar acessibilidade com axe‑core.
- [ ] Atualizar documentação de design (`docs/UI-CapCut-Design.md`).

---
*Esta especificação deve ser referenciada por todas as futuras PRs que alterem a UI do editor.*