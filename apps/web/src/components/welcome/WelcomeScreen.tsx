import { useState, useCallback, useEffect } from "react";
import {
  Clock,
  Layers,
  ArrowRight,
  Smartphone,
  Monitor,
  Square,
  FolderOpen,
  Sparkles,
  Image as ImageIcon,
  Wand2,
  Type,
  Zap,
  Palette,
  Camera,
  Mic,
  Star,
  BarChart3,
  Scissors,
  Film,
  Volume2,
  Box,
  Hash,
  Gauge,
  Globe,
} from "lucide-react";
import { Button, Switch, Label } from "@openreel/ui";
import { useProjectStore } from "../../stores/project-store";
import { useUIStore } from "../../stores/ui-store";
import { SOCIAL_MEDIA_PRESETS, type SocialMediaCategory } from "@openreel/core";
import { TemplateGallery } from "./TemplateGallery";
import { RecentProjects } from "./RecentProjects";
import { useRouter } from "../../hooks/use-router";
import { useEditorPreload } from "../../hooks/useEditorPreload";
import { useAnalytics, AnalyticsEvents } from "../../hooks/useAnalytics";

type ViewMode = "home" | "templates" | "recent";

interface WelcomeScreenProps {
  initialTab?: "templates" | "recent";
}

interface FormatOption {
  id: string;
  preset: SocialMediaCategory;
  label: string;
  description: string;
  dimensions: string;
  icon: React.ElementType;
  gradient: string;
  ring: string;
}

const FORMAT_OPTIONS: FormatOption[] = [
  {
    id: "vertical",
    preset: "tiktok",
    label: "Vertical",
    description: "TikTok, Reels, Shorts",
    dimensions: "1080 × 1920",
    icon: Smartphone,
    gradient: "from-violet-600/30 via-fuchsia-500/20 to-pink-500/20",
    ring: "ring-violet-500/40",
  },
  {
    id: "horizontal",
    preset: "youtube-video",
    label: "Horizontal",
    description: "YouTube, Vimeo, Web",
    dimensions: "1920 × 1080",
    icon: Monitor,
    gradient: "from-sky-600/30 via-blue-500/20 to-cyan-500/20",
    ring: "ring-sky-500/40",
  },
  {
    id: "square",
    preset: "instagram-post",
    label: "Square",
    description: "Instagram, Facebook",
    dimensions: "1080 × 1080",
    icon: Square,
    gradient: "from-orange-500/30 via-rose-500/20 to-red-500/20",
    ring: "ring-orange-500/40",
  },
];

const AnimAILogo: React.FC<{ className?: string }> = ({ className = "" }) => (
  <svg
    viewBox="0 0 490 490"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
  >
    <rect
      x="35"
      y="35"
      width="420"
      height="420"
      rx="110"
      stroke="currentColor"
      strokeWidth="30"
    />
    <path
      d="M200 165c0-15 16-24 29-17l122 73c12.7 7.6 12.7 26.4 0 34l-122 73c-13 7-29-2-29-17V165Z"
      fill="currentColor"
    />
    <path
      d="M138 118l9.5 26 26 9.5-26 9.5-9.5 26-9.5-26-26-9.5 26-9.5 9.5-26Z"
      fill="currentColor"
    />
  </svg>
);

type DashboardActionId =
  | "blank"
  | "image"
  | "templates"
  | "recent"
  | "ai-assistant"
  | "ai-image"
  | "motion";

interface DashboardAction {
  id: DashboardActionId;
  title: string;
  description: string;
  icon: React.ElementType;
  gradient: string;
  tag?: "NEW" | "AI" | "BETA" | "INTEGRATED";
  delegate?: () => void;
}

export const WelcomeScreen: React.FC<WelcomeScreenProps> = ({ initialTab }) => {
  const setSkipWelcomeScreen = useUIStore(
    (state) => state.setSkipWelcomeScreen,
  );
  const skipWelcomeScreen = useUIStore((state) => state.skipWelcomeScreen);
  const createNewProject = useProjectStore((state) => state.createNewProject);
  const openModal = useUIStore((state) => state.openModal);
  const { navigate } = useRouter();
  const { track } = useAnalytics();

  const [viewMode, setViewMode] = useState<ViewMode>(initialTab ?? "home");
  const [hoveredFormat, setHoveredFormat] = useState<string | null>(null);
  const [hoveredAction, setHoveredAction] = useState<string | null>(null);

  useEditorPreload(true);

  const handleCreateProject = useCallback(
    (option: FormatOption) => {
      const preset = SOCIAL_MEDIA_PRESETS[option.preset];
      createNewProject(`New ${option.label} Video`, {
        width: preset.width,
        height: preset.height,
        frameRate: preset.frameRate,
      });
      track(AnalyticsEvents.PROJECT_CREATED, {
        preset: option.preset,
        width: preset.width,
        height: preset.height,
        frameRate: preset.frameRate ?? 30,
        source: "quick_start",
      });
      navigate("editor");
    },
    [createNewProject, navigate, track],
  );

  const handleTemplateApplied = useCallback(() => {
    navigate("editor");
  }, [navigate]);

  const handleProjectSelected = useCallback(() => {
    navigate("editor");
  }, [navigate]);

  const openChat = useCallback(() => {
    // Chat panel is a side-panel; just open chat modal/activity.
    window.dispatchEvent(new CustomEvent("animai:open-chat"));
  }, []);

  const primaryActions: DashboardAction[] = [
    {
      id: "blank",
      title: "Blank project",
      description: "Start from scratch with a chosen format",
      icon: Film,
      gradient: "from-emerald-500/30 via-emerald-400/15 to-teal-500/20",
    },
    {
      id: "image",
      title: "Image editor",
      description: "Photos, layers, brushes, adjustments",
      icon: ImageIcon,
      gradient: "from-amber-500/30 via-orange-400/15 to-pink-500/20",
      tag: "INTEGRATED",
      delegate: () => navigate("image"),
    },
    {
      id: "templates",
      title: "Templates",
      description: "Pre-built layouts for any platform",
      icon: Layers,
      gradient: "from-indigo-500/30 via-violet-400/15 to-purple-500/20",
      delegate: () => setViewMode("templates"),
    },
    {
      id: "recent",
      title: "Recent projects",
      description: "Pick up where you left off",
      icon: Clock,
      gradient: "from-slate-500/30 via-zinc-400/15 to-slate-500/20",
      delegate: () => setViewMode("recent"),
    },
  ];

  const aiActions: DashboardAction[] = [
    {
      id: "ai-assistant",
      title: "AI assistant",
      description: "Ask, edit, and refactor by chat",
      icon: Sparkles,
      gradient: "from-fuchsia-500/30 via-purple-400/15 to-indigo-500/20",
      tag: "AI",
      delegate: () => openChat(),
    },
    {
      id: "ai-image",
      title: "Generate image",
      description: "Kie.ai models (Flux, Grok, Qwen…)",
      icon: Wand2,
      gradient: "from-pink-500/30 via-rose-400/15 to-fuchsia-500/20",
      tag: "AI",
      delegate: () => openModal("aiGen"),
    },
    {
      id: "motion",
      title: "Motion graphics",
      description: "Auto captions, beat sync, presets",
      icon: Zap,
      gradient: "from-cyan-500/30 via-teal-400/15 to-emerald-500/20",
      tag: "BETA",
    },
  ];

  const quickTools = [
    { icon: Mic, label: "Subtitles" },
    { icon: Type, label: "Text" },
    { icon: Volume2, label: "Audio" },
    { icon: Palette, label: "Color" },
    { icon: Scissors, label: "Trim" },
    { icon: Camera, label: "Camera" },
    { icon: Hash, label: "Captions" },
    { icon: Gauge, label: "Speed" },
    { icon: Box, label: "3D" },
    { icon: BarChart3, label: "Mixer" },
    { icon: Globe, label: "Subtitles STT" },
    { icon: Star, label: "Favorites" },
  ];

  useEffect(() => {
    if (skipWelcomeScreen) {
      navigate("editor");
    }
  }, [skipWelcomeScreen, navigate]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (viewMode !== "home") {
          setViewMode("home");
        } else {
          navigate("editor");
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [navigate, viewMode]);

  if (viewMode === "templates") {
    return (
      <div className="fixed inset-0 z-50 bg-background flex flex-col">
        <header className="flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 border-b border-border">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setViewMode("home")}
          >
            <ArrowRight className="rotate-180" size={16} />
            Back
          </Button>
          <h2 className="text-sm font-medium text-text-primary">Templates</h2>
          <div className="w-16" />
        </header>
        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          <TemplateGallery onTemplateApplied={handleTemplateApplied} />
        </div>
      </div>
    );
  }

  if (viewMode === "recent") {
    return (
      <div className="fixed inset-0 z-50 bg-background flex flex-col">
        <header className="flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 border-b border-border">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setViewMode("home")}
          >
            <ArrowRight className="rotate-180" size={16} />
            Back
          </Button>
          <h2 className="text-sm font-medium text-text-primary">
            Recent Projects
          </h2>
          <div className="w-16" />
        </header>
        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          <RecentProjects onProjectSelected={handleProjectSelected} />
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-background overflow-y-auto">
      {/* Background gradient layers */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(34,197,94,0.08),transparent_60%)] pointer-events-none" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_right,rgba(99,102,241,0.06),transparent_55%)] pointer-events-none" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_left,rgba(236,72,153,0.05),transparent_50%)] pointer-events-none" />

      <div className="relative min-h-full flex flex-col px-4 sm:px-6 lg:px-10 py-6 sm:py-10 max-sm:justify-start">
        <div className="w-full max-w-7xl mx-auto">
          {/* ─── HEADER: brand + tagline ─────────────────────────────── */}
          <header className="flex items-center justify-between mb-8 sm:mb-12">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 sm:w-11 sm:h-11 text-primary">
                <AnimAILogo className="w-full h-full" />
              </div>
              <div className="flex flex-col">
                <span className="text-base sm:text-lg font-semibold text-text-primary tracking-tight leading-tight">
                  AnimAI
                </span>
                <span className="text-[10px] sm:text-xs text-text-muted leading-tight">
                  AI-powered creative suite
                </span>
              </div>
            </div>
            <div className="hidden sm:flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate("editor")}
              >
                <FolderOpen size={16} />
                Open editor
              </Button>
            </div>
          </header>

          {/* ─── HERO ───────────────────────────────────────────────── */}
          <section className="mb-10 sm:mb-14">
            <div className="flex flex-col sm:flex-row sm:items-end gap-4 sm:gap-8">
              <div className="flex-1">
                <h1 className="text-3xl sm:text-5xl lg:text-6xl font-bold text-text-primary tracking-tight leading-[1.05] mb-3">
                  From idea to export.
                </h1>
                <p className="text-base sm:text-xl text-text-secondary max-w-2xl">
                  Video, photo, motion and AI — all in your browser.
                </p>
              </div>
              <div className="flex items-center gap-2 sm:gap-3">
                <Switch
                  id="skip-welcome"
                  checked={skipWelcomeScreen}
                  onCheckedChange={setSkipWelcomeScreen}
                />
                <Label
                  htmlFor="skip-welcome"
                  className="text-xs sm:text-sm text-text-muted cursor-pointer"
                >
                  Skip on startup
                </Label>
              </div>
            </div>
          </section>

          {/* ─── PRIMARY ACTIONS (4 large) ─────────────────────────── */}
          <section className="mb-10 sm:mb-14">
            <h2 className="text-xs font-medium text-text-muted uppercase tracking-wider mb-3 sm:mb-4">
              Start something
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
              {primaryActions.map((action) => {
                const Icon = action.icon;
                const isHovered = hoveredAction === action.id;
                const clickable = !!action.delegate;
                return (
                  <button
                    key={action.id}
                    onClick={() => {
                      action.delegate?.();
                      track(AnalyticsEvents.PROJECT_CREATED, {
                        source: `dashboard:${action.id}`,
                      });
                    }}
                    onMouseEnter={() => setHoveredAction(action.id)}
                    onMouseLeave={() => setHoveredAction(null)}
                    disabled={!clickable}
                    className={`
                      group relative flex flex-col items-start p-4 sm:p-5 rounded-2xl
                      bg-background-secondary border border-border
                      hover:border-primary/40 hover:bg-background-tertiary
                      transition-all duration-200 text-left
                      ${isHovered && clickable ? "scale-[1.02] shadow-lg shadow-primary/10" : ""}
                      ${!clickable ? "opacity-60 cursor-default" : "cursor-pointer"}
                    `}
                  >
                    <div
                      className={`
                        absolute inset-0 rounded-2xl bg-gradient-to-br ${action.gradient}
                        opacity-0 group-hover:opacity-100 transition-opacity duration-300
                        pointer-events-none
                      `}
                    />
                    <div className="relative z-10 flex items-start justify-between w-full mb-3">
                      <div
                        className={`
                          w-10 h-10 sm:w-11 sm:h-11 rounded-xl flex items-center justify-center
                          bg-background-tertiary group-hover:bg-primary/15
                          transition-colors duration-200
                        `}
                      >
                        <Icon
                          size={20}
                          className="text-text-muted group-hover:text-primary transition-colors"
                        />
                      </div>
                      {action.tag && (
                        <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-primary/15 text-primary">
                          {action.tag}
                        </span>
                      )}
                    </div>
                    <div className="relative z-10 flex flex-col items-start flex-1">
                      <h3 className="text-sm sm:text-base font-semibold text-text-primary mb-1">
                        {action.title}
                      </h3>
                      <p className="text-xs sm:text-sm text-text-muted leading-snug">
                        {action.description}
                      </p>
                    </div>
                    {clickable && (
                      <div
                        className={`
                          relative z-10 mt-3 flex items-center gap-1 text-xs font-medium text-primary
                          opacity-0 group-hover:opacity-100 translate-y-1 group-hover:translate-y-0
                          transition-all duration-200
                        `}
                      >
                        Open
                        <ArrowRight size={12} />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </section>

          {/* ─── FORMAT PICKER (collapsible on mobile) ──────────────── */}
          <section className="mb-10 sm:mb-14">
            <h2 className="text-xs font-medium text-text-muted uppercase tracking-wider mb-3 sm:mb-4">
              Pick a format
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
              {FORMAT_OPTIONS.map((option) => {
                const Icon = option.icon;
                const isHovered = hoveredFormat === option.id;
                return (
                  <button
                    key={option.id}
                    onClick={() => handleCreateProject(option)}
                    onMouseEnter={() => setHoveredFormat(option.id)}
                    onMouseLeave={() => setHoveredFormat(null)}
                    className={`
                      group relative flex flex-col items-center p-5 sm:p-6 rounded-2xl
                      bg-background-secondary border border-border
                      hover:border-primary/40 hover:bg-background-tertiary
                      transition-all duration-200
                      ${isHovered ? `scale-[1.02] shadow-lg shadow-primary/5 ring-1 ${option.ring}` : ""}
                    `}
                  >
                    <div
                      className={`
                        absolute inset-0 rounded-2xl bg-gradient-to-br ${option.gradient}
                        opacity-0 group-hover:opacity-100 transition-opacity duration-300
                        pointer-events-none
                      `}
                    />
                    <div className="relative z-10 flex flex-col items-center">
                      <div className="w-12 h-12 sm:w-14 sm:h-14 mb-3 rounded-xl flex items-center justify-center bg-background-tertiary group-hover:bg-primary/10 transition-colors duration-200">
                        <Icon
                          size={24}
                          className="text-text-muted group-hover:text-primary transition-colors"
                        />
                      </div>
                      <h3 className="text-base sm:text-lg font-semibold text-text-primary mb-0.5">
                        {option.label}
                      </h3>
                      <p className="text-xs text-text-muted mb-2">
                        {option.description}
                      </p>
                      <span className="text-[10px] font-mono text-text-muted/70 bg-background-tertiary px-2 py-0.5 rounded">
                        {option.dimensions}
                      </span>
                    </div>
                    <div
                      className={`
                        absolute bottom-3 left-1/2 -translate-x-1/2
                        flex items-center gap-1 text-xs font-medium text-primary
                        opacity-0 group-hover:opacity-100 translate-y-2 group-hover:translate-y-0
                        transition-all duration-200
                      `}
                    >
                      Start
                      <ArrowRight size={12} />
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          {/* ─── AI TOOLS ───────────────────────────────────────────── */}
          <section className="mb-10 sm:mb-14">
            <div className="flex items-baseline justify-between mb-3 sm:mb-4">
              <h2 className="text-xs font-medium text-text-muted uppercase tracking-wider">
                AI features
              </h2>
              <span className="text-[10px] sm:text-xs text-text-muted/70 hidden sm:inline">
                Powered by GPT-4o, Claude, Gemma + your API keys
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
              {aiActions.map((action) => {
                const Icon = action.icon;
                return (
                  <button
                    key={action.id}
                    onClick={() => {
                      action.delegate?.();
                      track(AnalyticsEvents.PROJECT_CREATED, {
                        source: `dashboard:ai:${action.id}`,
                      });
                    }}
                    onMouseEnter={() => setHoveredAction(action.id)}
                    onMouseLeave={() => setHoveredAction(null)}
                    disabled={!action.delegate}
                    className={`
                      group relative flex items-start gap-3 p-4 rounded-xl
                      bg-background-secondary border border-border
                      hover:border-primary/40 hover:bg-background-tertiary
                      transition-all duration-200 text-left
                      ${hoveredAction === action.id && action.delegate ? "scale-[1.02] shadow-md shadow-primary/10" : ""}
                      ${!action.delegate ? "opacity-50 cursor-default" : "cursor-pointer"}
                    `}
                  >
                    <div className="absolute inset-0 rounded-xl bg-gradient-to-br opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />
                    <div
                      className={`absolute inset-0 rounded-xl bg-gradient-to-br ${action.gradient} opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none`}
                    />
                    <div className="relative z-10 w-10 h-10 rounded-lg flex items-center justify-center bg-background-tertiary group-hover:bg-primary/15 transition-colors shrink-0">
                      <Icon size={18} className="text-text-muted group-hover:text-primary transition-colors" />
                    </div>
                    <div className="relative z-10 flex flex-col items-start flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="text-sm font-semibold text-text-primary">
                          {action.title}
                        </h3>
                        {action.tag && (
                          <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-primary/15 text-primary">
                            {action.tag}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-text-muted leading-snug">
                        {action.description}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          {/* ─── QUICK TOOLS (icon strips) ─────────────────────────── */}
          <section className="mb-10 sm:mb-14">
            <h2 className="text-xs font-medium text-text-muted uppercase tracking-wider mb-3 sm:mb-4">
              Quick tools
            </h2>
            <div className="grid grid-cols-3 sm:grid-cols-6 lg:grid-cols-12 gap-2">
              {quickTools.map((tool) => {
                const Icon = tool.icon;
                return (
                  <button
                    key={tool.label}
                    onClick={() => navigate("editor")}
                    title={tool.label}
                    className="
                      flex flex-col items-center justify-center gap-1
                      p-2.5 sm:p-3 rounded-xl
                      bg-background-secondary border border-border
                      hover:bg-background-tertiary hover:border-primary/30
                      transition-colors duration-150
                      min-h-[64px] sm:min-h-[72px]
                    "
                  >
                    <Icon
                      size={18}
                      className="text-text-muted group-hover:text-primary sm:w-5 sm:h-5"
                    />
                    <span className="text-[10px] sm:text-xs text-text-secondary text-center leading-tight">
                      {tool.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          {/* ─── KEYBOARD HINT ────────────────────────────────────── */}
          <footer className="flex flex-wrap items-center justify-center gap-2 sm:gap-4 py-4 text-xs text-text-muted/70">
            <span className="flex items-center gap-1.5">
              Press <kbd className="px-1.5 py-0.5 bg-background-tertiary border border-border rounded text-text-muted font-mono text-[10px]">Esc</kbd> to open editor
            </span>
            <span className="text-text-muted/30">·</span>
            <span className="flex items-center gap-1.5">
              <kbd className="px-1.5 py-0.5 bg-background-tertiary border border-border rounded text-text-muted font-mono text-[10px]">⌘</kbd>
              <kbd className="px-1.5 py-0.5 bg-background-tertiary border border-border rounded text-text-muted font-mono text-[10px]">K</kbd>
              to search
            </span>
            <span className="text-text-muted/30 hidden sm:inline">·</span>
            <span className="hidden sm:flex items-center gap-1.5">
              <kbd className="px-1.5 py-0.5 bg-background-tertiary border border-border rounded text-text-muted font-mono text-[10px]">⌘</kbd>
              <kbd className="px-1.5 py-0.5 bg-background-tertiary border border-border rounded text-text-muted font-mono text-[10px]">/</kbd>
              opens AI chat
            </span>
          </footer>
        </div>
      </div>
    </div>
  );
};

export default WelcomeScreen;