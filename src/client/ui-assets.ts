// Game costumes reused by the page's own screens, looked up by costume name.
import { allCostumes, skins } from '../game/assets.ts';
import { ASSET_BASE } from './game.ts';

const byName = new Map<string, string>();
for (const list of allCostumes) {
  for (const c of list) if (!byName.has(c.name)) byName.set(c.name, skins[c.skin].file);
}

function href(costume: string): string {
  const file = byName.get(costume);
  if (!file) throw new Error(`missing costume ${costume}`);
  return new URL(`${ASSET_BASE}${file}`, document.baseURI).href;
}

// Absolute, because a relative url() in a variable resolves against the stylesheet that reads it.
const url = (costume: string): string => `url("${href(costume)}")`;

/** Player colors, from the character select cursors. */
export const PLAYER_COLORS = ['#c14e4e', '#4e79c2', '#cec447', '#c24ead'];

export function playerBadge(seat: number): string {
  return href(`Cursor_P${seat + 1}`);
}

/** Sets the CSS variables the lobby and HUD styles read their images from. */
export function installUiAssets(root: HTMLElement): void {
  root.style.setProperty('--ui-menu-bg', url('MainMenu_BlackBG'));
  root.style.setProperty('--ui-clouds', url('MainMenu_Clouds'));
  root.style.setProperty('--ui-logo-gem', url('SFrT_Logo_GemAnim_1'));
  root.style.setProperty('--ui-logo-text', url('SFrT_Logo_TextAnim_14'));
  root.style.setProperty('--ui-return', url('CharSelect_ReturnButton'));
  root.style.setProperty('--ui-controls', url('MainMenu_ControlsButton'));
  PLAYER_COLORS.forEach((c, i) => root.style.setProperty(`--p${i + 1}`, c));
}
