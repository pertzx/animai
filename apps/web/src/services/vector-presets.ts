/**
 * Biblioteca de vetores pré-prontos (prompt.txt item 3a).
 * SVGs inline, importados pelo mesmo pipeline de SVG do editor (tintáveis
 * pelo colorStyle do SVGClip). viewBox 100x100, branco por padrão.
 */

export interface VectorPreset {
  id: string;
  name: string;
  category: "setas" | "balões" | "formas" | "badges" | "linhas" | "brilhos";
  svg: string;
}

const s = (body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none">${body}</svg>`;

const W = '#ffffff';

export const VECTOR_PRESETS: VectorPreset[] = [
  // ── Setas ─────────────────────────────────────────────────────────
  { id: "arrow-right", name: "Seta direita", category: "setas",
    svg: s(`<path d="M10 50h60M50 25l25 25-25 25" stroke="${W}" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>`) },
  { id: "arrow-left", name: "Seta esquerda", category: "setas",
    svg: s(`<path d="M90 50H30M50 25L25 50l25 25" stroke="${W}" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>`) },
  { id: "arrow-up", name: "Seta cima", category: "setas",
    svg: s(`<path d="M50 90V30M25 50l25-25 25 25" stroke="${W}" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>`) },
  { id: "arrow-down", name: "Seta baixo", category: "setas",
    svg: s(`<path d="M50 10v60M25 50l25 25 25-25" stroke="${W}" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>`) },
  { id: "arrow-solid", name: "Seta sólida", category: "setas",
    svg: s(`<path d="M10 38h45V20l35 30-35 30V62H10V38Z" fill="${W}"/>`) },
  { id: "arrow-curved", name: "Seta curva", category: "setas",
    svg: s(`<path d="M15 80C15 45 40 25 75 25" stroke="${W}" stroke-width="9" stroke-linecap="round" fill="none"/><path d="M60 12l18 12-14 17" stroke="${W}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`) },
  { id: "arrow-scribble", name: "Seta rabisco", category: "setas",
    svg: s(`<path d="M12 70c20 8 30-20 18-24-10-3-14 16 4 18 26 3 38-24 52-34" stroke="${W}" stroke-width="7" stroke-linecap="round" fill="none"/><path d="M72 18l16 8-6 18" stroke="${W}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`) },
  { id: "arrow-double", name: "Seta dupla", category: "setas",
    svg: s(`<path d="M30 25 10 50l20 25M70 25l20 25-20 25M35 50h30" stroke="${W}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>`) },

  // ── Balões de fala ────────────────────────────────────────────────
  { id: "speech-round", name: "Balão redondo", category: "balões",
    svg: s(`<path d="M50 12c-24 0-40 14-40 32 0 12 7 22 19 27l-4 17 20-12c26 1 45-13 45-32 0-18-16-32-40-32Z" fill="${W}"/>`) },
  { id: "speech-rect", name: "Balão retângulo", category: "balões",
    svg: s(`<path d="M10 15h80v50H45L25 88l3-23H10V15Z" fill="${W}"/>`) },
  { id: "thought", name: "Balão pensamento", category: "balões",
    svg: s(`<ellipse cx="55" cy="38" rx="34" ry="24" fill="${W}"/><circle cx="28" cy="72" r="8" fill="${W}"/><circle cx="16" cy="86" r="5" fill="${W}"/>`) },
  { id: "shout", name: "Balão grito", category: "balões",
    svg: s(`<path d="M50 8l7 14 16-8-2 17 17 3-11 13 13 11-17 5 5 17-17-4-5 16-11-13-13 11-2-17-17 1 9-15-14-9 16-8-7-15 17 2 3-17 13 12Z" fill="${W}"/>`) },
  { id: "caption-box", name: "Caixa de legenda", category: "balões",
    svg: s(`<rect x="8" y="30" width="84" height="40" rx="8" fill="${W}"/>`) },
  { id: "banner-ribbon", name: "Faixa", category: "balões",
    svg: s(`<path d="M14 35h72v30H14z" fill="${W}"/><path d="M14 35 2 50l12 15V35ZM86 35l12 15-12 15V35Z" fill="${W}" opacity=".7"/>`) },

  // ── Formas / blobs ────────────────────────────────────────────────
  { id: "blob-1", name: "Blob orgânico", category: "formas",
    svg: s(`<path d="M50 8c18 0 38 10 40 28 2 17-10 26-8 40 2 13-14 18-30 16C34 90 12 84 10 66 8 49 22 44 20 30 18 17 32 8 50 8Z" fill="${W}"/>`) },
  { id: "blob-2", name: "Blob suave", category: "formas",
    svg: s(`<path d="M52 10c20 2 34 16 36 34 2 19-12 38-32 42S16 80 10 60c-6-19 4-38 16-44 10-5 16-7 26-6Z" fill="${W}"/>`) },
  { id: "heart", name: "Coração", category: "formas",
    svg: s(`<path d="M50 88C28 70 8 54 8 34 8 20 19 10 32 10c8 0 15 4 18 10 3-6 10-10 18-10 13 0 24 10 24 24 0 20-20 36-42 54Z" fill="${W}"/>`) },
  { id: "lightning", name: "Raio", category: "formas",
    svg: s(`<path d="M58 6 20 56h20l-8 38 40-52H50l8-36Z" fill="${W}"/>`) },
  { id: "check", name: "Check", category: "formas",
    svg: s(`<path d="M14 54l24 24 48-52" stroke="${W}" stroke-width="14" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`) },
  { id: "cross", name: "X", category: "formas",
    svg: s(`<path d="M22 22l56 56M78 22 22 78" stroke="${W}" stroke-width="14" stroke-linecap="round"/>`) },
  { id: "pin", name: "Pin de mapa", category: "formas",
    svg: s(`<path d="M50 6C33 6 20 19 20 36c0 22 30 56 30 56s30-34 30-56C80 19 67 6 50 6Z" fill="${W}"/><circle cx="50" cy="36" r="12" fill="#0000" stroke="${W}" stroke-width="0" opacity="0"/><circle cx="50" cy="36" r="11" fill="black" opacity=".25"/>`) },
  { id: "play-btn", name: "Botão play", category: "formas",
    svg: s(`<circle cx="50" cy="50" r="42" fill="${W}"/><path d="M42 32l26 18-26 18V32Z" fill="black" opacity=".3"/>`) },

  // ── Badges ────────────────────────────────────────────────────────
  { id: "badge-circle", name: "Selo circular", category: "badges",
    svg: s(`<path d="M50 4l9 10 13-4 3 13 13 4-5 13 9 10-11 8 2 13-13 1-6 12-12-6-12 6-6-12-13-1 2-13-11-8 9-10-5-13 13-4 3-13 13 4 9-10Z" fill="${W}"/>`) },
  { id: "badge-new", name: "Tag NEW", category: "badges",
    svg: s(`<rect x="6" y="32" width="88" height="36" rx="18" fill="${W}"/>`) },
  { id: "badge-star", name: "Estrela", category: "badges",
    svg: s(`<path d="M50 6l13 27 30 4-22 21 5 30-26-14-26 14 5-30L7 37l30-4L50 6Z" fill="${W}"/>`) },
  { id: "badge-shield", name: "Escudo", category: "badges",
    svg: s(`<path d="M50 6 12 20v26c0 24 16 40 38 48 22-8 38-24 38-48V20L50 6Z" fill="${W}"/>`) },
  { id: "badge-discount", name: "Etiqueta", category: "badges",
    svg: s(`<path d="M8 46 46 8h46v46L54 92 8 46Z" fill="${W}"/><circle cx="72" cy="28" r="8" fill="black" opacity=".3"/>`) },
  { id: "badge-frame", name: "Moldura", category: "badges",
    svg: s(`<rect x="10" y="10" width="80" height="80" rx="10" stroke="${W}" stroke-width="8" fill="none"/>`) },

  // ── Linhas / divisores ────────────────────────────────────────────
  { id: "line-straight", name: "Linha reta", category: "linhas",
    svg: s(`<path d="M6 50h88" stroke="${W}" stroke-width="8" stroke-linecap="round"/>`) },
  { id: "line-dashed", name: "Linha tracejada", category: "linhas",
    svg: s(`<path d="M6 50h88" stroke="${W}" stroke-width="8" stroke-linecap="round" stroke-dasharray="14 12"/>`) },
  { id: "line-wave", name: "Linha ondulada", category: "linhas",
    svg: s(`<path d="M4 50c8-16 16-16 24 0s16 16 24 0 16-16 24 0 12 12 20 0" stroke="${W}" stroke-width="7" stroke-linecap="round" fill="none"/>`) },
  { id: "line-zigzag", name: "Zigue-zague", category: "linhas",
    svg: s(`<path d="M4 60 20 40l16 20 16-20 16 20 16-20 12 16" stroke="${W}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`) },
  { id: "underline-brush", name: "Sublinhado pincel", category: "linhas",
    svg: s(`<path d="M8 55c30-8 60-8 84-4-20 2-44 6-62 12 14-2 34-4 50-3" stroke="${W}" stroke-width="6" stroke-linecap="round" fill="none"/>`) },
  { id: "divider-dots", name: "Divisor pontos", category: "linhas",
    svg: s(`<circle cx="20" cy="50" r="7" fill="${W}"/><circle cx="50" cy="50" r="7" fill="${W}"/><circle cx="80" cy="50" r="7" fill="${W}"/>`) },

  // ── Brilhos / destaques ───────────────────────────────────────────
  { id: "sparkle", name: "Brilho", category: "brilhos",
    svg: s(`<path d="M50 8c4 20 12 30 34 34-22 4-30 12-34 34-4-22-12-30-34-34 22-4 30-14 34-34Z" fill="${W}"/>`) },
  { id: "sparkle-double", name: "Brilho duplo", category: "brilhos",
    svg: s(`<path d="M38 12c3 15 9 22 25 25-16 3-22 9-25 25-3-16-9-22-25-25 16-3 22-10 25-25Z" fill="${W}"/><path d="M74 56c2 9 6 13 15 15-9 2-13 6-15 15-2-9-6-13-15-15 9-2 13-6 15-15Z" fill="${W}"/>`) },
  { id: "burst", name: "Explosão de linhas", category: "brilhos",
    svg: s(`<path d="M50 6v18M50 76v18M6 50h18M76 50h18M19 19l13 13M68 68l13 13M81 19 68 32M32 68 19 81" stroke="${W}" stroke-width="8" stroke-linecap="round"/>`) },
  { id: "focus-lines", name: "Linhas de foco", category: "brilhos",
    svg: s(`<path d="M50 4v14M78 10l-6 13M96 32l-13 7M14 68l13-7M4 32l13 7M22 10l6 13" stroke="${W}" stroke-width="7" stroke-linecap="round"/>`) },
  { id: "circle-highlight", name: "Círculo destaque", category: "brilhos",
    svg: s(`<ellipse cx="50" cy="50" rx="42" ry="28" stroke="${W}" stroke-width="7" fill="none" transform="rotate(-6 50 50)"/>`) },
  { id: "confetti", name: "Confete", category: "brilhos",
    svg: s(`<rect x="12" y="16" width="10" height="10" rx="2" fill="${W}" transform="rotate(20 17 21)"/><rect x="70" y="10" width="9" height="9" rx="2" fill="${W}" transform="rotate(-15 74 14)"/><circle cx="46" cy="26" r="5" fill="${W}"/><rect x="26" y="62" width="9" height="9" rx="2" fill="${W}" transform="rotate(40 30 66)"/><circle cx="80" cy="56" r="6" fill="${W}"/><rect x="52" y="76" width="10" height="10" rx="2" fill="${W}" transform="rotate(-30 57 81)"/><circle cx="16" cy="86" r="5" fill="${W}"/><circle cx="88" cy="84" r="4" fill="${W}"/>`) },
];

export const VECTOR_CATEGORIES = [
  "setas",
  "balões",
  "formas",
  "badges",
  "linhas",
  "brilhos",
] as const;
