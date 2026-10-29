import { createRoot } from "react-dom/client";
import { App } from "./app.js";
import "./desktop/chrome/xp-tokens.css";
import "./desktop/chrome/desktop.css";
import "./controls/controls.css";
import "./logon/logon.css";
import "./account-settings/account-settings.css";
import "./collections/collections.css";
import "./catalog-filter/catalog-filter.css";
import "./media-library/media-library.css";
import "./program-guide/program-guide.css";
import "./channel-observation/channel-observation.css";
import "./tv/tv.css";

createRoot(document.getElementById("root")!).render(<App />);
