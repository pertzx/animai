import { useEffect, useCallback, useRef, lazy, Suspense } from "react";
import { ToastContainer } from "./components/Toast";
import { ScriptViewDialog } from "./components/editor/ScriptViewDialog";
import { SearchModal } from "./components/editor/SearchModal";
import { MobileBlocker } from "./components/MobileBlocker";
import { WelcomeScreen } from "./components/welcome";
import { RecoveryDialog } from "./components/welcome/RecoveryDialog";
import { SharePage } from "./pages/SharePage";
import { LoginPage } from "./pages/LoginPage";
import { AdminPage } from "./pages/AdminPage";
import { LandingPage } from "./pages/LandingPage";
import { PrivacyPage, TermsPage } from "./pages/LegalPages";
import { useUIStore } from "./stores/ui-store";
import { useProjectStore } from "./stores/project-store";
import { useAuthStore, apiRequest } from "./stores/auth-store";
import { semanticAnalysisManager } from "./services/semantic/analysis-manager";
import { useRouter } from "./hooks/use-router";
import { useProjectRecovery } from "./hooks/useProjectRecovery";
import { useKieAIPoller } from "./hooks/useKieAIPoller";
import { SOCIAL_MEDIA_PRESETS, type SocialMediaCategory } from "@openreel/core";
import { TooltipProvider } from "@openreel/ui";

const EditorInterface = lazy(() =>
  import("./components/editor/EditorInterface").then((m) => ({
    default: m.EditorInterface,
  }))
);

const LoadingSpinner: React.FC<{ message: string }> = ({ message }) => (
  <div className="h-screen w-screen bg-background flex flex-col items-center justify-center">
    <div className="w-10 h-10 border-2 border-primary border-t-transparent rounded-full animate-spin mb-3" />
    <p className="text-sm text-text-secondary">{message}</p>
  </div>
);

const PRESET_DIMENSIONS: Record<string, SocialMediaCategory> = {
  "1080x1920": "tiktok",
  "1920x1080": "youtube-video",
  "1080x1080": "instagram-post",
  "720x1280": "instagram-stories",
  "1280x720": "youtube-video",
};

function App() {
  const { activeModal, closeModal, skipWelcomeScreen } = useUIStore();
  const { openModal: openSearchModal } = useUIStore();
  const createNewProject = useProjectStore((state) => state.createNewProject);
  const { showDialog, availableSaves, recover, dismiss, clearAll } = useProjectRecovery();

  const { route, params, navigate, parsedDimensions, fps } = useRouter();
  const hasHandledInitialRoute = useRef(false);

  useKieAIPoller();

  // ── AnimAI: sessão, STT local e metadados leves de projetos ─────────
  const { token, user, restore } = useAuthStore();
  const projectId = useProjectStore((s) => s.project.id);
  const projectName = useProjectStore((s) => s.project.name);

  useEffect(() => {
    void restore();
  }, [restore]);

  // Logado não fica em landing/login — segue para a welcome.
  useEffect(() => {
    if (token && (route === "landing" || route === "login")) {
      navigate("welcome");
    }
  }, [token, route, navigate]);

  useEffect(() => {
    // Um único analisador semântico auto-roda na mídia importada (conforme as
    // configurações) e alimenta transcript/insights/timeline de uma vez.
    semanticAnalysisManager.start();
    return () => semanticAnalysisManager.stop();
  }, []);

  useEffect(() => {
    if (!user || !projectId) return;
    // Só o nome vai ao servidor; o projeto em si fica local (prd.txt §6.2).
    void apiRequest(`/api/projects/${projectId}`, {
      method: "PUT",
      body: JSON.stringify({ name: projectName }),
    }).catch(() => undefined);
  }, [user, projectId, projectName]);

  useEffect(() => {
    if (hasHandledInitialRoute.current) return;

    if (route === "new") {
      hasHandledInitialRoute.current = true;

      let projectName = "New Project";
      let width = 1920;
      let height = 1080;
      let frameRate = fps;

      if (params.preset) {
        const presetKey = params.preset as SocialMediaCategory;
        const preset = SOCIAL_MEDIA_PRESETS[presetKey];
        if (preset) {
          width = preset.width;
          height = preset.height;
          frameRate = preset.frameRate || fps;
          projectName = `New ${presetKey.charAt(0).toUpperCase() + presetKey.slice(1).replace(/-/g, " ")} Project`;
        }
      } else if (parsedDimensions) {
        width = parsedDimensions.width;
        height = parsedDimensions.height;

        const dimensionKey = `${width}x${height}`;
        const matchingPreset = PRESET_DIMENSIONS[dimensionKey];
        if (matchingPreset) {
          const preset = SOCIAL_MEDIA_PRESETS[matchingPreset];
          frameRate = preset.frameRate || fps;
        }

        const aspectRatio = width / height;
        if (aspectRatio < 1) {
          projectName = "New Vertical Video";
        } else if (aspectRatio > 1) {
          projectName = "New Horizontal Video";
        } else {
          projectName = "New Square Video";
        }
      }

      createNewProject(projectName, { width, height, frameRate });
      navigate("editor");
    } else if (route === "editor" && skipWelcomeScreen) {
      hasHandledInitialRoute.current = true;
    } else if (["welcome", "templates", "recent"].includes(route)) {
      hasHandledInitialRoute.current = true;
    }
  }, [
    route,
    params,
    parsedDimensions,
    fps,
    createNewProject,
    navigate,
    skipWelcomeScreen,
  ]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape" && route !== "editor") {
        navigate("editor");
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        openSearchModal("search");
      }
    },
    [route, navigate, openSearchModal],
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  const showWelcome =
    ["welcome", "templates", "recent"].includes(route) && !skipWelcomeScreen;
  const initialTab =
    route === "templates"
      ? "templates"
      : route === "recent"
        ? "recent"
        : undefined;
  const isSharePage = route === "share" && params.shareId;

  // Páginas públicas: landing, termos e privacidade.
  if (route === "terms") return <TermsPage />;
  if (route === "privacy") return <PrivacyPage />;

  // Login obrigatório (prd.txt §6.1); share continua pública. Deslogado cai
  // na landing; o CTA leva ao login (#/login).
  if (!isSharePage && !token) {
    if (route === "login") {
      return (
        <TooltipProvider>
          <LoginPage />
          <ToastContainer />
        </TooltipProvider>
      );
    }
    return <LandingPage />;
  }

  if (route === "admin") {
    return (
      <TooltipProvider>
        <AdminPage />
        <ToastContainer />
      </TooltipProvider>
    );
  }

  return (
    <TooltipProvider>
      <div className="h-screen w-screen bg-background text-text-primary overflow-hidden">
        <MobileBlocker />
        {isSharePage ? (
          <SharePage shareId={params.shareId!} />
        ) : showWelcome ? (
          <WelcomeScreen initialTab={initialTab} />
        ) : (
          <Suspense fallback={<LoadingSpinner message="Loading editor..." />}>
            <EditorInterface />
          </Suspense>
        )}
        <ToastContainer />
        <ScriptViewDialog
          isOpen={activeModal === "scriptView"}
          onClose={closeModal}
        />
        <SearchModal isOpen={activeModal === "search"} onClose={closeModal} />
        {showDialog && availableSaves.length > 0 && (
          <RecoveryDialog
            saves={availableSaves}
            onRecover={async (saveId) => {
              const success = await recover(saveId);
              if (success) navigate("editor");
            }}
            onDismiss={dismiss}
            onClearAll={clearAll}
          />
        )}
      </div>
    </TooltipProvider>
  );
}

export default App;
