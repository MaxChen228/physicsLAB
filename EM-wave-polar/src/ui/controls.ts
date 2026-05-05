import { getState, setState, subscribe } from "../state";
import { presets } from "../physics/presets";

const PRESET_ORDER = ["H", "V", "D", "A", "RCP", "LCP"] as const;
const PRESET_LABEL: Record<string, string> = {
  H: "H",
  V: "V",
  D: "+45°",
  A: "−45°",
  RCP: "RCP",
  LCP: "LCP",
};

const fmt = (x: number, d = 3) => x.toFixed(d);
const deg = (rad: number) => ((rad * 180) / Math.PI).toFixed(1);

function triggerAnaglyph(host: HTMLElement): void {
  host.classList.remove("anaglyph-pulse");
  void host.offsetWidth;
  host.classList.add("anaglyph-pulse");
}

export function mountControls(root: HTMLElement, stage: HTMLElement): void {
  root.innerHTML = `
    <div class="ctrl-row">
      <label class="ctrl">
        <span class="ctrl-key">Ex</span>
        <input type="range" min="0" max="1" step="0.001" data-k="Ex" />
        <span class="ctrl-val mono" data-v="Ex"></span>
        <button class="ctrl-reset" data-r="Ex" title="reset">↺</button>
      </label>
      <label class="ctrl">
        <span class="ctrl-key">Ey</span>
        <input type="range" min="0" max="1" step="0.001" data-k="Ey" />
        <span class="ctrl-val mono" data-v="Ey"></span>
        <button class="ctrl-reset" data-r="Ey" title="reset">↺</button>
      </label>
      <label class="ctrl ctrl--delta">
        <span class="ctrl-key">δ</span>
        <input type="range" min="-3.14159" max="3.14159" step="0.001" data-k="delta" />
        <span class="ctrl-val mono" data-v="delta"></span>
        <button class="ctrl-reset" data-r="delta" title="reset">↺</button>
      </label>
    </div>
    <div class="ctrl-row ctrl-row--presets">
      <span class="ctrl-section">presets</span>
      ${PRESET_ORDER.map(
        (k) => `<button class="preset" data-p="${k}">${PRESET_LABEL[k]}</button>`,
      ).join("")}
      <span class="ctrl-spacer"></span>
      <button class="ctrl-pause" data-pause>⏸</button>
      <label class="ctrl ctrl--speed">
        <span class="ctrl-key">speed</span>
        <input type="range" min="0" max="1" step="0.01" data-k="timeScale" />
      </label>
    </div>
  `;

  const sync = () => {
    const s = getState();
    const set = (k: string, v: number) => {
      const i = root.querySelector<HTMLInputElement>(`input[data-k="${k}"]`);
      if (i && document.activeElement !== i) i.value = String(v);
      const o = root.querySelector<HTMLElement>(`[data-v="${k}"]`);
      if (o) o.textContent = k === "delta" ? `${deg(v)}°` : fmt(v);
    };
    set("Ex", s.Ex);
    set("Ey", s.Ey);
    set("delta", s.delta);
    const sp = root.querySelector<HTMLInputElement>(`input[data-k="timeScale"]`);
    if (sp) sp.value = String(s.timeScale);
    const pb = root.querySelector<HTMLButtonElement>(`[data-pause]`);
    if (pb) pb.textContent = s.paused ? "▶" : "⏸";
  };
  subscribe(sync);

  root.addEventListener("input", (e) => {
    const t = e.target as HTMLInputElement;
    const k = t.dataset.k;
    if (!k) return;
    setState({ [k]: parseFloat(t.value) } as never);
  });

  root.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    const p = t.dataset.p;
    if (p && presets[p]) {
      setState(presets[p]);
      triggerAnaglyph(stage);
      return;
    }
    const r = t.dataset.r;
    if (r) {
      const def: Record<string, number> = { Ex: 1, Ey: 1, delta: Math.PI / 2 };
      setState({ [r]: def[r] } as never);
      return;
    }
    if (t.hasAttribute("data-pause")) {
      setState({ paused: !getState().paused });
    }
  });
}
