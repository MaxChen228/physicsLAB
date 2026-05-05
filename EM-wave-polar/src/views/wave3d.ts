import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { getState, subscribe } from "../state";

const css = (n: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const col = (s: string, fallback = "#ffffff") =>
  new THREE.Color(s || fallback);

const N = 200;
const Z_MIN = -5;
const Z_MAX = 5;

export function mountWave3d(host: HTMLElement): void {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.domElement.style.display = "block";
  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
  camera.position.set(8, 4, 7);
  camera.lookAt(0, 0, 0);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.target.set(0, 0, 0);
  controls.minDistance = 4;
  controls.maxDistance = 20;

  const cX = col(css("--ch-x"), "#ff2d55");
  const cY = col(css("--ch-y"), "#00ff9c");
  const cSum = col(css("--paper"), "#d8dde2");
  const cDim = col(css("--paper-dim"), "#6a7480");
  const cSig = col(css("--signal"), "#00e5ff");

  // z axis (propagation direction) — long line
  const zAxisGeom = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(Z_MIN - 0.5, 0, 0),
    new THREE.Vector3(Z_MAX + 0.5, 0, 0),
  ]);
  scene.add(
    new THREE.Line(
      zAxisGeom,
      new THREE.LineBasicMaterial({ color: cDim, transparent: true, opacity: 0.55 }),
    ),
  );

  // tick marks along z
  const tickPts: THREE.Vector3[] = [];
  for (let z = Math.ceil(Z_MIN); z <= Math.floor(Z_MAX); z++) {
    tickPts.push(new THREE.Vector3(z, 0, -0.06));
    tickPts.push(new THREE.Vector3(z, 0, 0.06));
  }
  scene.add(
    new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(tickPts),
      new THREE.LineBasicMaterial({ color: cDim, transparent: true, opacity: 0.5 }),
    ),
  );

  // x and y short reference axes at origin
  const refPts: THREE.Vector3[] = [];
  refPts.push(new THREE.Vector3(0, -1.4, 0));
  refPts.push(new THREE.Vector3(0, 1.4, 0));
  refPts.push(new THREE.Vector3(0, 0, -1.4));
  refPts.push(new THREE.Vector3(0, 0, 1.4));
  const refGeom = new THREE.BufferGeometry().setFromPoints(refPts);
  refGeom.setAttribute(
    "color",
    new THREE.Float32BufferAttribute(
      [
        cX.r, cX.g, cX.b,
        cX.r, cX.g, cX.b,
        cY.r, cY.g, cY.b,
        cY.r, cY.g, cY.b,
      ],
      3,
    ),
  );
  scene.add(
    new THREE.LineSegments(
      refGeom,
      new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.7 }),
    ),
  );

  // Three traces: Ex, Ey, sum E
  const mkTrace = (color: THREE.Color, opacity = 1) => {
    const arr = new Float32Array(N * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(arr, 3));
    const m = new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity });
    return { line: new THREE.Line(g, m), arr, g };
  };
  const traceX = mkTrace(cX);
  const traceY = mkTrace(cY);
  const traceSum = mkTrace(cSum);
  scene.add(traceX.line);
  scene.add(traceY.line);
  scene.add(traceSum.line);

  // Tip marker at z = 0 (current E vector)
  const tipGeom = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0, 0),
  ]);
  const tip = new THREE.Line(
    tipGeom,
    new THREE.LineBasicMaterial({ color: cSig, transparent: true, opacity: 0.95 }),
  );
  scene.add(tip);
  const tipDot = new THREE.Mesh(
    new THREE.SphereGeometry(0.06, 16, 12),
    new THREE.MeshBasicMaterial({ color: cSig }),
  );
  scene.add(tipDot);

  // Animation state
  let t0 = performance.now();
  let phase = 0;

  const update = () => {
    const s = getState();
    const k = (2 * Math.PI) / 4; // wavelength = 4 units in z

    const xPos = traceX.arr;
    const yPos = traceY.arr;
    const sumPos = traceSum.arr;

    for (let i = 0; i < N; i++) {
      const z = Z_MIN + (i / (N - 1)) * (Z_MAX - Z_MIN);
      const ex = s.Ex * Math.cos(k * z - phase);
      const ey = s.Ey * Math.cos(k * z - phase + s.delta);
      // axis layout: x = z (propagation), y = Ex, z = Ey
      xPos[i * 3 + 0] = z;
      xPos[i * 3 + 1] = ex;
      xPos[i * 3 + 2] = 0;

      yPos[i * 3 + 0] = z;
      yPos[i * 3 + 1] = 0;
      yPos[i * 3 + 2] = ey;

      sumPos[i * 3 + 0] = z;
      sumPos[i * 3 + 1] = ex;
      sumPos[i * 3 + 2] = ey;
    }
    traceX.g.attributes.position.needsUpdate = true;
    traceY.g.attributes.position.needsUpdate = true;
    traceSum.g.attributes.position.needsUpdate = true;

    // Tip at z=0
    const ex0 = s.Ex * Math.cos(-phase);
    const ey0 = s.Ey * Math.cos(-phase + s.delta);
    const tArr = tipGeom.attributes.position.array as Float32Array;
    tArr[0] = 0; tArr[1] = 0; tArr[2] = 0;
    tArr[3] = 0; tArr[4] = ex0; tArr[5] = ey0;
    tipGeom.attributes.position.needsUpdate = true;
    tipDot.position.set(0, ex0, ey0);
  };

  subscribe(() => update());

  const resize = () => {
    const r = host.getBoundingClientRect();
    const w = Math.max(1, Math.floor(r.width));
    const h = Math.max(1, Math.floor(r.height));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe(host);
  resize();

  const tick = () => {
    const s = getState();
    const now = performance.now();
    const dt = (now - t0) / 1000;
    t0 = now;
    if (!s.paused) phase += dt * s.timeScale * 2 * Math.PI;
    update();
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
