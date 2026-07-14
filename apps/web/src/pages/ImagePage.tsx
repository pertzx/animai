import { Suspense, lazy } from "react";
import "./image-editor.css";

const ImageApp = lazy(() =>
  import("@openreel/image/App").then((m) => ({ default: m.default }))
);

const LoadingSpinner: React.FC = () => (
  <div className="h-screen w-screen bg-background flex flex-col items-center justify-center">
    <div className="w-10 h-10 border-2 border-primary border-t-transparent rounded-full animate-spin mb-3" />
    <p className="text-sm text-text-secondary">Loading image editor...</p>
  </div>
);

export default function ImagePage() {
  return (
    <div className="h-screen w-screen overflow-hidden fotovista-editor">
      <Suspense fallback={<LoadingSpinner />}>
        <ImageApp />
      </Suspense>
    </div>
  );
}