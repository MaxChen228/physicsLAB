import "./styles.css";
import { subscribe } from "./state";
import { jonesToStokes, poincareXYZ } from "./physics/stokes";
import { azimuth, ellipticity } from "./physics/jones";
import { mountWave3d } from "./views/wave3d";
import { mountPoincare } from "./views/poincare";
import { mountEllipse2d } from "./views/ellipse2d";
import { mountNumeric } from "./views/numeric";
import { mountControls } from "./ui/controls";

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing`);
  return el as T;
};

mountWave3d($("view-wave"));
mountPoincare($("view-poincare"));
mountEllipse2d($("view-ellipse"));
mountNumeric($("view-numeric"));
mountControls($("controls"), $("stage"));

const deg = (r: number) => ((r * 180) / Math.PI).toFixed(1);
const ro = {
  wave: $("ro-wave"),
  poincare: $("ro-poincare"),
  ellipse: $("ro-ellipse"),
  numeric: $("ro-numeric"),
};

subscribe((s) => {
  const j = { Ex: s.Ex, Ey: s.Ey, delta: s.delta };
  const st = jonesToStokes(j);
  const [x, y, z] = poincareXYZ(st);
  ro.wave.textContent = `${deg(s.delta)}°`;
  ro.poincare.textContent = `${x.toFixed(2)} ${y.toFixed(2)} ${z.toFixed(2)}`;
  ro.ellipse.textContent = `${deg(ellipticity(j))}°`;
  ro.numeric.textContent = `${deg(azimuth(j))}°`;
});
