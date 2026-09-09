import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { initGoogleAdsTag } from "./lib/analytics";

initGoogleAdsTag();

createRoot(document.getElementById("root")!).render(<App />);
