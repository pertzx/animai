import { useEffect, useCallback, useRef } from 'react';
import { useTimelineStore } from '../stores/timeline-store';

/**
 * Hook para pinch‑zoom na timeline (mobile).
 *
 * Escuta eventos `touchstart`, `touchmove` e `touchend` em um ref do elemento,
 * calcula a distância entre dois dedos e ajusta o zoom proporcionalmente.
 */
export function usePinchZoom(elementRef: React.RefObject<HTMLElement>) {
  const { zoomIn, zoomOut } = useTimelineStore();

  // Guarda a distância inicial do gesture para calcular o delta.
  const initialDistance = useRef<number | null>(null);

  const getDistance = (touches: TouchList): number => {
    if (touches.length < 2) return 0;
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  const onTouchStart = useCallback(
    (e: TouchEvent) => {
      if (e.touches.length === 2) {
        initialDistance.current = getDistance(e.touches);
      }
    },
    [],
  );

  const onTouchMove = useCallback(
    (e: TouchEvent) => {
      if (e.touches.length !== 2 || initialDistance.current === null) return;

      e.preventDefault(); // Evita scroll da página durante o pinch.

      const currentDist = getDistance(e.touches);
      const ratio = currentDist / initialDistance.current;

      // Ajusta o zoom suavemente: ratio > 1 => zoom in; ratio < 1 => zoom out.
      if (ratio > 1.1) {
        // Pequena tolerância para evitar tremor.
        zoomIn();
        initialDistance.current = currentDist; // Reinicia para próximo delta.
      } else if (ratio < 0.9) {
        zoomOut();
        initialDistance.current = currentDist;
      }
    },
    [zoomIn, zoomOut],
  );

  const onTouchEnd = useCallback(() => {
    initialDistance.current = null;
  }, []);

  useEffect(() => {
    const el = elementRef.current;
    if (!el) return;

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd);
    el.addEventListener('touchcancel', onTouchEnd);

    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [elementRef, onTouchStart, onTouchMove, onTouchEnd]);
}

export default usePinchZoom;