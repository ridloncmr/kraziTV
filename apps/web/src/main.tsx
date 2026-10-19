import { createRoot } from "react-dom/client";
import { App } from "./app.js";
import "./desktop/chrome/xp-tokens.css";
import "./desktop/chrome/desktop.css";
import "./controls/controls.css";
import "./logon/logon.css";
import "./account-settings/account-settings.css";
import "./collections/collections.css";
import "./media-library/media-library.css";

createRoot(document.getElementById("root")!).render(<App />);
