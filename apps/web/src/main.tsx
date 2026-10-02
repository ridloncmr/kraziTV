import { createRoot } from "react-dom/client";

/** Placeholder shell until the Web UI milestone adds real screens. */
function App() {
  return (
    <main>
      <h1>kraziTV</h1>
      <p>Broadcast automation for local media libraries.</p>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
