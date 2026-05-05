import type { Jones } from "./jones";

export type Stokes = { S0: number; S1: number; S2: number; S3: number };

export function jonesToStokes(j: Jones): Stokes {
  const { Ex, Ey, delta } = j;
  return {
    S0: Ex * Ex + Ey * Ey,
    S1: Ex * Ex - Ey * Ey,
    S2: 2 * Ex * Ey * Math.cos(delta),
    S3: 2 * Ex * Ey * Math.sin(delta),
  };
}

export function poincareXYZ(s: Stokes): [number, number, number] {
  const n = Math.max(s.S0, 1e-9);
  return [s.S1 / n, s.S2 / n, s.S3 / n];
}

export function dop(s: Stokes): number {
  const n = Math.max(s.S0, 1e-9);
  return Math.sqrt(s.S1 * s.S1 + s.S2 * s.S2 + s.S3 * s.S3) / n;
}
