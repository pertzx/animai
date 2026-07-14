/**
 * TypeScript stubs for lazy-loaded image editor modules (@openreel/image/*).
 *
 * The image editor is a standalone app within the monorepo. Its internal
 * '@/*' path aliases don't resolve correctly under TSC because the web app
 * also uses '@/*' for its own source directory. Vite resolves these at
 * runtime via the vite.config.ts alias.
 */

declare module "@openreel/image/App" {
  const App: React.ComponentType;
  export default App;
}

declare module "@openreel/image/*" {
  const content: unknown;
  export = content;
}