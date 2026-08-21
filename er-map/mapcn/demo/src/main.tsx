import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";

// No StrictMode: mapcn's layer effects add the source and the layers in separate effects,
// and the double-mount cycle can leave the layers behind. Not our bug, but it hides the map.
createRoot(document.getElementById("root")!).render(<App />);
