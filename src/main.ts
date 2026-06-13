import "./styles.css";
import "katex/dist/katex.min.css";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { all, create, type EvalFunction } from "mathjs";
import katex from "katex";

type DisplayMode = "wave" | "density";
type InitialStateProjection = {
  coefficients: number[];
  normalizedSamples: number[];
  norm: number;
  captured: number;
};
type Preset = {
  id: string;
  name: string;
  latex: string;
};

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Missing required UI element: ${selector}`);
  }
  return element;
}

const canvas = requireElement<HTMLCanvasElement>("#scene");
const modeWave = requireElement<HTMLButtonElement>("#mode-wave");
const modeDensity = requireElement<HTMLButtonElement>("#mode-density");
const timeInput = requireElement<HTMLInputElement>("#time");
const termsInput = requireElement<HTMLInputElement>("#terms");
const timeOutput = requireElement<HTMLOutputElement>("#time-output");
const termsOutput = requireElement<HTMLOutputElement>("#terms-output");
const animateInput = requireElement<HTMLInputElement>("#animate");
const phaseInput = requireElement<HTMLInputElement>("#phase");
const initialWaveInput = requireElement<HTMLInputElement>("#initial-wave");
const initialWaveLabel = requireElement<HTMLSpanElement>("#initial-wave-label");
const expressionInput = requireElement<HTMLTextAreaElement>("#expression");
const expressionPreview = requireElement<HTMLDivElement>("#expression-preview");
const presetButton = requireElement<HTMLButtonElement>("#preset-button");
const presetMenu = requireElement<HTMLDivElement>("#preset-menu");
const applyExpressionButton = requireElement<HTMLButtonElement>("#apply-expression");
const expressionStatus = requireElement<HTMLParagraphElement>("#expression-status");
const domainFormula = requireElement<HTMLParagraphElement>("#domain-formula");
const coefficientChart = requireElement<SVGSVGElement>("#coeff-chart");
const axisXLabel = requireElement<HTMLDivElement>("#axis-x");
const axisReLabel = requireElement<HTMLDivElement>("#axis-re");
const axisImLabel = requireElement<HTMLDivElement>("#axis-im");

animateInput.checked = false;

const math = create(all, {});
const presets: Preset[] = [
  { id: "parabola", name: "parabola", latex: "x(1-x)" },
  { id: "ground", name: "ground state", latex: "\\sin(\\pi x)" },
  { id: "second", name: "second eigenstate", latex: "\\sin(2\\pi x)" },
  { id: "third-mix", name: "1 + 3 mixture", latex: "\\sin(\\pi x)+0.45\\sin(3\\pi x)" },
  { id: "center-packet", name: "center packet", latex: "e^{-80(x-\\frac{1}{2})^2}" },
  { id: "left-packet", name: "left packet", latex: "e^{-95(x-\\frac{1}{3})^2}" },
  { id: "double-packet", name: "double packet", latex: "e^{-120(x-\\frac{1}{3})^2}+e^{-120(x-\\frac{2}{3})^2}" },
  { id: "antisymmetric", name: "antisymmetric", latex: "(x-\\frac{1}{2})x(1-x)" },
  { id: "edge-weighted", name: "edge weighted", latex: "\\sqrt{x}(1-x)" },
  { id: "ripples", name: "ripples", latex: "x(1-x)(1+0.55\\sin(6\\pi x))" },
];
let selectedPresetId = presets[0].id;

function renderLatex(element: HTMLElement, latex: string, displayMode = false): void {
  katex.render(latex, element, {
    displayMode,
    throwOnError: false,
    strict: "ignore",
  });
}

renderLatex(domainFormula, "\\phi_n(x)=\\sqrt{2}\\sin(n\\pi x)");
document.querySelectorAll<HTMLElement>("[data-latex]").forEach((element) => {
  renderLatex(element, element.dataset.latex ?? "");
});
renderExpressionPreview();

const scene = new THREE.Scene();
scene.background = new THREE.Color("#fbfaf7");

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;

const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
camera.position.set(2.75, 1.35, 2.45);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(0, 0.05, 0);
controls.minDistance = 2.0;
controls.maxDistance = 6.2;
controls.maxPolarAngle = Math.PI * 0.74;

const root = new THREE.Group();
root.position.x = -0.5;
scene.add(root);

const light = new THREE.DirectionalLight("#ffffff", 2.1);
light.position.set(2, 3, 2);
scene.add(light);
scene.add(new THREE.AmbientLight("#ffffff", 1.5));

const axisMaterial = new THREE.LineBasicMaterial({ color: "#111111" });
const gridMaterial = new THREE.LineBasicMaterial({ color: "#d2d2d2", transparent: true, opacity: 0.75 });
const wellMaterial = new THREE.LineBasicMaterial({ color: "#111111", transparent: true, opacity: 0.38 });
const realMaterial = new THREE.LineBasicMaterial({ color: "#315f9f", linewidth: 2 });
const imagMaterial = new THREE.LineBasicMaterial({ color: "#a43f38", linewidth: 2 });
const waveMaterial = new THREE.LineBasicMaterial({ color: "#111111", linewidth: 3 });
const densityMaterial = new THREE.LineBasicMaterial({ color: "#111111", linewidth: 3 });
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

let mode: DisplayMode = "wave";
let tau = 0;
let basisTerms = 32;
let coefficients = Array<number>(basisTerms + 1).fill(0);

const curvePoints = 260;
const integrationPoints = 1201;
const xSamples = Array.from({ length: curvePoints }, (_, index) => index / (curvePoints - 1));
const integrationSamples = Array.from({ length: integrationPoints }, (_, index) => index / (integrationPoints - 1));
let normalizedInitialSamples = Array<number>(curvePoints).fill(0);
let amplitudeScale = 1;
let densityAmplitudeScale = 1;

const waveLine = new THREE.Line(new THREE.BufferGeometry(), waveMaterial);
const realProjection = new THREE.Line(new THREE.BufferGeometry(), realMaterial);
const imagProjection = new THREE.Line(new THREE.BufferGeometry(), imagMaterial);
const densityLine = new THREE.Line(new THREE.BufferGeometry(), densityMaterial);
const initialLine = new THREE.Line(new THREE.BufferGeometry(), initialMaterial);
const ribbonMesh = new THREE.Mesh(new THREE.BufferGeometry(), ribbonMaterial);
const densityFill = new THREE.Mesh(new THREE.BufferGeometry(), ribbonMaterial.clone());
(densityFill.material as THREE.MeshBasicMaterial).opacity = 0.11;

root.add(waveLine, realProjection, imagProjection, densityLine, initialLine, ribbonMesh, densityFill);

function makeLine(points: THREE.Vector3[], material: THREE.LineBasicMaterial): THREE.Line {
  return new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), material);
}

function addAxes(): void {
  const xAxis = makeLine([new THREE.Vector3(0, 0, 0), new THREE.Vector3(1.12, 0, 0)], axisMaterial);
  const yAxis = makeLine([new THREE.Vector3(0, -0.72, 0), new THREE.Vector3(0, 0.72, 0)], axisMaterial);
  const zAxis = makeLine([new THREE.Vector3(0, 0, -0.72), new THREE.Vector3(0, 0, 0.72)], axisMaterial);
  root.add(xAxis, yAxis, zAxis);

  for (let i = 0; i <= 10; i += 1) {
    const x = i / 10;
    root.add(makeLine([new THREE.Vector3(x, 0, -0.62), new THREE.Vector3(x, 0, 0.62)], gridMaterial));
    root.add(makeLine([new THREE.Vector3(x, -0.62, 0), new THREE.Vector3(x, 0.62, 0)], gridMaterial));
  }

  for (const wallX of [0, 1]) {
    root.add(makeLine([new THREE.Vector3(wallX, -0.66, -0.66), new THREE.Vector3(wallX, 0.66, -0.66)], wellMaterial));
    root.add(makeLine([new THREE.Vector3(wallX, 0.66, -0.66), new THREE.Vector3(wallX, 0.66, 0.66)], wellMaterial));
    root.add(makeLine([new THREE.Vector3(wallX, 0.66, 0.66), new THREE.Vector3(wallX, -0.66, 0.66)], wellMaterial));
    root.add(makeLine([new THREE.Vector3(wallX, -0.66, 0.66), new THREE.Vector3(wallX, -0.66, -0.66)], wellMaterial));
  }
}

function getExpressionLatex(): string {
  return expressionInput.value;
}

function setExpressionLatex(latex: string): void {
  expressionInput.value = latex;
  renderExpressionPreview();
}

function renderExpressionPreview(): void {
  renderLatex(expressionPreview, `\\Psi(x,0)=N\\left[${expressionInput.value}\\right]`);
}

function replaceLatexCommand(source: string, command: string, arity: 1 | 2, renderer: (...args: string[]) => string): string {
  let output = source;
  let commandIndex = output.indexOf(command);

  while (commandIndex !== -1) {
    let cursor = commandIndex + command.length;
    const args: string[] = [];

    for (let argIndex = 0; argIndex < arity; argIndex += 1) {
      while (output[cursor] === " ") cursor += 1;
      if (output[cursor] !== "{") {
        throw new Error(`${command} requires braced arguments`);
      }

      let depth = 0;
      let end = cursor;
      for (; end < output.length; end += 1) {
        if (output[end] === "{") depth += 1;
        if (output[end] === "}") depth -= 1;
        if (depth === 0) break;
      }

      if (depth !== 0) {
        throw new Error("unbalanced braces in LaTeX expression");
      }

      args.push(output.slice(cursor + 1, end));
      cursor = end + 1;
    }

    output = output.slice(0, commandIndex) + renderer(...args) + output.slice(cursor);
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
    .replace(/\{/g, "(")
    .replace(/\}/g, ")")
    .replace(/\^\(([^()]*)\)/g, "^($1)")
    .replace(/e\^\(([^()]*)\)/g, "e^($1)");

  expression = expression
    .replace(/(\d|\)|x)\s*(?=\()/g, "$1*")
    .replace(/(\d|\)|x)\s*(?=(?:x|pi|e)\b)/g, "$1*")
    .replace(/(\d|x|pi|e)\s*(?=(?:sin|cos|tan|sqrt|exp)\b)/g, "$1*")
    .replace(/(pi|e)\s*(?=(?:x|pi|e|\())/g, "$1*")
    .replace(/\)\s*(?=(?:\d|x|pi|e|sin|cos|tan|sqrt|exp)\b|\()/g, ")*");

  return expression;
}

function compileExpression(latex: string): EvalFunction {
  return math.compile(latexToMathExpression(latex));
}

function evaluateInitial(compiled: EvalFunction, x: number): number {
  const result = compiled.evaluate({ x, pi: Math.PI, e: Math.E });
  const value = typeof result === "number" ? result : Number(result);
  if (!Number.isFinite(value)) {
    throw new Error("expression must evaluate to finite real numbers on 0≤x≤1");
  }
  return value;
}

function trapezoid(values: number[]): number {
  const h = 1 / (values.length - 1);
  let sum = 0.5 * values[0] + 0.5 * values[values.length - 1];
  for (let i = 1; i < values.length - 1; i += 1) {
    sum += values[i];
  }
  return sum * h;
}

function projectInitialState(latex: string, maxTerms: number): InitialStateProjection {
  const compiled = compileExpression(latex);
  const rawValues = integrationSamples.map((x) => evaluateInitial(compiled, x));
  const normSquared = trapezoid(rawValues.map((value) => value * value));

  if (!Number.isFinite(normSquared) || normSquared <= 1e-12) {
    throw new Error("normalization failed");
  }

  const norm = 1 / Math.sqrt(normSquared);
  const normalizedValues = rawValues.map((value) => value * norm);
  const normalizedSamples = xSamples.map((x) => evaluateInitial(compiled, x) * norm);
  const nextCoefficients = Array<number>(maxTerms + 1).fill(0);

  for (let n = 1; n <= maxTerms; n += 1) {
    const integrand = normalizedValues.map((value, index) => {
      const x = integrationSamples[index];
      return Math.sqrt(2) * Math.sin(n * Math.PI * x) * value;
    });
    nextCoefficients[n] = trapezoid(integrand);
  }

  const captured = nextCoefficients.reduce((sum, coefficient) => sum + coefficient * coefficient, 0);
  renderLatex(expressionPreview, `\\Psi(x,0)=${norm.toFixed(4)}\\left[${latex}\\right]`);
  renderLatex(expressionStatus, `\\int_0^1|\\Psi(x,0)|^2dx=1,\\quad \\sum C_n^2=${captured.toFixed(4)}`);
  expressionStatus.classList.remove("error");
  return {
    coefficients: nextCoefficients,
    normalizedSamples,
    norm,
    captured,
  };
}

function setInitialProjection(projection: InitialStateProjection): void {
  coefficients = projection.coefficients;
  normalizedInitialSamples = projection.normalizedSamples;

  const maxInitialAmplitude = normalizedInitialSamples.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
  amplitudeScale = maxInitialAmplitude > 0 ? 0.62 / maxInitialAmplitude : 1;
  densityAmplitudeScale = computeDensityAmplitudeScale(basisTerms);
  renderCoefficientChart();
}

function makeSvgElement<K extends keyof SVGElementTagNameMap>(
  tagName: K,
  attributes: Record<string, string>,
): SVGElementTagNameMap[K] {
  const element = document.createElementNS("http://www.w3.org/2000/svg", tagName);
  for (const [key, value] of Object.entries(attributes)) {
    element.setAttribute(key, value);
  }
  return element;
}

function buildPresetSparkline(latex: string): SVGSVGElement {
  const width = 92;
  const height = 34;
  const margin = 3;
  const svg = makeSvgElement("svg", {
    class: "preset-graph",
    viewBox: `0 0 ${width} ${height}`,
    "aria-hidden": "true",
  });

  try {
    const compiled = compileExpression(latex);
    const samples = Array.from({ length: 72 }, (_, index) => {
      const x = index / 71;
      return evaluateInitial(compiled, x);
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

    svg.append(
      makeSvgElement("line", {
        class: "preset-graph-axis",
        x1: `${margin}`,
        y1: `${centerY}`,
        x2: `${width - margin}`,
        y2: `${centerY}`,
      }),
      makeSvgElement("polyline", {
        class: "preset-graph-line",
        points,
      }),
    );
  } catch {
    svg.append(
      makeSvgElement("line", {
        class: "preset-graph-axis",
        x1: `${margin}`,
        y1: `${height / 2}`,
        x2: `${width - margin}`,
        y2: `${height / 2}`,
      }),
    );
  }

  return svg;
}

function setPresetMenuOpen(open: boolean): void {
  presetMenu.hidden = !open;
  presetButton.setAttribute("aria-expanded", open ? "true" : "false");
}

function renderPresetPicker(): void {
  const selected = presets.find((preset) => preset.id === selectedPresetId) ?? presets[0];
  presetButton.replaceChildren();

  const currentText = document.createElement("span");
  currentText.className = "preset-current-text";
  currentText.textContent = selected.name;

  const currentFormula = document.createElement("span");
  currentFormula.className = "preset-current-formula";
  renderLatex(currentFormula, selected.latex);

  const currentGraph = buildPresetSparkline(selected.latex);
  presetButton.append(currentText, currentFormula, currentGraph);

  presetMenu.replaceChildren();
  for (const preset of presets) {
    const option = document.createElement("button");
    option.className = "preset-option";
    option.type = "button";
    option.dataset.presetId = preset.id;
    option.setAttribute("aria-selected", preset.id === selectedPresetId ? "true" : "false");

    const marker = document.createElement("span");
    marker.className = "preset-marker";
    marker.textContent = preset.id === selectedPresetId ? "✓" : "";

    const body = document.createElement("span");
    body.className = "preset-option-body";

    const name = document.createElement("span");
    name.className = "preset-option-name";
    name.textContent = preset.name;

    const formula = document.createElement("span");
    formula.className = "preset-option-formula";
    renderLatex(formula, preset.latex);

    body.append(name, formula);
    option.append(marker, body, buildPresetSparkline(preset.latex));
    option.addEventListener("click", () => {
      selectedPresetId = preset.id;
      setExpressionLatex(preset.latex);
      renderPresetPicker();
      setPresetMenuOpen(false);
      applyInitialExpression();
    });
    presetMenu.append(option);
  }
}

function renderCoefficientChart(): void {
  const width = 360;
  const height = 128;
  const margin = { top: 14, right: 30, bottom: 24, left: 28 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const centerY = margin.top + plotHeight / 2;
  const visibleCoefficients = coefficients.slice(1, basisTerms + 1);
  const maxAbs = visibleCoefficients.reduce((max, coefficient) => Math.max(max, Math.abs(coefficient)), 0) || 1;
  const barGap = basisTerms > 48 ? 1 : 2;
  const barWidth = Math.max(1, plotWidth / basisTerms - barGap);

  coefficientChart.replaceChildren();
  coefficientChart.append(
    makeSvgElement("line", { class: "chart-frame", x1: `${margin.left}`, y1: `${margin.top}`, x2: `${margin.left}`, y2: `${height - margin.bottom}` }),
    makeSvgElement("line", { class: "chart-axis", x1: `${margin.left}`, y1: `${centerY}`, x2: `${width - margin.right}`, y2: `${centerY}` }),
    makeSvgElement("line", { class: "chart-grid", x1: `${margin.left}`, y1: `${margin.top}`, x2: `${width - margin.right}`, y2: `${margin.top}` }),
    makeSvgElement("line", { class: "chart-grid", x1: `${margin.left}`, y1: `${height - margin.bottom}`, x2: `${width - margin.right}`, y2: `${height - margin.bottom}` }),
  );

  visibleCoefficients.forEach((coefficient, index) => {
    const n = index + 1;
    const x = margin.left + index * (plotWidth / basisTerms) + barGap / 2;
    const magnitude = Math.abs(coefficient) / maxAbs;
    const barHeight = Math.max(1, magnitude * (plotHeight / 2 - 4));
    const y = coefficient >= 0 ? centerY - barHeight : centerY;
    const bar = makeSvgElement("rect", {
      class: `chart-bar${coefficient < 0 ? " negative" : ""}`,
      x: x.toFixed(2),
      y: y.toFixed(2),
      width: barWidth.toFixed(2),
      height: barHeight.toFixed(2),
      rx: "0",
    });

    const title = makeSvgElement("title", {});
    title.textContent = `n=${n}, C_n=${coefficient.toFixed(5)}`;
    bar.append(title);
    coefficientChart.append(bar);
  });

  for (const tick of [1, Math.max(1, Math.round(basisTerms / 2)), basisTerms]) {
    const x = margin.left + (tick - 0.5) * (plotWidth / basisTerms);
    coefficientChart.append(
      makeSvgElement("line", {
        class: "chart-axis",
        x1: `${x}`,
        y1: `${centerY - 3}`,
        x2: `${x}`,
        y2: `${centerY + 3}`,
      }),
      makeSvgElement("text", {
        class: "chart-label",
        x: `${x}`,
        y: `${height - 6}`,
        "text-anchor": "middle",
      }),
    );
    coefficientChart.lastElementChild!.textContent = `${tick}`;
  }

  coefficientChart.append(
    makeSvgElement("text", { class: "chart-label", x: "4", y: `${centerY + 4}` }),
    makeSvgElement("text", { class: "chart-label", x: `${width - 7}`, y: `${height - 6}`, "text-anchor": "end" }),
  );
  coefficientChart.children[coefficientChart.children.length - 2].textContent = "0";
  coefficientChart.children[coefficientChart.children.length - 1].textContent = "n";
}

function psi(x: number, time: number, maxTerms: number): { re: number; im: number } {
  let re = 0;
  let im = 0;

  for (let n = 1; n <= maxTerms; n += 1) {
    const basis = Math.sqrt(2) * Math.sin(n * Math.PI * x);
    const amp = coefficients[n] * basis;
    const phase = n * n * time;
    re += amp * Math.cos(phase);
    im -= amp * Math.sin(phase);
  }

  return { re, im };
}

function computeDensityAmplitudeScale(maxTerms: number): number {
  let reference = normalizedInitialSamples.reduce((max, value) => Math.max(max, value * value), 0);
  const timeSamples = 48;
  const displayCeiling = 0.7;

  for (let timeIndex = 0; timeIndex < timeSamples; timeIndex += 1) {
    const sampleTime = (timeIndex / timeSamples) * Math.PI * 2;
    for (const x of xSamples) {
      const value = psi(x, sampleTime, maxTerms);
      reference = Math.max(reference, value.re * value.re + value.im * value.im);
    }
  }

  return reference > 0 ? displayCeiling / reference : 1;
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
  const wavePoints: THREE.Vector3[] = [];
  const realPoints: THREE.Vector3[] = [];
  const imagPoints: THREE.Vector3[] = [];
  const densityPoints: THREE.Vector3[] = [];
  const initialPoints: THREE.Vector3[] = [];

  const values = xSamples.map((x, index) => {
    const value = psi(x, tau, basisTerms);
    const density = value.re * value.re + value.im * value.im;
    const initial = normalizedInitialSamples[index] ?? 0;
    const initialDensity = initial * initial;
    return { x, ...value, density, initial, initialDensity };
  });

  values.forEach((value) => {
    wavePoints.push(new THREE.Vector3(value.x, value.re * amplitudeScale, value.im * amplitudeScale));
    realPoints.push(new THREE.Vector3(value.x, value.re * amplitudeScale, 0));
    imagPoints.push(new THREE.Vector3(value.x, 0, value.im * amplitudeScale));
    densityPoints.push(new THREE.Vector3(value.x, value.density * densityAmplitudeScale, 0));
    initialPoints.push(
      mode === "density"
        ? new THREE.Vector3(value.x, value.initialDensity * densityAmplitudeScale, 0)
        : new THREE.Vector3(value.x, value.initial * amplitudeScale, 0),
    );
  });

  setLineGeometry(waveLine, wavePoints);
  setLineGeometry(realProjection, realPoints);
  setLineGeometry(imagProjection, imagPoints);
  setLineGeometry(densityLine, densityPoints);
  setLineGeometry(initialLine, initialPoints);
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

  modeWave.classList.toggle("active", mode === "wave");
  modeDensity.classList.toggle("active", mode === "density");
  timeOutput.value = tau.toFixed(2);
  termsOutput.value = String(basisTerms);
}

function updateInitialWaveLabel(): void {
  renderLatex(initialWaveLabel, mode === "density" ? "|\\Psi(x,0)|^2" : "\\Psi(x,0)");
}

function resize(): void {
  const { clientWidth, clientHeight } = canvas;
  renderer.setSize(clientWidth, clientHeight, false);
  camera.aspect = clientWidth / Math.max(clientHeight, 1);
  camera.updateProjectionMatrix();
}

let lastAnimationTime = performance.now();
let lastAnimatedFrameTime = 0;
let animationFrameId: number | null = null;
let sceneDirty = true;
let renderDirty = true;
let renderedWidth = 0;
let renderedHeight = 0;
const animationFrameInterval = 1000 / 30;

function scheduleRender(): void {
  if (animationFrameId === null) {
    animationFrameId = requestAnimationFrame(tick);
  }
}

function markSceneDirty(): void {
  sceneDirty = true;
  renderDirty = true;
  scheduleRender();
}

function resizeIfNeeded(): boolean {
  const { clientWidth, clientHeight } = canvas;
  if (clientWidth === renderedWidth && clientHeight === renderedHeight) {
    return false;
  }

  renderedWidth = clientWidth;
  renderedHeight = clientHeight;
  resize();
  return true;
}

modeWave.addEventListener("click", () => {
  mode = "wave";
  updateInitialWaveLabel();
  markSceneDirty();
});

modeDensity.addEventListener("click", () => {
  mode = "density";
  updateInitialWaveLabel();
  markSceneDirty();
});

timeInput.addEventListener("input", () => {
  tau = Number(timeInput.value);
  markSceneDirty();
});

termsInput.addEventListener("input", () => {
  basisTerms = Number(termsInput.value);
  const projection = projectInitialState(getExpressionLatex(), basisTerms);
  setInitialProjection(projection);
  markSceneDirty();
});

phaseInput.addEventListener("change", markSceneDirty);
initialWaveInput.addEventListener("change", markSceneDirty);
animateInput.addEventListener("change", () => {
  lastAnimationTime = performance.now();
  markSceneDirty();
});

presetButton.addEventListener("click", (event) => {
  event.stopPropagation();
  setPresetMenuOpen(presetMenu.hidden);
});

document.addEventListener("pointerdown", (event) => {
  const target = event.target;
  if (!(target instanceof Node)) return;
  if (!presetButton.contains(target) && !presetMenu.contains(target)) {
    setPresetMenuOpen(false);
  }
}, true);

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    setPresetMenuOpen(false);
    presetButton.focus();
  }
});

presetMenu.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    setPresetMenuOpen(false);
    presetButton.focus();
  }
});

applyExpressionButton.addEventListener("click", () => {
  setPresetMenuOpen(false);
  applyInitialExpression();
});

document.querySelector(".panel")?.addEventListener("scroll", () => {
  setPresetMenuOpen(false);
});

expressionInput.addEventListener("input", renderExpressionPreview);

expressionInput.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    applyInitialExpression();
  }
});

function applyInitialExpression(): void {
  try {
    renderExpressionPreview();
    const projection = projectInitialState(getExpressionLatex(), basisTerms);
    setInitialProjection(projection);
    tau = 0;
    timeInput.value = "0";
    markSceneDirty();
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid expression";
    expressionStatus.textContent = message;
    expressionStatus.classList.add("error");
  }
}

addAxes();
renderPresetPicker();
applyInitialExpression();
redraw();

const labelTargets = [
  { element: axisXLabel, position: new THREE.Vector3(1.16, 0, 0) },
  { element: axisReLabel, position: new THREE.Vector3(0, 0.76, 0) },
  { element: axisImLabel, position: new THREE.Vector3(0, 0, 0.76) },
];

function updateAxisLabels(): void {
  const bounds = canvas.getBoundingClientRect();

  for (const label of labelTargets) {
    const projected = label.position.clone().add(root.position).project(camera);
    const x = (projected.x * 0.5 + 0.5) * bounds.width;
    const y = (-projected.y * 0.5 + 0.5) * bounds.height;
    const behindCamera = projected.z < -1 || projected.z > 1;

    label.element.style.transform = `translate(-50%, -50%) translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    label.element.style.opacity = behindCamera ? "0" : "1";
  }
}

controls.addEventListener("change", () => {
  renderDirty = true;
  scheduleRender();
});

window.addEventListener("resize", markSceneDirty);
document.addEventListener("visibilitychange", () => {
  lastAnimationTime = performance.now();
  if (!document.hidden) {
    markSceneDirty();
  }
});

function tick(now: number): void {
  animationFrameId = null;
  const shouldAnimate = animateInput.checked && !document.hidden;

  if (shouldAnimate && now - lastAnimatedFrameTime >= animationFrameInterval) {
    const dt = Math.min((now - lastAnimationTime) / 1000, 0.08);
    lastAnimationTime = now;
    lastAnimatedFrameTime = now;
    tau = (tau + dt * 0.48) % (Math.PI * 2);
    timeInput.value = tau.toFixed(3);
    redraw();
    sceneDirty = false;
    renderDirty = true;
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

  if (shouldAnimate || controlsChanged || renderDirty || sceneDirty) {
    scheduleRender();
  }
}

scheduleRender();
