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
const expressionInput = requireElement<HTMLTextAreaElement>("#expression");
const expressionPreview = requireElement<HTMLDivElement>("#expression-preview");
const presetSelect = requireElement<HTMLSelectElement>("#preset");
const applyExpressionButton = requireElement<HTMLButtonElement>("#apply-expression");
const expressionStatus = requireElement<HTMLParagraphElement>("#expression-status");
const domainFormula = requireElement<HTMLParagraphElement>("#domain-formula");
const axisXLabel = requireElement<HTMLDivElement>("#axis-x");
const axisReLabel = requireElement<HTMLDivElement>("#axis-re");
const axisImLabel = requireElement<HTMLDivElement>("#axis-im");

const math = create(all, {});

function renderLatex(element: HTMLElement, latex: string, displayMode = false): void {
  katex.render(latex, element, {
    displayMode,
    throwOnError: false,
    strict: "ignore",
  });
}

renderLatex(domainFormula, "0\\le x\\le1,\\quad \\phi_n(x)=\\sqrt{2}\\sin(n\\pi x)");
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
  let maxDensity = 0;
  let maxAbsWave = 0;

  const values = xSamples.map((x, index) => {
    const value = psi(x, tau, basisTerms);
    const density = value.re * value.re + value.im * value.im;
    maxDensity = Math.max(maxDensity, density);
    maxAbsWave = Math.max(maxAbsWave, Math.abs(value.re), Math.abs(value.im), Math.abs(normalizedInitialSamples[index] ?? 0));
    return { x, ...value, density };
  });

  const densityScale = maxDensity > 0 ? 0.7 / maxDensity : 1;
  const waveScale = maxAbsWave > 0 ? 0.62 / maxAbsWave : 1;

  values.forEach((value, index) => {
    wavePoints.push(new THREE.Vector3(value.x, value.re * waveScale, value.im * waveScale));
    realPoints.push(new THREE.Vector3(value.x, value.re * waveScale, 0));
    imagPoints.push(new THREE.Vector3(value.x, 0, value.im * waveScale));
    densityPoints.push(new THREE.Vector3(value.x, value.density * densityScale, 0));
    initialPoints.push(new THREE.Vector3(value.x, (normalizedInitialSamples[index] ?? 0) * waveScale, 0));
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

function resize(): void {
  const { clientWidth, clientHeight } = canvas;
  renderer.setSize(clientWidth, clientHeight, false);
  camera.aspect = clientWidth / Math.max(clientHeight, 1);
  camera.updateProjectionMatrix();
}

modeWave.addEventListener("click", () => {
  mode = "wave";
  redraw();
});

modeDensity.addEventListener("click", () => {
  mode = "density";
  redraw();
});

timeInput.addEventListener("input", () => {
  tau = Number(timeInput.value);
  redraw();
});

termsInput.addEventListener("input", () => {
  basisTerms = Number(termsInput.value);
  const projection = projectInitialState(getExpressionLatex(), basisTerms);
  coefficients = projection.coefficients;
  normalizedInitialSamples = projection.normalizedSamples;
  redraw();
});

phaseInput.addEventListener("change", redraw);
initialWaveInput.addEventListener("change", redraw);

presetSelect.addEventListener("change", () => {
  setExpressionLatex(presetSelect.value);
  applyInitialExpression();
});

applyExpressionButton.addEventListener("click", () => {
  applyInitialExpression();
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
    coefficients = projection.coefficients;
    normalizedInitialSamples = projection.normalizedSamples;
    tau = 0;
    timeInput.value = "0";
    redraw();
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid expression";
    expressionStatus.textContent = message;
    expressionStatus.classList.add("error");
  }
}

addAxes();
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

let last = performance.now();
function tick(now: number): void {
  const dt = (now - last) / 1000;
  last = now;

  if (animateInput.checked) {
    tau = (tau + dt * 0.48) % (Math.PI * 2);
    timeInput.value = tau.toFixed(3);
    redraw();
  }

  resize();
  controls.update();
  updateAxisLabels();
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}

requestAnimationFrame(tick);
