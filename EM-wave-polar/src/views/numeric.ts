import { subscribe } from "../state";
import { jonesToStokes, dop } from "../physics/stokes";
import { azimuth, ellipticity } from "../physics/jones";

const fmt = (x: number, d = 3): string => x.toFixed(d);
const deg = (rad: number): string => ((rad * 180) / Math.PI).toFixed(2);

function classify(chi: number): string {
  const c = (chi * 180) / Math.PI;
  if (Math.abs(c) < 1) return "linear";
  if (Math.abs(Math.abs(c) - 45) < 1) return c > 0 ? "circular (LCP)" : "circular (RCP)";
  return c > 0 ? "elliptical (L)" : "elliptical (R)";
}

export function mountNumeric(root: HTMLElement): void {
  subscribe((s) => {
    const j = { Ex: s.Ex, Ey: s.Ey, delta: s.delta };
    const st = jonesToStokes(j);
    const psi = azimuth(j);
    const chi = ellipticity(j);
    root.innerHTML = `
      <div class="num-block">
        <span class="num-label">JONES</span>
        <span class="num-val">[ ${fmt(j.Ex)} ]   [ ${fmt(j.Ey)} ∠ ${deg(j.delta)}° ]</span>
      </div>
      <div class="num-block">
        <span class="num-label">STOKES</span>
        <span class="num-val">S₀ ${fmt(st.S0)}   S₁ ${fmt(st.S1)}   S₂ ${fmt(st.S2)}   S₃ ${fmt(st.S3)}</span>
      </div>
      <div class="num-block">
        <span class="num-label">PSI · AZIMUTH</span>
        <span class="num-val">${deg(psi)}°</span>
      </div>
      <div class="num-block">
        <span class="num-label">CHI · ELLIPTICITY</span>
        <span class="num-val">${deg(chi)}°</span>
      </div>
      <div class="num-block">
        <span class="num-label">DOP</span>
        <span class="num-val">${fmt(dop(st))}</span>
      </div>
      <div class="num-block num-block--tag">
        <span class="num-label">CLASS</span>
        <span class="num-val num-val--accent">${classify(chi)}</span>
      </div>
    `;
  });
}
