// Renderer geometry that affects simulation state: bounds, fencing, stamp clipping and touching.
// It works from costume metadata only, so it runs the same in a browser and in Node.
import type { SkinDef } from './defs.ts';
import { cos, sin } from './dmath.ts';
import type { Target } from './target.ts';

const FENCE_WIDTH = 15;
const X_RIGHT = 240;
const Y_TOP = 180;

export interface Rect {
  left: number;
  right: number;
  bottom: number;
  top: number;
}

/** Alpha mask of one costume at the renderer's 1x mip, used for touching tests. */
export interface Silhouette {
  w: number;
  h: number;
  /** One byte per pixel, nonzero where alpha > 0. */
  alpha: Uint8Array;
}

/** Affine model transform of a drawable, as the renderer builds it. */
interface Model {
  m0: number;
  m1: number;
  m4: number;
  m5: number;
  m12: number;
  m13: number;
}

export class RenderModel {
  skins: SkinDef[];
  silhouettes: (Silhouette | undefined)[] = [];

  constructor(skins: SkinDef[]) {
    this.skins = skins;
  }

  skinOf(t: Target): SkinDef {
    return this.skins[t.sprite.costumes[t.currentCostume].skin];
  }

  /**
   * Model transform with the original renderer's 32-bit float storage reproduced at every step,
   * since bounds and fencing round differently otherwise.
   */
  model(t: Target): Model {
    const f = Math.fround;
    const skin = this.skinOf(t);
    const dir = t.renderedDirection();
    const sx = f(t.renderedScaleX());
    const sy = f(t.size);
    const rotation = ((270 - dir) * Math.PI) / 180;
    const cd = cos(rotation);
    const sd = sin(rotation);
    const r00 = f(cd);
    const r01 = f(sd);
    const r10 = f(-sd);
    const r11 = f(cd);
    const rcx = f(skin.rcx);
    const rcy = f(skin.rcy);
    const adj0 = f(((rcx - skin.w / 2) * sx) / 100);
    const adj1 = f((((rcy - skin.h / 2) * sy) / 100) * -1);
    const scale0 = f((skin.w * sx) / 100);
    const scale1 = f((skin.h * sy) / 100);
    const px = f(t.drawX);
    const py = f(t.drawY);
    return {
      m0: f(scale0 * r00),
      m1: f(scale0 * r01),
      m4: f(scale1 * r10),
      m5: f(scale1 * r11),
      m12: f(r00 * adj0 + r10 * adj1 + px),
      m13: f(r01 * adj0 + r11 * adj1 + py),
    };
  }

  aabb(t: Target): Rect {
    const m = this.model(t);
    const x = Math.abs(0.5 * m.m0) + Math.abs(0.5 * m.m4);
    const y = Math.abs(0.5 * m.m1) + Math.abs(0.5 * m.m5);
    return { left: -x + m.m12, right: x + m.m12, top: y + m.m13, bottom: -y + m.m13 };
  }

  /** Keeps at least a small part of the sprite on stage, like the original renderer. */
  fencedPosition(t: Target, x: number, y: number): [number, number] {
    const px = t.drawX;
    const py = t.drawY;
    const dx = x - px;
    const dy = y - py;
    const aabb = this.aabb(t);
    const inset = Math.floor(Math.min(Math.abs(aabb.left - aabb.right), Math.abs(aabb.top - aabb.bottom)) / 2);
    const sx = X_RIGHT - Math.min(FENCE_WIDTH, inset);
    if (aabb.right + dx < -sx) x = Math.ceil(px - (sx + aabb.right));
    else if (aabb.left + dx > sx) x = Math.floor(px + (sx - aabb.left));
    const sy = Y_TOP - Math.min(FENCE_WIDTH, inset);
    if (aabb.top + dy < -sy) y = Math.ceil(py - (sy + aabb.top));
    else if (aabb.bottom + dy > sy) y = Math.floor(py + (sy - aabb.bottom));
    return [x, y];
  }

  /** Stage-clamped, integer-snapped bounds; null when empty. Stamps are clipped to these. */
  touchingBounds(t: Target): Rect | null {
    const b = this.aabb(t);
    clampRect(b, -X_RIGHT, X_RIGHT, -Y_TOP, Y_TOP);
    snapToInt(b);
    if (Math.abs(b.left - b.right) === 0 || Math.abs(b.top - b.bottom) === 0) return null;
    return b;
  }

  // ---------------------------------------------------------------- touching

  /** Stage point to skin texture coordinates, reproducing the renderer's 32-bit float storage. */
  private localPoint(t: Target, x: number, y: number): Float32Array {
    const m = this.model(t);
    const M = new Float32Array(16);
    M[0] = m.m0;
    M[1] = m.m1;
    M[4] = m.m4;
    M[5] = m.m5;
    M[10] = 1;
    M[12] = m.m12;
    M[13] = m.m13;
    M[15] = 1;
    const inv = inverse4(M);
    const lp = new Float32Array(2);
    const d = x * inv[3] + y * inv[7] + inv[15];
    lp[0] = 0.5 - (x * inv[0] + y * inv[4] + inv[12]) / d;
    lp[1] = (x * inv[1] + y * inv[5] + inv[13]) / d + 0.5;
    if (Math.abs(lp[0]) < 1e-6) lp[0] = 0;
    if (Math.abs(lp[1]) < 1e-6) lp[1] = 0;
    const fx = t.effects;
    const anyEffect = fx.color || fx.fisheye || fx.whirl || fx.pixelate || fx.mosaic || fx.brightness || fx.ghost;
    if (anyEffect && lp[0] >= 0 && lp[0] < 1 && lp[1] >= 0 && lp[1] < 1) this.effectTransform(t, lp);
    return lp;
  }

  private effectTransform(t: Target, dst: Float32Array): void {
    if (t.effects.pixelate) {
      const skin = this.skinOf(t);
      const p = Math.abs(t.effects.pixelate) / 10;
      const tx = skin.w / p;
      const ty = skin.h / p;
      dst[0] = (Math.floor(dst[0] * tx) + 0.5) / tx;
      dst[1] = (Math.floor(dst[1] * ty) + 0.5) / ty;
    }
    if (t.effects.whirl) {
      const whirl = (-t.effects.whirl * Math.PI) / 180;
      const ox = dst[0] - 0.5;
      const oy = dst[1] - 0.5;
      const mag = Math.sqrt(ox * ox + oy * oy);
      const factor = Math.max(1.0 - mag / 0.5, 0.0);
      const actual = whirl * factor * factor;
      const s = sin(actual);
      const c = cos(actual);
      dst[0] = c * ox + s * oy + 0.5;
      dst[1] = -s * ox + c * oy + 0.5;
    }
  }

  private useNearest(t: Target): boolean {
    const skin = this.skinOf(t);
    if (skin.kind === 'bitmap') return true;
    if (t.effects.whirl !== 0 || t.effects.pixelate !== 0 || t.effects.fisheye !== 0 || t.effects.mosaic !== 0) return false;
    if (t.renderedDirection() % 90 !== 0) return false;
    const sx = Math.abs(Math.fround(t.renderedScaleX()));
    const sy = Math.abs(Math.fround(t.size));
    return sx > 99 && sx < 101 && sy > 99 && sy < 101;
  }

  private pointTouching(t: Target, x: number, y: number): boolean {
    const sil = this.silhouettes[t.sprite.costumes[t.currentCostume].skin];
    if (!sil) return false;
    const lp = this.localPoint(t, x, y);
    const px = Math.floor(lp[0] * (sil.w - 1));
    const py = Math.floor(lp[1] * (sil.h - 1));
    if (this.useNearest(t)) return alphaAt(sil, px, py);
    return alphaAt(sil, px, py) || alphaAt(sil, px + 1, py) || alphaAt(sil, px, py + 1) || alphaAt(sil, px + 1, py + 1);
  }

  /** Touch test against a single stage point; visibility is not checked, as in the original. */
  touchingPoint(t: Target, x: number, y: number): boolean {
    return this.pointTouching(t, x, y);
  }

  /** Pixel-level overlap between `t` and any visible candidate. */
  touchingTargets(t: Target, candidates: Target[]): boolean {
    const self = this.touchingBounds(t);
    if (!self) return false;
    const hits: Rect[] = [];
    const hitTargets: Target[] = [];
    for (let i = candidates.length - 1; i >= 0; i--) {
      const c = candidates[i];
      if (c === t || !c.visible) continue;
      const cb = this.aabb(c);
      snapToInt(cb);
      if (self.left <= cb.right && cb.left <= self.right && self.top >= cb.bottom && cb.top >= self.bottom) {
        hits.push({
          left: Math.max(self.left, cb.left),
          right: Math.min(self.right, cb.right),
          top: Math.min(self.top, cb.top),
          bottom: Math.max(self.bottom, cb.bottom),
        });
        hitTargets.push(c);
      }
    }
    if (hits.length === 0 || !t.visible) return false;
    const b = hits.reduce((m, r) => ({
      left: Math.min(m.left, r.left),
      right: Math.max(m.right, r.right),
      top: Math.max(m.top, r.top),
      bottom: Math.min(m.bottom, r.bottom),
    }));
    for (let x = b.left; x <= b.right; x++) {
      for (let y = b.bottom; y <= b.top; y++) {
        if (this.pointTouching(t, x, y)) {
          for (const c of hitTargets) {
            if (this.pointTouching(c, x, y)) return true;
          }
        }
      }
    }
    return false;
  }
}

/** General 4x4 inverse in the same operation order as the renderer's matrix library, stored as float32. */
function inverse4(m: Float32Array): Float32Array {
  const dst = new Float32Array(16);
  const m00 = m[0], m01 = m[1], m02 = m[2], m03 = m[3];
  const m10 = m[4], m11 = m[5], m12 = m[6], m13 = m[7];
  const m20 = m[8], m21 = m[9], m22 = m[10], m23 = m[11];
  const m30 = m[12], m31 = m[13], m32 = m[14], m33 = m[15];
  const tmp0 = m22 * m33, tmp1 = m32 * m23, tmp2 = m12 * m33, tmp3 = m32 * m13;
  const tmp4 = m12 * m23, tmp5 = m22 * m13, tmp6 = m02 * m33, tmp7 = m32 * m03;
  const tmp8 = m02 * m23, tmp9 = m22 * m03, tmp10 = m02 * m13, tmp11 = m12 * m03;
  const tmp12 = m20 * m31, tmp13 = m30 * m21, tmp14 = m10 * m31, tmp15 = m30 * m11;
  const tmp16 = m10 * m21, tmp17 = m20 * m11, tmp18 = m00 * m31, tmp19 = m30 * m01;
  const tmp20 = m00 * m21, tmp21 = m20 * m01, tmp22 = m00 * m11, tmp23 = m10 * m01;
  const t0 = (tmp0 * m11 + tmp3 * m21 + tmp4 * m31) - (tmp1 * m11 + tmp2 * m21 + tmp5 * m31);
  const t1 = (tmp1 * m01 + tmp6 * m21 + tmp9 * m31) - (tmp0 * m01 + tmp7 * m21 + tmp8 * m31);
  const t2 = (tmp2 * m01 + tmp7 * m11 + tmp10 * m31) - (tmp3 * m01 + tmp6 * m11 + tmp11 * m31);
  const t3 = (tmp5 * m01 + tmp8 * m11 + tmp11 * m21) - (tmp4 * m01 + tmp9 * m11 + tmp10 * m21);
  const d = 1.0 / (m00 * t0 + m10 * t1 + m20 * t2 + m30 * t3);
  dst[0] = d * t0;
  dst[1] = d * t1;
  dst[2] = d * t2;
  dst[3] = d * t3;
  dst[4] = d * ((tmp1 * m10 + tmp2 * m20 + tmp5 * m30) - (tmp0 * m10 + tmp3 * m20 + tmp4 * m30));
  dst[5] = d * ((tmp0 * m00 + tmp7 * m20 + tmp8 * m30) - (tmp1 * m00 + tmp6 * m20 + tmp9 * m30));
  dst[6] = d * ((tmp3 * m00 + tmp6 * m10 + tmp11 * m30) - (tmp2 * m00 + tmp7 * m10 + tmp10 * m30));
  dst[7] = d * ((tmp4 * m00 + tmp9 * m10 + tmp10 * m20) - (tmp5 * m00 + tmp8 * m10 + tmp11 * m20));
  dst[8] = d * ((tmp12 * m13 + tmp15 * m23 + tmp16 * m33) - (tmp13 * m13 + tmp14 * m23 + tmp17 * m33));
  dst[9] = d * ((tmp13 * m03 + tmp18 * m23 + tmp21 * m33) - (tmp12 * m03 + tmp19 * m23 + tmp20 * m33));
  dst[10] = d * ((tmp14 * m03 + tmp19 * m13 + tmp22 * m33) - (tmp15 * m03 + tmp18 * m13 + tmp23 * m33));
  dst[11] = d * ((tmp17 * m03 + tmp20 * m13 + tmp23 * m23) - (tmp16 * m03 + tmp21 * m13 + tmp22 * m23));
  dst[12] = d * ((tmp14 * m22 + tmp17 * m32 + tmp13 * m12) - (tmp16 * m32 + tmp12 * m12 + tmp15 * m22));
  dst[13] = d * ((tmp20 * m32 + tmp12 * m02 + tmp19 * m22) - (tmp18 * m22 + tmp21 * m32 + tmp13 * m02));
  dst[14] = d * ((tmp18 * m12 + tmp23 * m32 + tmp15 * m02) - (tmp22 * m32 + tmp14 * m02 + tmp19 * m12));
  dst[15] = d * ((tmp22 * m22 + tmp16 * m02 + tmp21 * m12) - (tmp20 * m12 + tmp23 * m22 + tmp17 * m02));
  return dst;
}

function alphaAt(s: Silhouette, x: number, y: number): boolean {
  if (x >= s.w || y >= s.h || x < 0 || y < 0) return false;
  return s.alpha[y * s.w + x] !== 0;
}

export function clampRect(r: Rect, left: number, right: number, bottom: number, top: number): void {
  r.left = Math.max(r.left, left);
  r.right = Math.min(r.right, right);
  r.bottom = Math.max(r.bottom, bottom);
  r.top = Math.min(r.top, top);
  r.left = Math.min(r.left, right);
  r.right = Math.max(r.right, left);
  r.bottom = Math.min(r.bottom, top);
  r.top = Math.max(r.top, bottom);
}

export function snapToInt(r: Rect): void {
  r.left = Math.floor(r.left);
  r.right = Math.ceil(r.right);
  r.bottom = Math.floor(r.bottom);
  r.top = Math.ceil(r.top);
}
