import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Minimal Vite config: just the React plugin (JSX + Fast Refresh). No
// special config is required to import 'three/webgpu' — it's a normal ESM
// entry point in three's package.json "exports" map and Vite pre-bundles it
// like any other dependency.
export default defineConfig({
  plugins: [react()],
});
