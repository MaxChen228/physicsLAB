import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { getState, subscribe } from "../state";
import { jonesToStokes, poincareXYZ } from "../physics/stokes";

const css = (n: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const hex = (s: string, fallback = "#ffffff") => {
  const t = s || fallback;
  return new THREE.Color(t);
};

export function mountPoincare(host: HTMLElement): void {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.domElement.style.display = "block";
  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
  camera.position.set(2.6, 1.8, 3.2);
  camera.lookAt(0, 0, 0);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.minDistance = 2.2;
  controls.maxDistance = 8;

  const cX = hex(css("--ch-x"), "#ff2d55");
  const cY = hex(css("--ch-y"), "#00ff9c");
  const cSig = hex(css("--signal"), "#00e5ff");
  const cDim = hex(css("--paper-dim"), "#6a7480");
  const cPaper = hex(css("--paper"), "#d8dde2");

  // Sphere wireframe
  const sphereGeom = new THREE.SphereGeometry(1, 32, 24);
  const wire = new THREE.LineSegments(
    new THREE.WireframeGeometry(sphereGeom),
    new THREE.LineBasicMaterial({ color: cDim, transparent: true, opacity: 0.35 }),
  );
  scene.add(wire);

  // Equator + meridians (linear polarization references)
  const ringMat = new THREE.LineBasicMaterial({
    color: cDim,
    transparent: true,
    opacity: 0.7,
  });
  const ringPoints = (axis: "x" | "y" | "z") => {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 96; i++) {
      const a = (i / 96) * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      if (axis === "z") pts.push(new THREE.Vector3(c, s, 0));
      else if (axis === "y") pts.push(new THREE.Vector3(c, 0, s));
      else pts.push(new THREE.Vector3(0, c, s));
    }
    return pts;
  };
  scene.add(
    new THREE.Line(new THREE.BufferGeometry().setFromPoints(ringPoints("z")), ringMat),
  );
  scene.add(
    new THREE.Line(new THREE.BufferGeometry().setFromPoints(ringPoints("y")), ringMat),
  );

  // Axes (S1 red, S2 green, S3 cyan)
  const mkAxis = (dir: THREE.Vector3, color: THREE.Color) => {
    const geom = new THREE.BufferGeometry().setFromPoints([
      dir.clone().multiplyScalar(-1.25),
      dir.clone().multiplyScalar(1.25),
    ]);
    return new THREE.Line(geom, new THREE.LineBasicMaterial({ color }));
  };
  scene.add(mkAxis(new THREE.Vector3(1, 0, 0), cX));
  scene.add(mkAxis(new THREE.Vector3(0, 0, 1), cY));
  scene.add(mkAxis(new THREE.Vector3(0, 1, 0), cSig));

  // Axis labels via sprite
  const mkLabel = (text: string, color: THREE.Color, pos: THREE.Vector3) => {
    const cnv = document.createElement("canvas");
    cnv.width = 128;
    cnv.height = 64;
    const c = cnv.getContext("2d")!;
    c.fillStyle = `#${color.getHexString()}`;
    c.font = "700 28px 'JetBrains Mono', monospace";
    c.textBaseline = "middle";
    c.textAlign = "center";
    c.fillText(text, 64, 32);
    const tex = new THREE.CanvasTexture(cnv);
    tex.minFilter = THREE.LinearFilter;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
    const sp = new THREE.Sprite(mat);
    sp.position.copy(pos);
    sp.scale.set(0.45, 0.225, 1);
    return sp;
  };
  scene.add(mkLabel("+S1", cX, new THREE.Vector3(1.45, 0, 0)));
  scene.add(mkLabel("−S1", cX, new THREE.Vector3(-1.45, 0, 0)));
  scene.add(mkLabel("+S2", cY, new THREE.Vector3(0, 0, 1.45)));
  scene.add(mkLabel("−S2", cY, new THREE.Vector3(0, 0, -1.45)));
  scene.add(mkLabel("+S3", cSig, new THREE.Vector3(0, 1.45, 0)));
  scene.add(mkLabel("−S3", cSig, new THREE.Vector3(0, -1.45, 0)));

  // State point
  const pointGeom = new THREE.SphereGeometry(0.05, 24, 16);
  const pointMat = new THREE.MeshBasicMaterial({ color: cSig });
  const point = new THREE.Mesh(pointGeom, pointMat);
  scene.add(point);

  // Halo
  const halo = new THREE.Mesh(
    new THREE.SphereGeometry(0.09, 24, 16),
    new THREE.MeshBasicMaterial({ color: cSig, transparent: true, opacity: 0.25 }),
  );
  scene.add(halo);

  // Connection line from origin to point (pin)
  const pinGeom = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0, 0),
  ]);
  const pin = new THREE.Line(
    pinGeom,
    new THREE.LineBasicMaterial({ color: cPaper, transparent: true, opacity: 0.5 }),
  );
  scene.add(pin);

  const updatePoint = () => {
    const s = getState();
    const st = jonesToStokes({ Ex: s.Ex, Ey: s.Ey, delta: s.delta });
    const [x, y, z] = poincareXYZ(st);
    // map (S1,S2,S3) → (x,z,y) so S3 is up
    point.position.set(x, z, y);
    halo.position.copy(point.position);
    const pos = pinGeom.attributes.position.array as Float32Array;
    pos[3] = x;
    pos[4] = z;
    pos[5] = y;
    pinGeom.attributes.position.needsUpdate = true;
  };
  subscribe(updatePoint);

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
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
