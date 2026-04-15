/**
 * Brand effect controls — tritone and blur always on.
 * Kept as a module so scenes can import getControls() without changes.
 */

export interface EchoControls {
  tritone: boolean;
  motionBlur: boolean;
}

const values: EchoControls = {
  tritone: true,
  motionBlur: true,
};

export function getControls(): EchoControls {
  return values;
}

export function setPlayer(player: any) {
  (window as any).__echoPlayer = player;
}

/** No-op — kept for scene compatibility. */
export function createControlPanel() {}
