import { useEffect, useState } from "react";
import "maplibre-gl/dist/maplibre-gl.css";

import {
  LumiaMap, LumiaAreaLayer, LUMIA_AREAS, LUMIA_KIOSKS, type LumiaArea,
} from "@/registry/lumia-map";

/**
 * The board is the map and nothing else — a voice agent drives it, so there are no
 * on-screen controls. Everything it needs hangs off `window.lumia`.
 */
type Bridge = {
  areas: LumiaArea[];
  kiosks: typeof LUMIA_KIOSKS;
  state: { sighting: string; elapsed: number; speed: number; restricted: string[] };
  sight: (key: string) => void;
  elapse: (seconds: number) => void;
  speedTo: (multiplier: number) => void;
  restrict: (key: string) => void;
  allow: (key: string) => void;
  reset: () => void;
};
declare global {
  interface Window { lumia: Bridge }
}

export default function App() {
  const q = new URLSearchParams(location.search);
  const [sighting, setSighting] = useState(q.get("from") ?? "Pond");
  const [elapsed, setElapsed] = useState(Number(q.get("t") ?? 0));
  const [speed, setSpeed] = useState(Number(q.get("speed") ?? 1));
  const [restricted, setRestricted] = useState(
    (q.get("ban") ?? "").split(",").filter(Boolean),
  );
  const plain = q.has("plain");

  useEffect(() => {
    window.lumia = {
      areas: LUMIA_AREAS,
      kiosks: LUMIA_KIOSKS,
      state: { sighting, elapsed, speed, restricted },
      sight: setSighting,
      elapse: setElapsed,
      speedTo: setSpeed,
      restrict: (key) => setRestricted((prev) => prev.includes(key) ? prev : [...prev, key]),
      allow: (key) => setRestricted((prev) => prev.filter((k) => k !== key)),
      reset: () => { setElapsed(0); setRestricted([]); },
    };
  }, [sighting, elapsed, speed, restricted]);

  return (
    <LumiaMap theme="dark" className="h-dvh w-dvw">
      <LumiaAreaLayer
        sighting={sighting}
        elapsedSeconds={elapsed}
        speedMultiplier={speed}
        restricted={restricted}
        basemap={plain ? undefined : "./lumia-minimap.png"}
        backdropTexture="./map-backdrop.png"
        onAreaClick={(area) => setSighting(area.key)}
      />
    </LumiaMap>
  );
}
