import { getState, subscribe } from "../state";
import { azimuth, ellipticity, fieldAt } from "../physics/jones";

const css = (name: string): string =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export function mountEllipse2d(host: HTMLElement): void {
  const canvas = document.createElement("canvas");
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  host.appendChild(canvas);
  const ctx = canvas.getContext("2d")!;

  let dpr = window.devicePixelRatio || 1;
  let w = 0;
  let h = 0;

  const resize = () => {
    dpr = window.devicePixelRatio || 1;
    const r = host.getBoundingClientRect();
    w = Math.max(1, Math.floor(r.width));
    h = Math.max(1, Math.floor(r.height));
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  new ResizeObserver(resize).observe(host);
  resize();

  let dirty = true;
  subscribe(() => {
    dirty = true;
  });

  let t0 = performance.now();
  let phase = 0;

  const draw = () => {
    const s = getState();
    const now = performance.now();
    const dt = (now - t0) / 1000;
    t0 = now;
    if (!s.paused) phase += dt * s.timeScale * 2 * Math.PI * 0.5;

    const ch_x = css("--ch-x") || "#ff2d55";
    const ch_y = css("--ch-y") || "#00ff9c";
    const sum = css("--ch-sum") || "#d8dde2";
    const dim = css("--paper-dim") || "#6a7480";
    const sig = css("--signal") || "#00e5ff";
    const hl = css("--hairline-2") || "rgba(216,221,226,0.22)";

    ctx.clearRect(0, 0, w, h);

    const cx = w / 2;
    const cy = h / 2;
    const R = Math.min(w, h) * 0.36;

    // Frame ticks (CAD-style ruler)
    ctx.strokeStyle = hl;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = -5; i <= 5; i++) {
      const x = cx + (i / 5) * R;
      ctx.moveTo(x, cy - 4);
      ctx.lineTo(x, cy + 4);
      const y = cy + (i / 5) * R;
      ctx.moveTo(cx - 4, y);
      ctx.lineTo(cx + 4, y);
    }
    ctx.stroke();

    // Axes (x red, y green) - thin
    ctx.lineWidth = 1;
    ctx.strokeStyle = ch_x + "a0";
    ctx.beginPath();
    ctx.moveTo(cx - R - 12, cy);
    ctx.lineTo(cx + R + 12, cy);
    ctx.stroke();
    ctx.strokeStyle = ch_y + "a0";
    ctx.beginPath();
    ctx.moveTo(cx, cy - R - 12);
    ctx.lineTo(cx, cy + R + 12);
    ctx.stroke();

    // Axis labels (mono, dim)
    ctx.fillStyle = dim;
    ctx.font = "10px 'JetBrains Mono', monospace";
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.fillText("EX", cx + R + 14, cy);
    ctx.textAlign = "center";
    ctx.fillText("EY", cx, cy - R - 18);

    // Ellipse trace (parametric over t∈[0,2π])
    const N = 240;
    ctx.strokeStyle = sum;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i <= N; i++) {
      const t = (i / N) * 2 * Math.PI;
      const f = fieldAt({ Ex: s.Ex, Ey: s.Ey, delta: s.delta }, t);
      const x = cx + f.ex * R;
      const y = cy - f.ey * R;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Major / minor axes line + azimuth
    const j = { Ex: s.Ex, Ey: s.Ey, delta: s.delta };
    const psi = azimuth(j);
    const chi = ellipticity(j);
    const a = Math.sqrt(j.Ex * j.Ex + j.Ey * j.Ey);
    const aMaj = a * Math.cos(chi);
    const aMin = a * Math.abs(Math.sin(chi));

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-psi);
    ctx.strokeStyle = sig;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(-aMaj * R - 6, 0);
    ctx.lineTo(aMaj * R + 6, 0);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = dim;
    ctx.beginPath();
    ctx.moveTo(0, -aMin * R);
    ctx.lineTo(0, aMin * R);
    ctx.stroke();
    ctx.restore();

    // Live tip (current E(t))
    const f = fieldAt(j, phase);
    const tipX = cx + f.ex * R;
    const tipY = cy - f.ey * R;

    // Glow
    ctx.fillStyle = sig;
    ctx.shadowColor = sig;
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.arc(tipX, tipY, 3.5, 0, 2 * Math.PI);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Crosshair guides from tip down to axes
    ctx.strokeStyle = sig + "70";
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(tipX, cy);
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(cx, tipY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Rotation sense arrow — short tangent at tip
    const tangentX = -j.Ex * Math.sin(phase);
    const tangentY = j.Ey * Math.sin(phase + s.delta);
    const tlen = Math.hypot(tangentX, tangentY) || 1;
    const ux = tangentX / tlen;
    const uy = -tangentY / tlen;
    const ah = 8;
    ctx.strokeStyle = sig;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(tipX + ux * 2, tipY + uy * 2);
    ctx.lineTo(tipX + ux * (ah + 2), tipY + uy * (ah + 2));
    ctx.stroke();

    // Corner readouts
    ctx.fillStyle = dim;
    ctx.font = "9px 'JetBrains Mono', monospace";
    ctx.textAlign = "left";
    ctx.fillText(
      `ψ ${((psi * 180) / Math.PI).toFixed(1).padStart(6)}°`,
      14,
      h - 22,
    );
    ctx.fillText(
      `χ ${((chi * 180) / Math.PI).toFixed(1).padStart(6)}°`,
      14,
      h - 10,
    );

    dirty = false;
    requestAnimationFrame(draw);
  };
  void dirty;
  requestAnimationFrame(draw);
}
