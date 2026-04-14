/**
 * Floating control panel — tritone and blur toggles.
 */

export interface EchoControls {
  tritone: boolean;
  motionBlur: boolean;
}

let values: EchoControls = {
  tritone: true,
  motionBlur: false,
};

let panel: HTMLElement | null = null;

export function getControls(): EchoControls {
  return values;
}

export function setPlayer(player: any) {
  (window as any).__echoPlayer = player;
}

function emit() {
  const player = (window as any).__echoPlayer;
  if (player?.requestSeek) {
    const frame = player.playback?.frame ?? player.status?.frame ?? 0;
    player.requestSeek(frame);
  }
}

function toggle(
  label: string,
  getter: () => boolean,
  setter: (v: boolean) => void,
): HTMLElement {
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;align-items:center;gap:6px;margin:4px 0';

  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = getter();
  input.id = label.toLowerCase().replace(/\s/g, '-');
  input.addEventListener('change', () => {
    setter(input.checked);
    emit();
  });

  const lbl = document.createElement('label');
  lbl.textContent = label;
  lbl.htmlFor = input.id;
  lbl.style.cssText = 'font-size:12px;cursor:pointer';

  row.append(input, lbl);
  return row;
}

export function createControlPanel() {
  if (panel) return;

  panel = document.createElement('div');
  panel.style.cssText = `
    position:fixed;top:10px;right:10px;z-index:99999;
    background:#1a1a1a;color:#ccc;padding:8px 12px;
    border-radius:6px;font-family:system-ui;
    box-shadow:0 2px 10px rgba(0,0,0,0.4);
  `;

  panel.append(toggle('Tritone', () => values.tritone, v => { values.tritone = v; }));
  panel.append(toggle('Motion Blur', () => values.motionBlur, v => { values.motionBlur = v; }));

  document.body.append(panel);
}
