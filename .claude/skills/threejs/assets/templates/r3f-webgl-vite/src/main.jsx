import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";

// StrictMode intentionally double-invokes render (and effects, in dev) to
// surface impure side effects. This is safe with r3f's Canvas because r3f
// owns its own render loop and disposal outside of React's render phase —
// but if you ever see a scene "double up" (e.g. duplicated objects created
// via imperative side effects in a component body), that's a sign the
// effect wasn't idempotent, not a StrictMode bug. Remove StrictMode here if
// it gets in the way while iterating; it's a dev-only aid and has no effect
// on the production build.
createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
