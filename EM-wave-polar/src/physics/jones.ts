export type Jones = { Ex: number; Ey: number; delta: number };

export function azimuth(j: Jones): number {
  const { Ex, Ey, delta } = j;
  return 0.5 * Math.atan2(2 * Ex * Ey * Math.cos(delta), Ex * Ex - Ey * Ey);
}

export function ellipticity(j: Jones): number {
  const { Ex, Ey, delta } = j;
  const S0 = Ex * Ex + Ey * Ey;
  const S3 = 2 * Ex * Ey * Math.sin(delta);
  return 0.5 * Math.asin(S3 / Math.max(S0, 1e-9));
}

export function fieldAt(j: Jones, t: number): { ex: number; ey: number } {
  return {
    ex: j.Ex * Math.cos(t),
    ey: j.Ey * Math.cos(t + j.delta),
  };
}
