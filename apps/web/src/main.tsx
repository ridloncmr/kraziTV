import { createRoot } from "react-dom/client";

function App() {
  return (
    <main>
      <h1>kraziTV</h1>
      <p>Broadcast automation for local media libraries.</p>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
