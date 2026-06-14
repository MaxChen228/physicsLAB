import "./styles.css";
import "katex/dist/katex.min.css";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { all, create, type EvalFunction } from "mathjs";
import katex from "katex";

type ComplexSample = { re: number; im: number };
type DisplayMode = "wave" | "density";
type Preset = { id: string; name: string; latex: string };
type Picker = {
  button: HTMLButtonElement;
  menu: HTMLDivElement;
  presets: Preset[];
  selectedId: string;
  onSelect: (preset: Preset) => void;
};

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing required UI element: ${selector}`);
  return element;
}

const canvas = requireElement<HTMLCanvasElement>("#scene");
const modeWave = requireElement<HTMLButtonElement>("#mode-wave");
const modeDensity = requireElement<HTMLButtonElement>("#mode-density");
const timeInput = requireElement<HTMLInputElement>("#time");
const massInput = requireElement<HTMLInputElement>("#mass");
const domainInput = requireElement<HTMLInputElement>("#domain");
const timeOutput = requireElement<HTMLOutputElement>("#time-output");
const massOutput = requireElement<HTMLOutputElement>("#mass-output");
const domainOutput = requireElement<HTMLOutputElement>("#domain-output");
const animateInput = requireElement<HTMLInputElement>("#animate");
const phaseInput = requireElement<HTMLInputElement>("#phase");
const initialWaveInput = requireElement<HTMLInputElement>("#initial-wave");
const potentialVisibleInput = requireElement<HTMLInputElement>("#potential-visible");
const initialWaveLabel = requireElement<HTMLSpanElement>("#initial-wave-label");
const initialExpressionInput = requireElement<HTMLTextAreaElement>("#initial-expression");
const potentialExpressionInput = requireElement<HTMLTextAreaElement>("#potential-expression");
const initialPreview = requireElement<HTMLDivElement>("#initial-preview");
const potentialPreview = requireElement<HTMLDivElement>("#potential-preview");
const status = requireElement<HTMLParagraphElement>("#status");
const applyButton = requireElement<HTMLButtonElement>("#apply");
const axisXLabel = requireElement<HTMLDivElement>("#axis-x");
const axisReLabel = requireElement<HTMLDivElement>("#axis-re");
const axisImLabel = requireElement<HTMLDivElement>("#axis-im");

const math = create(all, {});
const gridSize = 256;
const curveStride = 1;
const displayCeiling = 0.68;
const potentialFloor = -0.58;
const evolutionSteps = 180;

const initialPresets: Preset[] = [
  { id: "moving-gaussian", name: "moving Gaussian", latex: "e^{-0.7x^2}e^{4ix}" },
  { id: "still-gaussian", name: "still Gaussian", latex: "e^{-0.7x^2}" },
  { id: "left-packet", name: "left packet", latex: "e^{-1.2(x+3)^2}e^{5ix}" },
  { id: "double-packet", name: "double packet", latex: "e^{-1.4(x+2.2)^2}+e^{-1.4(x-2.2)^2}" },
  { id: "chirped", name: "chirped packet", latex: "e^{-0.55x^2}e^{0.35ix^2}" },
];

const potentialPresets: Preset[] = [
  { id: "free", name: "free particle", latex: "0" },
  { id: "harmonic", name: "simple harmonic", latex: "0.08x^2" },
  { id: "barrier", name: "Gaussian barrier", latex: "2.4e^{-1.2x^2}" },
  { id: "double-well", name: "double well", latex: "0.025(x^2-9)^2" },
  { id: "well", name: "finite well", latex: "-2.2H(2.2-|x|)" },
  { id: "step", name: "step", latex: "1.2H(x)" },
  { id: "linear", name: "linear field", latex: "0.22x" },
];

let initialPicker: Picker;
let potentialPicker: Picker;
let mode: DisplayMode = "wave";
let time = 0;
let mass = 1;
let domain = 8;
let dx = (2 * domain) / gridSize;
let xGrid = Array.from({ length: gridSize }, (_, index) => -domain + index * dx);
let initialPsi = Array.from({ length: gridSize }, () => ({ re: 0, im: 0 }));
let currentPsi = Array.from({ length: gridSize }, () => ({ re: 0, im: 0 }));
let potentialValues = Array<number>(gridSize).fill(0);
let waveScale = 1;
let densityScale = 1;
let potentialScale = 1;

function renderLatex(element: HTMLElement, latex: string, displayMode = false): void {
  katex.render(latex, element, {
    displayMode,
    throwOnError: false,
    strict: "ignore",
  });
}

document.querySelectorAll<HTMLElement>("[data-latex]").forEach((element) => {
  renderLatex(element, element.dataset.latex ?? "");
});

const scene = new THREE.Scene();
scene.background = new THREE.Color("#fbfaf7");

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;

const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
camera.position.set(2.85, 1.25, 2.55);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(0, 0.02, 0);
controls.minDistance = 2.0;
controls.maxDistance = 6.4;
controls.maxPolarAngle = Math.PI * 0.76;

const root = new THREE.Group();
root.position.x = -0.5;
scene.add(root);
scene.add(new THREE.AmbientLight("#ffffff", 1.5));
const light = new THREE.DirectionalLight("#ffffff", 2);
light.position.set(2, 3, 2);
scene.add(light);

const axisMaterial = new THREE.LineBasicMaterial({ color: "#111111" });
const gridMaterial = new THREE.LineBasicMaterial({ color: "#d7d7d7", transparent: true, opacity: 0.65 });
const waveMaterial = new THREE.LineBasicMaterial({ color: "#111111", linewidth: 3 });
const realMaterial = new THREE.LineBasicMaterial({ color: "#315f9f", linewidth: 2 });
const imagMaterial = new THREE.LineBasicMaterial({ color: "#a43f38", linewidth: 2 });
const densityMaterial = new THREE.LineBasicMaterial({ color: "#111111", linewidth: 3 });
const potentialMaterial = new THREE.LineBasicMaterial({ color: "#666666", transparent: true, opacity: 0.9 });
const initialMaterial = new THREE.LineDashedMaterial({
  color: "#177245",
  dashSize: 0.035,
  gapSize: 0.022,
  linewidth: 2,
});
const ribbonMaterial = new THREE.MeshBasicMaterial({
  color: "#111111",
  transparent: true,
  opacity: 0.08,
  side: THREE.DoubleSide,
});

const waveLine = new THREE.Line(new THREE.BufferGeometry(), waveMaterial);
const realProjection = new THREE.Line(new THREE.BufferGeometry(), realMaterial);
const imagProjection = new THREE.Line(new THREE.BufferGeometry(), imagMaterial);
const densityLine = new THREE.Line(new THREE.BufferGeometry(), densityMaterial);
const initialLine = new THREE.Line(new THREE.BufferGeometry(), initialMaterial);
const potentialLine = new THREE.Line(new THREE.BufferGeometry(), potentialMaterial);
const ribbonMesh = new THREE.Mesh(new THREE.BufferGeometry(), ribbonMaterial);
const densityFill = new THREE.Mesh(new THREE.BufferGeometry(), ribbonMaterial.clone());
(densityFill.material as THREE.MeshBasicMaterial).opacity = 0.11;
root.add(waveLine, realProjection, imagProjection, densityLine, initialLine, potentialLine, ribbonMesh, densityFill);

function makeLine(points: THREE.Vector3[], material: THREE.LineBasicMaterial): THREE.Line {
  return new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), material);
}

function addAxes(): void {
  root.add(makeLine([new THREE.Vector3(0, 0, 0), new THREE.Vector3(1.1, 0, 0)], axisMaterial));
  root.add(makeLine([new THREE.Vector3(0, -0.72, 0), new THREE.Vector3(0, 0.72, 0)], axisMaterial));
  root.add(makeLine([new THREE.Vector3(0, 0, -0.72), new THREE.Vector3(0, 0, 0.72)], axisMaterial));

  for (let i = 0; i <= 12; i += 1) {
    const x = i / 12;
    root.add(makeLine([new THREE.Vector3(x, -0.62, 0), new THREE.Vector3(x, 0.62, 0)], gridMaterial));
    root.add(makeLine([new THREE.Vector3(x, 0, -0.62), new THREE.Vector3(x, 0, 0.62)], gridMaterial));
  }
}

function replaceLatexCommand(source: string, command: string, arity: 1 | 2, rendererFn: (...args: string[]) => string): string {
  let output = source;
  let commandIndex = output.indexOf(command);

  while (commandIndex !== -1) {
    let cursor = commandIndex + command.length;
    const args: string[] = [];
    for (let argIndex = 0; argIndex < arity; argIndex += 1) {
      while (output[cursor] === " ") cursor += 1;
      if (output[cursor] !== "{") throw new Error(`${command} requires braced arguments`);

      let depth = 0;
      let end = cursor;
      for (; end < output.length; end += 1) {
        if (output[end] === "{") depth += 1;
        if (output[end] === "}") depth -= 1;
        if (depth === 0) break;
      }
      if (depth !== 0) throw new Error("unbalanced braces in LaTeX expression");

      args.push(output.slice(cursor + 1, end));
      cursor = end + 1;
    }

    output = output.slice(0, commandIndex) + rendererFn(...args) + output.slice(cursor);
    commandIndex = output.indexOf(command);
  }

  return output;
}

function latexToMathExpression(latex: string): string {
  let expression = latex
    .replace(/\\left/g, "")
    .replace(/\\right/g, "")
    .replace(/\\,/g, "")
    .replace(/\\cdot|\\times/g, "*")
    .replace(/\s+/g, "");

  expression = replaceLatexCommand(expression, "\\frac", 2, (numerator, denominator) => {
    return `((${latexToMathExpression(numerator)})/(${latexToMathExpression(denominator)}))`;
  });
  expression = replaceLatexCommand(expression, "\\sqrt", 1, (radicand) => {
    return `sqrt(${latexToMathExpression(radicand)})`;
  });

  expression = expression
    .replace(/\\sin/g, "sin")
    .replace(/\\cos/g, "cos")
    .replace(/\\tan/g, "tan")
    .replace(/\\exp/g, "exp")
    .replace(/\\pi/g, "pi")
    .replace(/\\mathrm\{e\}/g, "e")
    .replace(/\|x\|/g, "abs(x)")
    .replace(/\{/g, "(")
    .replace(/\}/g, ")")
    .replace(/\^\(([^()]*)\)/g, "^($1)")
    .replace(/e\^\(([^()]*)\)/g, "e^($1)");

  expression = expression
    .replace(/(\d|\)|x|i)\s*(?=\()/g, "$1*")
    .replace(/(\d|\)|x|i)\s*(?=(?:x|pi|e|i)\b)/g, "$1*")
    .replace(/(\d|x|pi|e|i)\s*(?=(?:sin|cos|tan|sqrt|exp|abs|H)\b)/g, "$1*")
    .replace(/(pi|e|i)\s*(?=(?:x|pi|e|i|\())/g, "$1*")
    .replace(/\)\s*(?=(?:\d|x|pi|e|i|sin|cos|tan|sqrt|exp|abs|H)\b|\()/g, ")*");

  return expression;
}

function compileExpression(latex: string): EvalFunction {
  return math.compile(latexToMathExpression(latex));
}

function toComplex(value: unknown): ComplexSample {
  if (typeof value === "number") return { re: value, im: 0 };
  if (value && typeof value === "object" && "re" in value && "im" in value) {
    const complex = value as { re: number; im: number };
    return { re: Number(complex.re), im: Number(complex.im) };
  }

  const numeric = Number(value);
  return { re: numeric, im: 0 };
}

function evaluateComplex(compiled: EvalFunction, x: number): ComplexSample {
  const value = toComplex(compiled.evaluate({ x, pi: Math.PI, e: Math.E, i: math.complex(0, 1), H: (v: number) => (v >= 0 ? 1 : 0) }));
  if (!Number.isFinite(value.re) || !Number.isFinite(value.im)) throw new Error("expression must stay finite");
  return value;
}

function evaluateReal(compiled: EvalFunction, x: number): number {
  const value = evaluateComplex(compiled, x);
  if (Math.abs(value.im) > 1e-9) throw new Error("V(x) must be real-valued");
  return value.re;
}

function rebuildGrid(): void {
  dx = (2 * domain) / gridSize;
  xGrid = Array.from({ length: gridSize }, (_, index) => -domain + index * dx);
}

function normalize(samples: ComplexSample[]): ComplexSample[] {
  const normSquared = samples.reduce((sum, value) => sum + (value.re * value.re + value.im * value.im) * dx, 0);
  if (!Number.isFinite(normSquared) || normSquared <= 1e-12) throw new Error("normalization failed");
  const norm = 1 / Math.sqrt(normSquared);
  renderLatex(status, `\\int |\\Psi(x,0)|^2dx=1`);
  status.classList.remove("error");
  return samples.map((value) => ({ re: value.re * norm, im: value.im * norm }));
}

function computeDisplayScales(): void {
  const maxWave = initialPsi.reduce((max, value) => Math.max(max, Math.hypot(value.re, value.im)), 0);
  const maxDensity = initialPsi.reduce((max, value) => Math.max(max, value.re * value.re + value.im * value.im), 0);
  const potentialAbs = potentialValues.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
  waveScale = maxWave > 0 ? 0.62 / maxWave : 1;
  densityScale = maxDensity > 0 ? displayCeiling / maxDensity : 1;
  potentialScale = potentialAbs > 0 ? 0.28 / potentialAbs : 1;
}

function fft(values: ComplexSample[], inverse = false): ComplexSample[] {
  const output = values.map((value) => ({ ...value }));
  const n = output.length;
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) [output[i], output[j]] = [output[j], output[i]];
  }

  for (let length = 2; length <= n; length <<= 1) {
    const angle = ((inverse ? 2 : -2) * Math.PI) / length;
    const wLength = { re: Math.cos(angle), im: Math.sin(angle) };
    for (let i = 0; i < n; i += length) {
      let w = { re: 1, im: 0 };
      for (let j = 0; j < length / 2; j += 1) {
        const u = output[i + j];
        const vSource = output[i + j + length / 2];
        const v = { re: vSource.re * w.re - vSource.im * w.im, im: vSource.re * w.im + vSource.im * w.re };
        output[i + j] = { re: u.re + v.re, im: u.im + v.im };
        output[i + j + length / 2] = { re: u.re - v.re, im: u.im - v.im };
        w = { re: w.re * wLength.re - w.im * wLength.im, im: w.re * wLength.im + w.im * wLength.re };
      }
    }
  }

  if (inverse) {
    for (const value of output) {
      value.re /= n;
      value.im /= n;
    }
  }

  return output;
}

function applyPhase(value: ComplexSample, phase: number): ComplexSample {
  const c = Math.cos(phase);
  const s = Math.sin(phase);
  return { re: value.re * c - value.im * s, im: value.re * s + value.im * c };
}

function evolveTo(targetTime: number): ComplexSample[] {
  const dt = targetTime / evolutionSteps;
  let state = initialPsi.map((value) => ({ ...value }));
  if (Math.abs(targetTime) < 1e-12) return state;

  for (let step = 0; step < evolutionSteps; step += 1) {
    state = state.map((value, index) => applyPhase(value, -potentialValues[index] * dt * 0.5));
    let spectrum = fft(state);
    spectrum = spectrum.map((value, index) => {
      const frequencyIndex = index <= gridSize / 2 ? index : index - gridSize;
      const k = (Math.PI * frequencyIndex) / domain;
      return applyPhase(value, -(k * k * dt) / (2 * mass));
    });
    state = fft(spectrum, true);
    state = state.map((value, index) => applyPhase(value, -potentialValues[index] * dt * 0.5));
  }

  return state;
}

function xToScene(x: number): number {
  return (x + domain) / (2 * domain);
}

function setLineGeometry(line: THREE.Line, points: THREE.Vector3[]): void {
  line.geometry.dispose();
  line.geometry = new THREE.BufferGeometry().setFromPoints(points);
}

function setRibbonGeometry(mesh: THREE.Mesh, topPoints: THREE.Vector3[], baseMapper: (point: THREE.Vector3) => THREE.Vector3): void {
  const vertices: number[] = [];
  const indices: number[] = [];
  for (const point of topPoints) {
    const base = baseMapper(point);
    vertices.push(base.x, base.y, base.z, point.x, point.y, point.z);
  }
  for (let i = 0; i < topPoints.length - 1; i += 1) {
    const base = i * 2;
    indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
  }
  mesh.geometry.dispose();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  mesh.geometry = geometry;
}

function redraw(): void {
  currentPsi = evolveTo(time);
  const wavePoints: THREE.Vector3[] = [];
  const realPoints: THREE.Vector3[] = [];
  const imagPoints: THREE.Vector3[] = [];
  const densityPoints: THREE.Vector3[] = [];
  const initialPoints: THREE.Vector3[] = [];
  const potentialPoints: THREE.Vector3[] = [];

  for (let index = 0; index < gridSize; index += curveStride) {
    const x = xToScene(xGrid[index]);
    const value = currentPsi[index];
    const initial = initialPsi[index];
    const density = value.re * value.re + value.im * value.im;
    const initialDensity = initial.re * initial.re + initial.im * initial.im;
    wavePoints.push(new THREE.Vector3(x, value.re * waveScale, value.im * waveScale));
    realPoints.push(new THREE.Vector3(x, value.re * waveScale, 0));
    imagPoints.push(new THREE.Vector3(x, 0, value.im * waveScale));
    densityPoints.push(new THREE.Vector3(x, density * densityScale, 0));
    initialPoints.push(
      mode === "density"
        ? new THREE.Vector3(x, initialDensity * densityScale, 0)
        : new THREE.Vector3(x, initial.re * waveScale, initial.im * waveScale),
    );
    potentialPoints.push(new THREE.Vector3(x, potentialFloor + potentialValues[index] * potentialScale, -0.66));
  }

  setLineGeometry(waveLine, wavePoints);
  setLineGeometry(realProjection, realPoints);
  setLineGeometry(imagProjection, imagPoints);
  setLineGeometry(densityLine, densityPoints);
  setLineGeometry(initialLine, initialPoints);
  setLineGeometry(potentialLine, potentialPoints);
  initialLine.computeLineDistances();
  setRibbonGeometry(ribbonMesh, wavePoints, (point) => new THREE.Vector3(point.x, 0, 0));
  setRibbonGeometry(densityFill, densityPoints, (point) => new THREE.Vector3(point.x, 0, 0));

  waveLine.visible = mode === "wave";
  realProjection.visible = mode === "wave" && phaseInput.checked;
  imagProjection.visible = mode === "wave" && phaseInput.checked;
  ribbonMesh.visible = mode === "wave" && phaseInput.checked;
  densityLine.visible = mode === "density";
  densityFill.visible = mode === "density";
  initialLine.visible = initialWaveInput.checked;
  potentialLine.visible = potentialVisibleInput.checked;
  modeWave.classList.toggle("active", mode === "wave");
  modeDensity.classList.toggle("active", mode === "density");
  timeOutput.value = time.toFixed(2);
  massOutput.value = mass.toFixed(2);
  domainOutput.value = domain.toFixed(1);
}

function buildPresetSparkline(latex: string, complex = false): SVGSVGElement {
  const width = 92;
  const height = 34;
  const margin = 3;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "preset-graph");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("aria-hidden", "true");

  try {
    const compiled = compileExpression(latex);
    const samples = Array.from({ length: 72 }, (_, index) => {
      const x = -4 + (8 * index) / 71;
      return complex ? evaluateComplex(compiled, x).re : evaluateReal(compiled, x);
    });
    const maxAbs = samples.reduce((max, value) => Math.max(max, Math.abs(value)), 0) || 1;
    const centerY = height / 2;
    const amplitude = height / 2 - margin;
    const points = samples
      .map((value, index) => {
        const x = margin + (index / (samples.length - 1)) * (width - margin * 2);
        const y = centerY - (value / maxAbs) * amplitude;
        return `${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(" ");

    const axis = document.createElementNS("http://www.w3.org/2000/svg", "line");
    axis.setAttribute("class", "preset-graph-axis");
    axis.setAttribute("x1", `${margin}`);
    axis.setAttribute("x2", `${width - margin}`);
    axis.setAttribute("y1", `${centerY}`);
    axis.setAttribute("y2", `${centerY}`);
    const line = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    line.setAttribute("class", "preset-graph-line");
    line.setAttribute("points", points);
    svg.append(axis, line);
  } catch {
    const axis = document.createElementNS("http://www.w3.org/2000/svg", "line");
    axis.setAttribute("class", "preset-graph-axis");
    axis.setAttribute("x1", `${margin}`);
    axis.setAttribute("x2", `${width - margin}`);
    axis.setAttribute("y1", `${height / 2}`);
    axis.setAttribute("y2", `${height / 2}`);
    svg.append(axis);
  }
  return svg;
}

function setPickerOpen(picker: Picker, open: boolean): void {
  picker.menu.hidden = !open;
  picker.button.setAttribute("aria-expanded", open ? "true" : "false");
}

function renderPicker(picker: Picker, complex = false): void {
  const selected = picker.presets.find((preset) => preset.id === picker.selectedId) ?? picker.presets[0];
  picker.button.replaceChildren();
  const currentText = document.createElement("span");
  currentText.className = "preset-current-text";
  currentText.textContent = selected.name;
  const currentFormula = document.createElement("span");
  currentFormula.className = "preset-current-formula";
  renderLatex(currentFormula, selected.latex);
  picker.button.append(currentText, currentFormula, buildPresetSparkline(selected.latex, complex));

  picker.menu.replaceChildren();
  for (const preset of picker.presets) {
    const option = document.createElement("button");
    option.className = "preset-option";
    option.type = "button";
    option.setAttribute("aria-selected", preset.id === picker.selectedId ? "true" : "false");
    const marker = document.createElement("span");
    marker.className = "preset-marker";
    marker.textContent = preset.id === picker.selectedId ? "✓" : "";
    const body = document.createElement("span");
    body.className = "preset-option-body";
    const name = document.createElement("span");
    name.className = "preset-option-name";
    name.textContent = preset.name;
    const formula = document.createElement("span");
    formula.className = "preset-option-formula";
    renderLatex(formula, preset.latex);
    body.append(name, formula);
    option.append(marker, body, buildPresetSparkline(preset.latex, complex));
    option.addEventListener("click", () => {
      picker.selectedId = preset.id;
      picker.onSelect(preset);
      renderPicker(picker, complex);
      setPickerOpen(picker, false);
      applyInputs();
    });
    picker.menu.append(option);
  }
}

function closePickers(): void {
  setPickerOpen(initialPicker, false);
  setPickerOpen(potentialPicker, false);
}

function renderPreviews(): void {
  renderLatex(initialPreview, `\\Psi(x,0)=N\\left[${initialExpressionInput.value}\\right]`);
  renderLatex(potentialPreview, `V(x)=${potentialExpressionInput.value}`);
}

function updateInitialLabel(): void {
  renderLatex(initialWaveLabel, mode === "density" ? "|\\Psi(x,0)|^2" : "\\Psi(x,0)");
}

function applyInputs(): void {
  try {
    renderPreviews();
    rebuildGrid();
    const initialCompiled = compileExpression(initialExpressionInput.value);
    const potentialCompiled = compileExpression(potentialExpressionInput.value);
    initialPsi = normalize(xGrid.map((x) => evaluateComplex(initialCompiled, x)));
    potentialValues = xGrid.map((x) => evaluateReal(potentialCompiled, x));
    computeDisplayScales();
    time = 0;
    timeInput.value = "0";
    markSceneDirty();
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : "invalid expression";
    status.classList.add("error");
  }
}

function resize(): void {
  const { clientWidth, clientHeight } = canvas;
  renderer.setSize(clientWidth, clientHeight, false);
  camera.aspect = clientWidth / Math.max(clientHeight, 1);
  camera.updateProjectionMatrix();
}

let animationFrameId: number | null = null;
let sceneDirty = true;
let renderDirty = true;
let renderedWidth = 0;
let renderedHeight = 0;
let lastAnimationTime = performance.now();
const animationFrameInterval = 1000 / 30;

function scheduleRender(): void {
  if (animationFrameId === null) animationFrameId = requestAnimationFrame(tick);
}

function markSceneDirty(): void {
  sceneDirty = true;
  renderDirty = true;
  scheduleRender();
}

function resizeIfNeeded(): boolean {
  const { clientWidth, clientHeight } = canvas;
  if (clientWidth === renderedWidth && clientHeight === renderedHeight) return false;
  renderedWidth = clientWidth;
  renderedHeight = clientHeight;
  resize();
  return true;
}

modeWave.addEventListener("click", () => {
  mode = "wave";
  updateInitialLabel();
  markSceneDirty();
});
modeDensity.addEventListener("click", () => {
  mode = "density";
  updateInitialLabel();
  markSceneDirty();
});
timeInput.addEventListener("input", () => {
  time = Number(timeInput.value);
  markSceneDirty();
});
massInput.addEventListener("input", () => {
  mass = Number(massInput.value);
  markSceneDirty();
});
domainInput.addEventListener("input", () => {
  domain = Number(domainInput.value);
  applyInputs();
});
animateInput.addEventListener("change", () => {
  lastAnimationTime = performance.now();
  markSceneDirty();
});
[phaseInput, initialWaveInput, potentialVisibleInput].forEach((input) => input.addEventListener("change", markSceneDirty));
applyButton.addEventListener("click", () => {
  closePickers();
  applyInputs();
});
[initialExpressionInput, potentialExpressionInput].forEach((input) => input.addEventListener("input", renderPreviews));
document.addEventListener("pointerdown", (event) => {
  const target = event.target;
  if (!(target instanceof Node)) return;
  if (!initialPicker.button.contains(target) && !initialPicker.menu.contains(target) && !potentialPicker.button.contains(target) && !potentialPicker.menu.contains(target)) closePickers();
}, true);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closePickers();
});
document.querySelector(".panel")?.addEventListener("scroll", closePickers);
controls.addEventListener("change", () => {
  renderDirty = true;
  scheduleRender();
});
window.addEventListener("resize", markSceneDirty);

function updateAxisLabels(): void {
  const bounds = canvas.getBoundingClientRect();
  const labels = [
    { element: axisXLabel, position: new THREE.Vector3(1.13, 0, 0) },
    { element: axisReLabel, position: new THREE.Vector3(0, 0.76, 0) },
    { element: axisImLabel, position: new THREE.Vector3(0, 0, 0.76) },
  ];
  for (const label of labels) {
    const projected = label.position.clone().add(root.position).project(camera);
    const x = (projected.x * 0.5 + 0.5) * bounds.width;
    const y = (-projected.y * 0.5 + 0.5) * bounds.height;
    label.element.style.transform = `translate(-50%, -50%) translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    label.element.style.opacity = projected.z < -1 || projected.z > 1 ? "0" : "1";
  }
}

function tick(now: number): void {
  animationFrameId = null;
  const shouldAnimate = animateInput.checked && !document.hidden;
  if (shouldAnimate && now - lastAnimationTime >= animationFrameInterval) {
    const dt = Math.min((now - lastAnimationTime) / 1000, 0.08);
    lastAnimationTime = now;
    time = (time + dt * 0.8) % Number(timeInput.max);
    timeInput.value = time.toFixed(3);
    sceneDirty = true;
  } else if (!shouldAnimate) {
    lastAnimationTime = now;
  }

  if (sceneDirty) {
    redraw();
    sceneDirty = false;
    renderDirty = true;
  }

  const resized = resizeIfNeeded();
  const controlsChanged = controls.update();
  if (resized || controlsChanged || renderDirty) {
    updateAxisLabels();
    renderer.render(scene, camera);
    renderDirty = false;
  }

  if (shouldAnimate || controlsChanged || sceneDirty || renderDirty) scheduleRender();
}

initialPicker = {
  button: requireElement<HTMLButtonElement>("#initial-preset-button"),
  menu: requireElement<HTMLDivElement>("#initial-preset-menu"),
  presets: initialPresets,
  selectedId: initialPresets[0].id,
  onSelect: (preset) => {
    initialExpressionInput.value = preset.latex;
  },
};
potentialPicker = {
  button: requireElement<HTMLButtonElement>("#potential-preset-button"),
  menu: requireElement<HTMLDivElement>("#potential-preset-menu"),
  presets: potentialPresets,
  selectedId: potentialPresets[0].id,
  onSelect: (preset) => {
    potentialExpressionInput.value = preset.latex;
  },
};
initialPicker.button.addEventListener("click", (event) => {
  event.stopPropagation();
  setPickerOpen(potentialPicker, false);
  setPickerOpen(initialPicker, initialPicker.menu.hidden);
});
potentialPicker.button.addEventListener("click", (event) => {
  event.stopPropagation();
  setPickerOpen(initialPicker, false);
  setPickerOpen(potentialPicker, potentialPicker.menu.hidden);
});

addAxes();
renderPicker(initialPicker, true);
renderPicker(potentialPicker);
renderPreviews();
updateInitialLabel();
applyInputs();
scheduleRender();
