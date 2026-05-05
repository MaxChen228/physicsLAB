"use strict";

/* =========================================================
   Minkowski 時空圖共用繪圖庫
   ─ 世界座標 (x, ct) → 螢幕座標
   ─ 提供軸 / 光錐 / 雙曲線 / 世界線 / 事件 / 文字
   ========================================================= */

const COLORS = {
  S: "#6cf",
  Sp: "#f6a",
  Spp: "#9c8",
  light: "#ffd24a",
  inv: "rgba(85,238,119,0.45)",
  grid: "#1a2236",
  text: "#e6ecff",
  muted: "#8a96b8",
};

function gammaOf(b) { return 1 / Math.sqrt(1 - b * b); }
function lorentz(x, ct, b) { const g = gammaOf(b); return [g * (x - b * ct), g * (ct - b * x)]; }
function lorentzInv(xp, ctp, b) { const g = gammaOf(b); return [g * (xp + b * ctp), g * (ctp + b * xp)]; }
function velocityAdd(u, v) { return (u + v) / (1 + u * v); }

class MinkowskiCanvas {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.zoom = opts.zoom || 60;
    this.originX = opts.originX || 0;
    this.originCT = opts.originCT || 0;
    /* viewBeta：把所有世界點先 Lorentz boost 再投影 → 畫面就是 viewBeta 慣性系視角 */
    this.viewBeta = 0;
    this._resize();
    this._ro = new ResizeObserver(() => {
      this._resize();
      if (this.onResize) this.onResize();
    });
    this._ro.observe(canvas);
  }

  _resize() {
    const r = this.canvas.getBoundingClientRect();
    this.W = Math.max(1, Math.floor(r.width));
    this.H = Math.max(1, Math.floor(r.height));
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = this.W * dpr;
    this.canvas.height = this.H * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.cx = this.W / 2 - this.originX * this.zoom;
    this.cy = this.H / 2 + this.originCT * this.zoom;
  }

  setOrigin(x, ct) { this.originX = x; this.originCT = ct; this._resize(); }
  setZoom(z) { this.zoom = z; this._resize(); }

  P(x, ct) {
    let X = x, CT = ct;
    const vb = this.viewBeta;
    if (Math.abs(vb) > 1e-7) {
      const g = 1 / Math.sqrt(1 - vb * vb);
      X = g * (x - vb * ct);
      CT = g * (ct - vb * x);
    }
    return [this.cx + this.zoom * X, this.cy - this.zoom * CT];
  }
  invP(px, py) { return [(px - this.cx) / this.zoom, (this.cy - py) / this.zoom]; }

  clear(bg) {
    if (bg) { this.ctx.fillStyle = bg; this.ctx.fillRect(0, 0, this.W, this.H); }
    else this.ctx.clearRect(0, 0, this.W, this.H);
  }

  grid(color = COLORS.grid) {
    const ctx = this.ctx;
    ctx.strokeStyle = color; ctx.lineWidth = 1;
    /* 用固定世界範圍：boost 後仍可覆蓋畫面，且兩端點正確 boost 後連線即新慣性系下的 S 格線 */
    const range = 18;
    for (let i = -range; i <= range; i++) {
      const [a1, b1] = this.P(i, -range);
      const [a2, b2] = this.P(i, range);
      ctx.beginPath(); ctx.moveTo(a1, b1); ctx.lineTo(a2, b2); ctx.stroke();
    }
    for (let j = -range; j <= range; j++) {
      const [a1, b1] = this.P(-range, j);
      const [a2, b2] = this.P(range, j);
      ctx.beginPath(); ctx.moveTo(a1, b1); ctx.lineTo(a2, b2); ctx.stroke();
    }
  }

  /* 光錐 (從 origin 點向外，±45°) */
  lightCone(origin = [0, 0], color = COLORS.light, opts = {}) {
    const ctx = this.ctx;
    const reach = 100;
    const [x0, ct0] = origin;
    ctx.strokeStyle = color;
    ctx.lineWidth = opts.lineWidth || 1.4;
    ctx.setLineDash(opts.dash || [5, 4]);
    for (const slope of [1, -1]) {
      const [a, b] = this.P(x0 - reach, ct0 - reach * slope);
      const [c, d] = this.P(x0 + reach, ct0 + reach * slope);
      ctx.beginPath(); ctx.moveTo(a, b); ctx.lineTo(c, d); ctx.stroke();
    }
    ctx.setLineDash([]);
    if (opts.fill) {
      ctx.fillStyle = opts.fill;
      ctx.beginPath();
      const [ox, oy] = this.P(x0, ct0);
      const [a1, b1] = this.P(x0 - reach, ct0 + reach);
      const [a2, b2] = this.P(x0 + reach, ct0 + reach);
      ctx.moveTo(ox, oy); ctx.lineTo(a1, b1); ctx.lineTo(a2, b2); ctx.closePath(); ctx.fill();
      ctx.beginPath();
      const [c1, d1] = this.P(x0 - reach, ct0 - reach);
      const [c2, d2] = this.P(x0 + reach, ct0 - reach);
      ctx.moveTo(ox, oy); ctx.lineTo(c1, d1); ctx.lineTo(c2, d2); ctx.closePath(); ctx.fill();
    }
  }

  /* 軸：從 origin 沿 dir = (dx, dct) 雙向延伸；若 ticks=true，每 tickStep 個世界單位畫一刻度 */
  axis(origin, dir, opts = {}) {
    const {
      color = COLORS.S, lineWidth = 1.5, label, labelOffset = [6, -6],
      ticks = true, tickStep = 1, tickRange = 8, dashed = false, tickColor,
      tickFormat,
    } = opts;
    const ctx = this.ctx;
    const reach = 200;
    const [x0, ct0] = origin;
    const [dx, dct] = dir;
    const [ax, ay] = this.P(x0 - reach * dx, ct0 - reach * dct);
    const [bx, by] = this.P(x0 + reach * dx, ct0 + reach * dct);
    ctx.strokeStyle = color; ctx.lineWidth = lineWidth;
    if (dashed) ctx.setLineDash([5, 4]);
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    ctx.setLineDash([]);

    if (label) {
      const [tipX, tipY] = this.P(x0 + 4 * dx, ct0 + 4 * dct);
      if (tipX > 8 && tipX < this.W - 8 && tipY > 8 && tipY < this.H - 8) {
        ctx.fillStyle = color;
        ctx.font = "italic 13px Georgia, serif";
        ctx.fillText(label, tipX + labelOffset[0], tipY + labelOffset[1]);
      }
    }

    if (ticks && !dashed) {
      /* 用螢幕座標推垂直方向：boost 後仍正確 */
      const [p0x, p0y] = this.P(x0, ct0);
      const [p1x, p1y] = this.P(x0 + dx, ct0 + dct);
      const sdx = p1x - p0x, sdy = p1y - p0y;
      const sm = Math.hypot(sdx, sdy);
      if (sm > 0.01) {
        const snx = -sdy / sm, sny = sdx / sm;
        ctx.strokeStyle = tickColor || color; ctx.lineWidth = 1;
        ctx.fillStyle = tickColor || color;
        ctx.font = "9px 'SF Mono', Menlo, monospace";
        for (let n = -tickRange; n <= tickRange; n += tickStep) {
          if (Math.abs(n) < 1e-6) continue;
          const [tx, ty] = this.P(x0 + n * dx, ct0 + n * dct);
          if (tx < 0 || tx > this.W || ty < 0 || ty > this.H) continue;
          const len = 4;
          ctx.beginPath();
          ctx.moveTo(tx + snx * len, ty + sny * len);
          ctx.lineTo(tx - snx * len, ty - sny * len);
          ctx.stroke();
          if (tickFormat) {
            ctx.fillText(tickFormat(n), tx + snx * 8, ty + sny * 8);
          }
        }
      }
    }
  }

  /* S 軸（標準直角座標） */
  sAxes(opts = {}) {
    this.axis([0, 0], [1, 0], { color: COLORS.S, label: "x", ...opts });
    this.axis([0, 0], [0, 1], { color: COLORS.S, label: "ct", ...opts });
  }

  /* S' 軸：x' 單位向量在 S 中 = (γ, γβ)；ct' 單位向量 = (γβ, γ) */
  primeAxes(beta, opts = {}) {
    const g = gammaOf(beta);
    this.axis([0, 0], [g, g * beta], { color: COLORS.Sp, label: "x′", lineWidth: 1.8, ...opts });
    this.axis([0, 0], [g * beta, g], { color: COLORS.Sp, label: "ct′", lineWidth: 1.8, ...opts });
  }

  /* 不變雙曲線 ct² − x² = ±k² */
  hyperbolas(ks = [1, 2, 3, 4], color = COLORS.inv) {
    const ctx = this.ctx;
    ctx.strokeStyle = color; ctx.lineWidth = 1;
    for (const k of ks) {
      this._curve(x => Math.sqrt(x * x + k * k), -10, 10);
      this._curve(x => -Math.sqrt(x * x + k * k), -10, 10);
      this._curveCT(c => Math.sqrt(c * c + k * k), -10, 10);
      this._curveCT(c => -Math.sqrt(c * c + k * k), -10, 10);
    }
  }
  _curve(f, xa, xb) {
    const ctx = this.ctx;
    ctx.beginPath();
    const N = 240;
    for (let i = 0; i <= N; i++) {
      const x = xa + (xb - xa) * i / N;
      const [px, py] = this.P(x, f(x));
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }
  _curveCT(f, ca, cb) {
    const ctx = this.ctx;
    ctx.beginPath();
    const N = 240;
    for (let i = 0; i <= N; i++) {
      const ct = ca + (cb - ca) * i / N;
      const [px, py] = this.P(f(ct), ct);
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }

  /* 經過 point、速度 beta 的等速世界線 (x = x₀ + β(ct − ct₀)) */
  worldline(point, beta, opts = {}) {
    const { color = COLORS.text, lineWidth = 2, dash } = opts;
    const ctx = this.ctx;
    const [x0, ct0] = point;
    const reach = 200;
    const [ax, ay] = this.P(x0 - reach * beta, ct0 - reach);
    const [bx, by] = this.P(x0 + reach * beta, ct0 + reach);
    ctx.strokeStyle = color; ctx.lineWidth = lineWidth;
    if (dash) ctx.setLineDash(dash);
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    ctx.setLineDash([]);
  }

  /* 從 P1 到 P2 的世界線段（不延伸） */
  segment(p1, p2, color, opts = {}) {
    const { lineWidth = 2, dash, cap = "butt" } = opts;
    const ctx = this.ctx;
    const [a, b] = this.P(p1[0], p1[1]);
    const [c, d] = this.P(p2[0], p2[1]);
    ctx.strokeStyle = color; ctx.lineWidth = lineWidth; ctx.lineCap = cap;
    if (dash) ctx.setLineDash(dash);
    ctx.beginPath(); ctx.moveTo(a, b); ctx.lineTo(c, d); ctx.stroke();
    ctx.setLineDash([]); ctx.lineCap = "butt";
  }

  event(x, ct, opts = {}) {
    const { color = "#fff", radius = 5, label, labelColor, labelOffset = [9, -9], stroke = "#000" } = opts;
    const [px, py] = this.P(x, ct);
    const ctx = this.ctx;
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(px, py, radius, 0, Math.PI * 2); ctx.fill();
    if (stroke) {
      ctx.strokeStyle = stroke; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(px, py, radius, 0, Math.PI * 2); ctx.stroke();
    }
    if (label) {
      ctx.fillStyle = labelColor || color;
      ctx.font = "12px -apple-system, sans-serif";
      ctx.fillText(label, px + labelOffset[0], py + labelOffset[1]);
    }
  }

  text(x, ct, str, opts = {}) {
    const {
      color = COLORS.text, font = "12px -apple-system, sans-serif",
      dx = 0, dy = 0, align = "left", baseline = "alphabetic",
    } = opts;
    const [px, py] = this.P(x, ct);
    const ctx = this.ctx;
    ctx.fillStyle = color; ctx.font = font;
    ctx.textAlign = align; ctx.textBaseline = baseline;
    ctx.fillText(str, px + dx, py + dy);
    ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
  }

  /* 螢幕像素文字（不依世界座標） */
  screenText(px, py, str, opts = {}) {
    const { color = COLORS.text, font = "12px -apple-system, sans-serif", align = "left", baseline = "alphabetic" } = opts;
    const ctx = this.ctx;
    ctx.fillStyle = color; ctx.font = font;
    ctx.textAlign = align; ctx.textBaseline = baseline;
    ctx.fillText(str, px, py);
    ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
  }

  /* S 系同時切片：水平半透明帶，標示 ct = const */
  simulSlice(ct0, color, opts = {}) {
    const { range = [-100, 100], lineWidth = 1.5, dash = [3, 3] } = opts;
    const ctx = this.ctx;
    const [a, b] = this.P(range[0], ct0);
    const [c, d] = this.P(range[1], ct0);
    ctx.strokeStyle = color; ctx.lineWidth = lineWidth;
    if (dash) ctx.setLineDash(dash);
    ctx.beginPath(); ctx.moveTo(a, b); ctx.lineTo(c, d); ctx.stroke();
    ctx.setLineDash([]);
  }

  /* S' 系同時切片：穿過 (x0', ct0') 沿 x' 方向（在 S 中為 (γ, γβ) 方向） */
  primeSimulSlice(beta, ctp0, color, opts = {}) {
    const { range = [-100, 100], lineWidth = 1.5, dash = [3, 3] } = opts;
    const g = gammaOf(beta);
    const ctx = this.ctx;
    // ct' = ctp0 line: 取兩點 (xp=range[0], ctp=ctp0) 與 (xp=range[1], ctp=ctp0)，反 Lorentz 得 S 座標
    const [a1, b1] = lorentzInv(range[0], ctp0, beta);
    const [a2, b2] = lorentzInv(range[1], ctp0, beta);
    const [px1, py1] = this.P(a1, b1);
    const [px2, py2] = this.P(a2, b2);
    ctx.strokeStyle = color; ctx.lineWidth = lineWidth;
    if (dash) ctx.setLineDash(dash);
    ctx.beginPath(); ctx.moveTo(px1, py1); ctx.lineTo(px2, py2); ctx.stroke();
    ctx.setLineDash([]);
  }
}

/* =========================================================
   BoostAnimator：把 mk.viewBeta 沿雙曲角等速插值到目標 β
   ─ animateTo(β)：從目前 viewBeta 平滑切換至 β
   ─ toggle(β)：在 0 ↔ β 間來回，回傳目前是否在 β 端
   ========================================================= */
class BoostAnimator {
  constructor(mk, renderFn, opts = {}) {
    this.mk = mk;
    this.render = renderFn;
    this.duration = opts.duration || 1400;
    this.atTarget = false;
    this._raf = null;
  }

  animateTo(targetBeta) {
    if (this._raf) cancelAnimationFrame(this._raf);
    const clamp = b => Math.max(-0.99999, Math.min(0.99999, b));
    const startBeta = clamp(this.mk.viewBeta);
    const endBeta = clamp(targetBeta);
    const startPhi = Math.atanh(startBeta);
    const endPhi = Math.atanh(endBeta);
    if (Math.abs(endPhi - startPhi) < 1e-5) {
      this.mk.viewBeta = endBeta;
      this.render();
      return;
    }
    const t0 = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - t0) / this.duration);
      const eased = 0.5 - 0.5 * Math.cos(t * Math.PI);
      const phi = startPhi + (endPhi - startPhi) * eased;
      this.mk.viewBeta = Math.tanh(phi);
      this.render();
      if (t < 1) this._raf = requestAnimationFrame(step);
      else this._raf = null;
    };
    this._raf = requestAnimationFrame(step);
  }

  toggle(targetBeta) {
    this.atTarget = !this.atTarget;
    this.animateTo(this.atTarget ? targetBeta : 0);
    return this.atTarget;
  }

  /* 不動畫，直接同步 viewBeta（slider 即時改變時用） */
  sync(targetBeta) {
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
    this.mk.viewBeta = this.atTarget ? targetBeta : 0;
  }
}

window.MinkowskiCanvas = MinkowskiCanvas;
window.BoostAnimator = BoostAnimator;
window.COLORS = COLORS;
window.gammaOf = gammaOf;
window.lorentz = lorentz;
window.lorentzInv = lorentzInv;
window.velocityAdd = velocityAdd;
