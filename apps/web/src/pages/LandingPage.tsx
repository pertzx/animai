/**
 * Landing page pública do AnimAI (prompt.txt item 15).
 * Deslogado cai aqui; CTA leva ao login/registro.
 */

import React, { useEffect, useState } from "react";
import {
  Bot,
  Captions,
  Clapperboard,
  Cpu,
  Shield,
  Sparkles,
  Wand2,
} from "lucide-react";
import { API_URL } from "../stores/auth-store";

interface PublicPlan {
  slug: string;
  name: string;
  features: Record<string, boolean>;
  hasCheckout: boolean;
}

const FEATURES = [
  {
    icon: Bot,
    title: "Edite conversando",
    text: "Peça em português: “corte os silêncios”, “adicione legendas”, “aplique um look vintage”. O agente executa na timeline, com undo de tudo.",
  },
  {
    icon: Captions,
    title: "Transcrição e legendas locais",
    text: "Speech-to-text roda no seu computador. Legendas sincronizadas em um clique — seus arquivos nunca saem da sua máquina.",
  },
  {
    icon: Wand2,
    title: "Editor profissional",
    text: "Timeline multi-track, keyframes com easing, efeitos, transições, color grading, vetores e export até 4K — direto no navegador.",
  },
  {
    icon: Cpu,
    title: "Entende o seu vídeo",
    text: "Análise local de áudio (ritmo, silêncio, BPM) e texto na tela (OCR) dão contexto real ao assistente, gastando quase nada.",
  },
  {
    icon: Shield,
    title: "Privacidade de verdade",
    text: "Projetos e mídias ficam no seu dispositivo. O servidor só cuida da sua conta e do assistente.",
  },
];

const PLAN_FEATURE_LABELS: Record<string, string> = {
  assistant: "Assistente de IA",
  premiumCatalog: "Efeitos e templates premium",
  export4k: "Export em 4K",
  components: "Biblioteca de componentes",
  aiGenerate: "Geração de mídia por IA",
};

export const LandingPage: React.FC = () => {
  const [plans, setPlans] = useState<PublicPlan[]>([]);

  useEffect(() => {
    fetch(`${API_URL}/api/plans`)
      .then((r) => (r.ok ? r.json() : { plans: [] }))
      .then((d: { plans: PublicPlan[] }) => setPlans(d.plans))
      .catch(() => undefined);
  }, []);

  const go = (route: string) => {
    window.location.hash = `#/${route}`;
  };

  return (
    <div className="h-screen overflow-y-auto bg-bg text-fg">
      {/* Nav */}
      <nav className="mx-auto flex max-w-5xl items-center gap-3 px-6 py-5">
        <Clapperboard className="text-accent" size={22} />
        <span className="text-lg font-semibold">AnimAI</span>
        <div className="ml-auto flex items-center gap-3">
          <button
            className="text-sm text-fg-2 hover:text-fg"
            onClick={() => go("login")}
          >
            Entrar
          </button>
          <button
            className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-accent-fg"
            onClick={() => go("login")}
          >
            Começar grátis
          </button>
        </div>
      </nav>

      {/* Hero */}
      <header className="mx-auto max-w-3xl px-6 pb-16 pt-14 text-center">
        <p className="mb-4 inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs text-fg-2">
          <Sparkles size={12} className="text-accent" /> Editor de vídeo com
          agente de IA integrado
        </p>
        <h1 className="text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
          Edite vídeo <span className="text-accent">falando</span> com a sua
          timeline.
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-lg text-fg-2">
          O AnimAI une um editor profissional no navegador a um assistente que
          entende seu vídeo — áudio, fala e texto na tela — e edita por você.
        </p>
        <div className="mt-8 flex items-center justify-center gap-3">
          <button
            className="rounded-lg bg-accent px-6 py-3 text-sm font-medium text-accent-fg"
            onClick={() => go("login")}
          >
            Criar conta grátis
          </button>
          <button
            className="rounded-lg border border-border px-6 py-3 text-sm text-fg-2 hover:border-accent hover:text-fg"
            onClick={() => go("login")}
          >
            Já tenho conta
          </button>
        </div>
        <p className="mt-3 text-xs text-fg-muted">
          Sem instalação · seus arquivos ficam no seu computador
        </p>
      </header>

      {/* Features */}
      <section className="mx-auto max-w-5xl px-6 pb-16">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="rounded-xl border border-border bg-bg-1 p-5"
            >
              <f.icon size={20} className="mb-3 text-accent" />
              <h3 className="mb-1 text-sm font-semibold">{f.title}</h3>
              <p className="text-xs leading-relaxed text-fg-2">{f.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Planos */}
      {plans.length > 0 && (
        <section className="mx-auto max-w-4xl px-6 pb-16">
          <h2 className="mb-6 text-center text-2xl font-semibold">Planos</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {plans.map((p) => (
              <div
                key={p.slug}
                className={`rounded-xl border p-6 ${
                  p.hasCheckout
                    ? "border-accent bg-accent-soft"
                    : "border-border bg-bg-1"
                }`}
              >
                <h3 className="mb-3 text-lg font-semibold">{p.name}</h3>
                <ul className="mb-4 space-y-1.5 text-sm text-fg-2">
                  {Object.entries(p.features)
                    .filter(([, v]) => v)
                    .map(([k]) => (
                      <li key={k}>✓ {PLAN_FEATURE_LABELS[k] ?? k}</li>
                    ))}
                  <li>✓ Editor completo e export sem marca d’água</li>
                </ul>
                <button
                  className={`w-full rounded-lg py-2 text-sm font-medium ${
                    p.hasCheckout
                      ? "bg-accent text-accent-fg"
                      : "border border-border text-fg-2 hover:text-fg"
                  }`}
                  onClick={() => go("login")}
                >
                  {p.hasCheckout ? `Assinar ${p.name}` : "Começar grátis"}
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Footer */}
      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-5xl items-center gap-4 px-6 py-6 text-xs text-fg-muted">
          <span>© {new Date().getFullYear()} AnimAI</span>
          <a className="hover:text-fg" href="#/terms">
            Termos de Uso
          </a>
          <a className="hover:text-fg" href="#/privacy">
            Privacidade
          </a>
          <span className="ml-auto">Feito sobre OpenReel (MIT)</span>
        </div>
      </footer>
    </div>
  );
};
