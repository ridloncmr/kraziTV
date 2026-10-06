import { createRoot } from "react-dom/client";
import { DesktopShell } from "./desktop/desktop-shell.js";
import "./desktop/chrome/xp-tokens.css";
import "./desktop/chrome/desktop.css";
import "./controls/controls.css";

createRoot(document.getElementById("root")!).render(<DesktopShell />);
