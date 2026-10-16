// Value casting and operator semantics of the source project's runtime.
// Generated game code calls these helpers for every dynamically typed operation.

import * as dm from './dmath.ts';

export type Value = string | number | boolean;

export function toNumber(v: Value | undefined | null): number {
  if (typeof v === 'number') return Number.isNaN(v) ? 0 : v;
  const n = Number(v);
  return Number.isNaN(n) ? 0 : n;
}

export function toBoolean(v: Value | undefined | null): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    return !(v === '' || v === '0' || v.toLowerCase() === 'false');
  }
  return Boolean(v);
}

export function toStr(v: Value | undefined | null): string {
  return String(v);
}

function isWhiteSpace(v: Value | undefined | null): boolean {
  return v === null || (typeof v === 'string' && v.trim().length === 0);
}

export function compare(v1: Value | undefined, v2: Value | undefined): number {
  let n1 = Number(v1);
  let n2 = Number(v2);
  if (n1 === 0 && isWhiteSpace(v1)) n1 = NaN;
  else if (n2 === 0 && isWhiteSpace(v2)) n2 = NaN;
  if (Number.isNaN(n1) || Number.isNaN(n2)) {
    const s1 = String(v1).toLowerCase();
    const s2 = String(v2).toLowerCase();
    if (s1 < s2) return -1;
    if (s1 > s2) return 1;
    return 0;
  }
  if ((n1 === Infinity && n2 === Infinity) || (n1 === -Infinity && n2 === -Infinity)) return 0;
  return n1 - n2;
}

export function eq(a: Value | undefined, b: Value | undefined): boolean {
  return compare(a, b) === 0;
}
export function lt(a: Value | undefined, b: Value | undefined): boolean {
  return compare(a, b) < 0;
}
export function gt(a: Value | undefined, b: Value | undefined): boolean {
  return compare(a, b) > 0;
}

export function isInt(v: Value | undefined): boolean {
  if (typeof v === 'number') return Number.isNaN(v) ? true : v === parseInt(String(v), 10);
  if (typeof v === 'boolean') return true;
  if (typeof v === 'string') return v.indexOf('.') < 0;
  return false;
}

export function add(a: Value, b: Value): number {
  return toNumber(a) + toNumber(b);
}
export function sub(a: Value, b: Value): number {
  return toNumber(a) - toNumber(b);
}
export function mul(a: Value, b: Value): number {
  return toNumber(a) * toNumber(b);
}
export function div(a: Value, b: Value): number {
  return toNumber(a) / toNumber(b);
}
export function mod(a: Value, b: Value): number {
  const n = toNumber(a);
  const m = toNumber(b);
  let r = n % m;
  if (r / m < 0) r += m;
  return r;
}
export function round(a: Value): number {
  return Math.round(toNumber(a));
}

export function and(a: Value | undefined, b: Value | undefined): boolean {
  return toBoolean(a) && toBoolean(b);
}
export function or(a: Value | undefined, b: Value | undefined): boolean {
  return toBoolean(a) || toBoolean(b);
}
export function not(a: Value | undefined): boolean {
  return !toBoolean(a);
}

export function join(a: Value | undefined, b: Value | undefined): string {
  return String(a) + String(b);
}

export function letterOf(index: Value, s: Value): string {
  const i = toNumber(index) - 1;
  const str = String(s);
  if (i < 0 || i >= str.length) return '';
  return str.charAt(i);
}

export function length(s: Value): number {
  return String(s).length;
}

export function contains(a: Value, b: Value): boolean {
  return String(a).toLowerCase().includes(String(b).toLowerCase());
}

export function mathop(op: string, v: Value): number {
  const n = toNumber(v);
  switch (op) {
    case 'abs': return Math.abs(n);
    case 'floor': return Math.floor(n);
    case 'ceiling': return Math.ceil(n);
    case 'sqrt': return Math.sqrt(n);
    case 'sin': return parseFloat(dm.sin((Math.PI * n) / 180).toFixed(10));
    case 'cos': return parseFloat(dm.cos((Math.PI * n) / 180).toFixed(10));
    case 'tan': return tan(n);
    case 'asin': return (dm.asin(n) * 180) / Math.PI;
    case 'acos': return (dm.acos(n) * 180) / Math.PI;
    case 'atan': return (dm.atan(n) * 180) / Math.PI;
    case 'ln': return dm.log(n);
    case 'log': return dm.log(n) / Math.LN10;
    case 'e ^': return dm.exp(n);
    case '10 ^': return Math.pow(10, n);
  }
  return 0;
}

function tan(angle: number): number {
  angle %= 360;
  switch (angle) {
    case -270:
    case 90:
      return Infinity;
    case -90:
    case 270:
      return -Infinity;
  }
  return parseFloat(dm.tan((Math.PI * angle) / 180).toFixed(10));
}

export const sin = (v: Value): number => parseFloat(dm.sin((Math.PI * toNumber(v)) / 180).toFixed(10));
export const cos = (v: Value): number => parseFloat(dm.cos((Math.PI * toNumber(v)) / 180).toFixed(10));
export const abs = (v: Value): number => Math.abs(toNumber(v));
export const floor = (v: Value): number => Math.floor(toNumber(v));
export const ceil = (v: Value): number => Math.ceil(toNumber(v));
export const sqrt = (v: Value): number => Math.sqrt(toNumber(v));

// ------------------------------------------------------------------ lists

const LIST_INVALID = -1;
const LIST_ALL = -2;
const LIST_ITEM_LIMIT = 200000;

/** Resolves a list index argument; `rand` supplies the random source for "random"/"any". */
function toListIndex(index: Value, len: number, acceptAll: boolean, rand: () => number): number {
  if (typeof index !== 'number') {
    if (index === 'all') return acceptAll ? LIST_ALL : LIST_INVALID;
    if (index === 'last') return len > 0 ? len : LIST_INVALID;
    if (index === 'random' || index === 'any') return len > 0 ? 1 + Math.floor(rand() * len) : LIST_INVALID;
  }
  const i = Math.floor(toNumber(index));
  if (i < 1 || i > len) return LIST_INVALID;
  return i;
}

let listRandom: () => number = () => {
  throw new Error('list random source not installed');
};
export function setListRandom(fn: () => number): void {
  listRandom = fn;
}

/** Fast path for the common case of a numeric or numeric-string index. */
export function item(list: Value[], index: Value): Value {
  if (typeof index === 'number') {
    const i = Math.floor(index);
    return i >= 1 && i <= list.length ? list[i - 1] : '';
  }
  const i = toListIndex(index, list.length, false, listRandom);
  return i === LIST_INVALID ? '' : list[i - 1];
}

export function replaceItem(list: Value[], index: Value, v: Value): void {
  const i = toListIndex(index, list.length, false, listRandom);
  if (i === LIST_INVALID) return;
  list[i - 1] = v;
}

export function addTo(list: Value[], v: Value): void {
  if (list.length < LIST_ITEM_LIMIT) list.push(v);
}

export function deleteOf(list: Value[], index: Value): void {
  const i = toListIndex(index, list.length, true, listRandom);
  if (i === LIST_INVALID) return;
  if (i === LIST_ALL) {
    list.length = 0;
    return;
  }
  list.splice(i - 1, 1);
}

export function deleteAll(list: Value[]): void {
  list.length = 0;
}

export function insertAt(list: Value[], index: Value, v: Value): void {
  const i = toListIndex(index, list.length + 1, false, listRandom);
  if (i === LIST_INVALID) return;
  if (i > LIST_ITEM_LIMIT) return;
  list.splice(i - 1, 0, v);
  if (list.length > LIST_ITEM_LIMIT) list.pop();
}

export function indexOf(list: Value[], v: Value): number {
  for (let i = 0; i < list.length; i++) {
    if (compare(list[i], v) === 0) return i + 1;
  }
  return 0;
}

export function listContains(list: Value[], v: Value): boolean {
  if (list.indexOf(v) >= 0) return true;
  for (let i = 0; i < list.length; i++) {
    if (compare(list[i], v) === 0) return true;
  }
  return false;
}

export function listContents(list: Value[]): string {
  let allSingle = true;
  for (const x of list) {
    if (!(typeof x === 'string' && x.length === 1)) {
      allSingle = false;
      break;
    }
  }
  return allSingle ? list.join('') : list.join(' ');
}

// ------------------------------------------------------------------ math helpers shared with the runtime

export function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max);
}

export function wrapClamp(n: number, min: number, max: number): number {
  const range = (max - min) + 1;
  return n - (Math.floor((n - min) / range) * range);
}

/**
 * The project's letter-by-letter split loop in one call. Words end at each letter equal to `sep`
 * (with `=` semantics); the text after the last separator is returned as `word` and is not added,
 * and `next` is the loop counter's final value ("1" when the input is empty).
 */
export function splitWords(input: Value, sep: Value, list: Value[]): { word: string; next: Value } {
  list.length = 0;
  const s = String(input);
  let word = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s.charAt(i);
    if (compare(ch, sep) !== 0) word += ch;
    else {
      if (list.length < LIST_ITEM_LIMIT) list.push(word);
      word = '';
    }
  }
  return { word, next: s.length === 0 ? '1' : s.length + 1 };
}

/** Short names used by generated code. */
export const num = toNumber;
export const bool = toBoolean;
