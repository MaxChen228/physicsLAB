import type { Jones } from "./jones";

const r2 = 1 / Math.SQRT2;

export const presets: Record<string, Jones> = {
  H: { Ex: 1, Ey: 0, delta: 0 },
  V: { Ex: 0, Ey: 1, delta: 0 },
  D: { Ex: r2, Ey: r2, delta: 0 },
  A: { Ex: r2, Ey: r2, delta: Math.PI },
  RCP: { Ex: r2, Ey: r2, delta: -Math.PI / 2 },
  LCP: { Ex: r2, Ey: r2, delta: Math.PI / 2 },
};
