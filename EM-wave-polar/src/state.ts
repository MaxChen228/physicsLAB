export type State = {
  Ex: number;
  Ey: number;
  delta: number;
  paused: boolean;
  timeScale: number;
};

const listeners = new Set<(s: State) => void>();

let state: State = {
  Ex: 1,
  Ey: 1,
  delta: Math.PI / 2,
  paused: false,
  timeScale: 0.3,
};

export const getState = (): State => state;

export const setState = (patch: Partial<State>): void => {
  state = { ...state, ...patch };
  for (const fn of listeners) fn(state);
};

export const subscribe = (fn: (s: State) => void): (() => void) => {
  listeners.add(fn);
  fn(state);
  return () => {
    listeners.delete(fn);
  };
};
