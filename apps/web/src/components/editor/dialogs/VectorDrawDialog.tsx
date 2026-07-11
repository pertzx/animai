/**
 * Pen tool (prompt.txt item 3b): desenhe um vetor clicando para criar pontos
 * (arraste para mover), com suavização bézier opcional, e adicione à timeline
 * como clipe SVG pelo pipeline existente (importSVG).
 */

import React, { useCallback, useRef, useState } from "react";
import { Check, Eraser, Redo2, X } from "lucide-react";
import { useProjectStore } from "../../../stores/project-store";
import { toast } from "../../../stores/notification-store";

interface Point {
  x: number;
  y: number;
}

const VIEW_W = 100;
const VIEW_H = 100;

/** Converte pontos em path SVG; suave = Catmull-Rom → cúbicas de bézier. */
function buildPath(points: Point[], smooth: boolean, closed: boolean): string {
  if (points.length < 2) return "";
  const p = closed && smooth ? [...points, points[0]] : points;

  if (!smooth) {
    const d = p
      .map((pt, i) => `${i === 0 ? "M" : "L"}${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`)
      .join(" ");
    return closed ? `${d} Z` : d;
  }

  let d = `M${p[0].x.toFixed(1)} ${p[0].y.toFixed(1)}`;
  for (let i = 0; i < p.length - 1; i++) {
    const p0 = p[i - 1] ?? p[i];
    const p1 = p[i];
    const p2 = p[i + 1];
    const p3 = p[i + 2] ?? p2;
    // Catmull-Rom para bézier cúbica (tensão 1/6)
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    d += ` C${c1.x.toFixed(1)} ${c1.y.toFixed(1)}, ${c2.x.toFixed(1)} ${c2.y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return closed && !smooth ? `${d} Z` : d;
}

export const VectorDrawDialog: React.FC<{
  isOpen: boolean;
  onClose: () => void;
}> = ({ isOpen, onClose }) => {
  const [points, setPoints] = useState<Point[]>([]);
  const [smooth, setSmooth] = useState(true);
  const [closed, setClosed] = useState(false);
  const [stroke, setStroke] = useState("#10b981");
  const [strokeWidth, setStrokeWidth] = useState(4);
  const [fill, setFill] = useState("none");
  const svgRef = useRef<SVGSVGElement>(null);
  const dragIndex = useRef<number | null>(null);

  const toLocal = useCallback((e: React.PointerEvent): Point => {
    const rect = svgRef.current!.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * VIEW_W,
      y: ((e.clientY - rect.top) / rect.height) * VIEW_H,
    };
  }, []);

  if (!isOpen) return null;

  const path = buildPath(points, smooth, closed);

  const addToTimeline = () => {
    if (points.length < 2) {
      toast.warning("Desenhe primeiro", "clique no quadro para criar pontos");
      return;
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEW_W} ${VIEW_H}" fill="none"><path d="${path}" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" fill="${fill}"/></svg>`;
    void (async () => {
      const state = useProjectStore.getState();
      const tracksBefore = state.project.timeline.tracks;
      await state.addTrack("graphics", 0);
      const newTrack = useProjectStore
        .getState()
        .project.timeline.tracks.find(
          (t) => t.type === "graphics" && !tracksBefore.some((b) => b.id === t.id),
        );
      if (newTrack) {
        state.importSVG(svg, newTrack.id, 0);
        toast.success("Vetor adicionado", "desenho criado na timeline");
        setPoints([]);
        onClose();
      }
    })();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-[30rem] rounded-xl border border-border bg-bg-1 p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-medium text-fg">Desenhar vetor</h3>
          <button className="text-fg-muted hover:text-fg" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <svg
          ref={svgRef}
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          className="aspect-square w-full cursor-crosshair rounded-lg border border-border bg-[repeating-conic-gradient(#1f2937_0%_25%,#111827_0%_50%)] bg-[length:16px_16px]"
          onPointerDown={(e) => {
            const pt = toLocal(e);
            // Arrastar ponto existente se clicar perto (raio 4 unidades)
            const near = points.findIndex(
              (p) => Math.hypot(p.x - pt.x, p.y - pt.y) < 4,
            );
            if (near >= 0) {
              dragIndex.current = near;
            } else {
              setPoints((prev) => [...prev, pt]);
              dragIndex.current = points.length;
            }
            (e.target as Element).setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (dragIndex.current === null) return;
            const pt = toLocal(e);
            setPoints((prev) =>
              prev.map((p, i) => (i === dragIndex.current ? pt : p)),
            );
          }}
          onPointerUp={() => {
            dragIndex.current = null;
          }}
        >
          {path && (
            <path
              d={path}
              stroke={stroke}
              strokeWidth={strokeWidth}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill={fill}
            />
          )}
          {points.map((p, i) => (
            <circle
              key={i}
              cx={p.x}
              cy={p.y}
              r={2}
              fill={i === 0 ? "#f59e0b" : "#ffffff"}
              stroke="#0f172a"
              strokeWidth={0.6}
            />
          ))}
        </svg>

        <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-fg-2">
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={smooth}
              onChange={(e) => setSmooth(e.target.checked)}
            />
            Suavizar curvas (bézier)
          </label>
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={closed}
              onChange={(e) => setClosed(e.target.checked)}
            />
            Fechar forma
          </label>
          <label className="flex items-center gap-1.5">
            Traço
            <input
              type="color"
              value={stroke}
              onChange={(e) => setStroke(e.target.value)}
            />
            <input
              type="range"
              min={1}
              max={12}
              value={strokeWidth}
              onChange={(e) => setStrokeWidth(Number(e.target.value))}
            />
          </label>
          <label className="flex items-center gap-1.5">
            Preenchimento
            <input
              type="color"
              value={fill === "none" ? "#10b981" : fill}
              onChange={(e) => setFill(e.target.value)}
            />
            <button
              className={`rounded border border-border px-1.5 py-0.5 text-[10px] ${fill === "none" ? "text-accent" : "text-fg-muted"}`}
              onClick={() => setFill(fill === "none" ? "#10b981" : "none")}
            >
              {fill === "none" ? "sem" : "com"}
            </button>
          </label>
        </div>

        <div className="mt-3 flex items-center gap-2">
          <button
            className="flex items-center gap-1 rounded border border-border px-2.5 py-1.5 text-xs text-fg-2 hover:text-fg"
            onClick={() => setPoints((prev) => prev.slice(0, -1))}
          >
            <Redo2 size={12} className="-scale-x-100" /> Desfazer ponto
          </button>
          <button
            className="flex items-center gap-1 rounded border border-border px-2.5 py-1.5 text-xs text-fg-2 hover:text-fg"
            onClick={() => setPoints([])}
          >
            <Eraser size={12} /> Limpar
          </button>
          <button
            className="ml-auto flex items-center gap-1.5 rounded bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg disabled:opacity-40"
            disabled={points.length < 2}
            onClick={addToTimeline}
          >
            <Check size={13} /> Adicionar ao vídeo
          </button>
        </div>
      </div>
    </div>
  );
};
