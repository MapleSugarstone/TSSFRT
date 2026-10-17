import type { Runtime } from '../engine/runtime.ts';

/** Sprite name -> per-costume 1-bit alpha masks (base64, LSB first). */
export type SilhouetteData = Record<string, { w: number; h: number; bits: string }[]>;

function decodeBase64(s: string): Uint8Array {
  if (typeof atob === 'function') {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(s, 'base64'));
}

/** Installs masks given by skin number (the character packs' new menu images). */
export function installSkinSilhouettes(rt: Runtime, masks: Record<number, { w: number; h: number; bits: string }>): void {
  for (const [skin, entry] of Object.entries(masks)) {
    const bits = decodeBase64(entry.bits);
    const alpha = new Uint8Array(entry.w * entry.h);
    for (let p = 0; p < alpha.length; p++) alpha[p] = (bits[p >> 3] >> (p & 7)) & 1;
    rt.render.silhouettes[Number(skin)] = { w: entry.w, h: entry.h, alpha };
  }
}

export function installSilhouettes(rt: Runtime, data: SilhouetteData): void {
  for (const sprite of rt.sprites) {
    const list = data[sprite.name];
    if (!list) continue;
    sprite.costumes.forEach((c, i) => {
      const entry = list[i];
      if (!entry) return;
      const bits = decodeBase64(entry.bits);
      const alpha = new Uint8Array(entry.w * entry.h);
      for (let p = 0; p < alpha.length; p++) alpha[p] = (bits[p >> 3] >> (p & 7)) & 1;
      rt.render.silhouettes[c.skin] = { w: entry.w, h: entry.h, alpha };
    });
  }
}
