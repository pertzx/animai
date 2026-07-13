/**
 * Breakpoints responsivos (Fase mobile). Reativo via matchMedia — atualiza ao
 * girar o aparelho ou redimensionar. Fonte única de "estou no mobile?" para
 * substituir as detecções ad-hoc espalhadas (userAgent/innerWidth).
 *
 * Alinhado aos breakpoints padrão do Tailwind (md = 768px).
 */
import { useEffect, useState } from "react";

// Mobile = tela estreita OU aparelho de toque (pointer grosso) até 900px. O
// segundo termo é uma rede de segurança para casos em que a largura reportada
// não bate (ex.: viewport esquisito), garantindo o layout mobile no celular.
const MOBILE_QUERY =
  "(max-width: 767px), (pointer: coarse) and (max-width: 900px)";
const TABLET_QUERY = "(min-width: 768px) and (max-width: 1023px)";
const COARSE_POINTER_QUERY = "(pointer: coarse)";

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(query).matches
      : false,
  );

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

/** Tela estreita (< 768px) — layout mobile de view única. */
export function useIsMobile(): boolean {
  return useMediaQuery(MOBILE_QUERY);
}

/** Tablet (768–1023px). */
export function useIsTablet(): boolean {
  return useMediaQuery(TABLET_QUERY);
}

/** Aparelho com toque como ponteiro primário (celular/tablet). */
export function useHasCoarsePointer(): boolean {
  return useMediaQuery(COARSE_POINTER_QUERY);
}
