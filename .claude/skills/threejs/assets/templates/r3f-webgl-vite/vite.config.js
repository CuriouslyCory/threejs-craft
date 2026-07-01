import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Minimal Vite config: just the React plugin (JSX + Fast Refresh).
// No three.js-specific config is needed for the WebGL path — three ships
// standard ESM and Vite pre-bundles it like any other dependency.
export default defineConfig({
  plugins: [react()],
});
