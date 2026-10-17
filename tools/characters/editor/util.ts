// Shared helpers for the mod maker: the pack store, DOM building, images, sounds and frame timing.
import { createElement, type IconNode } from 'lucide';
import { SPEEDS, type CharacterPack, type SoundFile } from '../../../src/game/pack-format.ts';
import type { Problem } from '../../../src/game/pack-validate.ts';
import { browserStore } from './store.ts';

export type { Problem };

export interface PackSummary {
  slug: string;
  name: string;
  template: string | null;
}

/** Where packs are kept. A pack's dir is its slug, or _templates/<slug> and _examples/<slug> for the read-only ones. */
export interface Store {
  /** True when packs are kept in this browser instead of the project's characters/ folder. */
  browser: boolean;
  list(): Promise<{ packs: PackSummary[]; templates: { slug: string; name: string }[]; examples: { slug: string; name: string }[] }>;
  pack(dir: string): Promise<{ pack: CharacterPack; problems: Problem[]; readOnly: boolean }>;
  save(dir: string, pack: CharacterPack): Promise<{ problems: Problem[] }>;
  create(name: string, slug: string, from: string): Promise<{ slug: string }>;
  remove(dir: string): Promise<void>;
  put(dir: string, path: string, data: Blob | string): Promise<{ ok: true }>;
  exists(dir: string, path: string): Promise<boolean>;
  text(dir: string, path: string): Promise<string | null>;
  /** A URL that shows a pack file now. */
  fileUrl(dir: string, path: string): string;
  /** Marks every pack file as changed, so images load again instead of from the browser's cache. */
  changed(): void;
  gimmick(dir: string): Promise<{ file: string; path: string }>;
  unused(dir: string, remove: boolean): Promise<{ files: string[] }>;
  importZip(file: File): Promise<{ slug: string }>;
  exportZip(dir: string): Promise<void>;
  /** Makes the pack playable: a site build in the project, or a mod in this browser. */
  play(dir: string): Promise<{ ok: boolean; output: string }>;
}

const BASE = '/__characters';
const q = (o: Record<string, string>) => new URLSearchParams(o).toString();

async function call<T>(method: string, path: string, body?: BodyInit): Promise<T> {
  const r = await fetch(BASE + path, { method, body });
  const v = (await r.json()) as T & { error?: string };
  if (!r.ok) throw new Error(v.error ?? r.statusText);
  return v;
}

let version = Date.now();

const serverStore: Store = {
  browser: false,
  list: () => call('GET', '/list'),
  pack: (dir) => call('GET', `/pack?${q({ dir })}`),
  save: (dir, pack) => call('PUT', `/pack?${q({ dir })}`, JSON.stringify(pack)),
  create: (name, slug, from) => call('POST', '/new', JSON.stringify({ name, slug, from })),
  remove: () => Promise.reject(new Error('Delete the folder under characters/ instead.')),
  put: (dir, path, data) => call('PUT', `/file?${q({ dir, path })}`, data),
  exists: (dir, path) => call<{ exists: boolean }>('GET', `/exists?${q({ dir, path })}`).then((r) => r.exists),
  text: (dir, path) => fetch(`${BASE}/file?${q({ dir, path })}`).then((r) => (r.ok ? r.text() : null)),
  fileUrl: (dir, path) => `${BASE}/file?${q({ dir, path, v: String(version) })}`,
  changed: () => (version = Date.now()),
  gimmick: (dir) => call('POST', `/gimmick?${q({ dir })}`),
  unused: (dir, remove) => call(remove ? 'POST' : 'GET', `/unused?${q({ dir })}`),
  importZip: (file) => call('POST', '/import', file),
  exportZip: async (dir) => void (location.href = `${BASE}/export?${q({ dir })}`),
  play: () => call('POST', '/build'),
};

/** The development server's endpoints edit the project's files. The published site, and ?browser in development, use the browser. */
export const api: Store = !import.meta.env.DEV || new URLSearchParams(location.search).has('browser') ? browserStore : serverStore;

export const bumpVersion = () => api.changed();
export const fileUrl = (dir: string, path: string) => api.fileUrl(dir, path);

/** The guide to making characters, for players without the project. */
export const GUIDE_URL = 'https://github.com/MapleSugarstone/TSSFRT/blob/main/characters/README.md';

type Child = Node | string | number | null | undefined | false;
type Props = Record<string, unknown> & { class?: string; style?: string };

/** Creates an element. Props starting with "on" become listeners and the rest become properties or attributes. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props | null = null, ...children: (Child | Child[])[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'class') el.className = String(v);
    else if (k === 'style') el.setAttribute('style', String(v));
    else if (k in el && !k.includes('-')) (el as unknown as Record<string, unknown>)[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : String(c));
  if (el instanceof HTMLButtonElement) iconOnly(el);
  return el;
}

/** Shows only a button's icon and moves its label into the tooltip. */
function iconOnly(el: HTMLButtonElement): void {
  if (!el.querySelector(':scope > svg.icon')) return;
  const label = [...el.childNodes]
    .filter((n) => !(n instanceof SVGElement))
    .map((n) => n.textContent)
    .join('')
    .trim();
  for (const n of [...el.childNodes]) if (!(n instanceof SVGElement)) n.remove();
  if (!label) return;
  el.setAttribute('aria-label', label);
  const t = el.title;
  el.title = !t || t === label ? label : t.toLowerCase().startsWith(label.toLowerCase()) ? t : `${label}: ${t}`;
}

/** Changes an icon button's icon and name. */
export function setButton(el: HTMLButtonElement, node: IconNode, label: string): void {
  el.replaceChildren(icon(node));
  el.title = label;
  el.setAttribute('aria-label', label);
}

export function icon(node: IconNode): SVGElement {
  return createElement(node, { width: 16, height: 16, class: 'icon', 'aria-hidden': 'true' });
}

/** A button with an icon in front of its label. */
export function button(node: IconNode | null, label: string, onclick: (e: MouseEvent) => void, props: Props = {}): HTMLButtonElement {
  return h('button', { title: label || undefined, ...props, onclick }, node ? icon(node) : null, label ? h('span', null, label) : null);
}

/** Replaces an element's children, skipping empty values. */
export function fill(el: Element, ...children: (Child | Child[])[]): void {
  el.replaceChildren(...children.flat().filter((c): c is Node | string | number => c !== null && c !== undefined && c !== false).map((c) => (c instanceof Node ? c : String(c))));
}

/** A labeled form row. */
export const field = (label: string, input: HTMLElement, help = '') => h('label', { class: 'field', title: help }, h('span', null, label), input);

export function numberInput(value: unknown, onChange: (v: number | string) => void, step = 'any'): HTMLInputElement {
  return h('input', {
    type: 'number',
    step,
    value: String(value ?? ''),
    onchange: (e: Event) => {
      const t = (e.target as HTMLInputElement).value;
      onChange(t === '' || Number.isNaN(Number(t)) ? t : Number(t));
    },
  });
}

export function textInput(value: string, onChange: (v: string) => void, multiline = false): HTMLInputElement | HTMLTextAreaElement {
  const props = { value, onchange: (e: Event) => onChange((e.target as HTMLInputElement).value) };
  return multiline ? h('textarea', { ...props, rows: 3 }) : h('input', { ...props, type: 'text' });
}

export const randomId = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');
export const pad2 = (n: number) => String(n).padStart(2, '0');

export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`could not load ${url}`));
    img.src = url;
  });
}

export function canvas(w: number, h0: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, w);
  c.height = Math.max(1, h0);
  return c;
}

export const ctx2d = (c: HTMLCanvasElement) => c.getContext('2d', { willReadFrequently: true })!;

export function toBlob(c: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('could not encode image'))), 'image/png'));
}

/** Picks a file from the user's computer. */
export function pickFile(accept: string, multiple = false): Promise<File[]> {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept, multiple });
    input.addEventListener('change', () => resolve([...(input.files ?? [])]));
    input.click();
  });
}

/** The sample rate and length the game needs for a sound file. */
export async function soundInfo(file: Blob): Promise<{ rate: number; sampleCount: number }> {
  const buf = await new OfflineAudioContext(1, 1, 48000).decodeAudioData(await file.arrayBuffer());
  return { rate: buf.sampleRate, sampleCount: buf.length };
}

/** Uploads a sound into a pack and returns its pack entry. */
export async function uploadSound(dir: string, file: File, base: string): Promise<SoundFile> {
  const info = await soundInfo(file);
  const ext = (/\.[a-z0-9]+$/i.exec(file.name)?.[0] ?? '.wav').toLowerCase();
  const path = `sounds/${base}-${randomId()}${ext}`;
  await api.put(dir, path, file);
  return { file: path, ...info };
}

export function playSound(dir: string, path: string): void {
  void new Audio(fileUrl(dir, path)).play();
}

/** Game frames that one animation frame with this speed code lasts, counted the way the game advances frames. */
export function frameTicks(speed: number): number {
  const step = SPEEDS[speed] ?? 1;
  let f = 0;
  let n = 0;
  do {
    f += step;
    n++;
  } while (!(f > 1) && n < 1000);
  return n;
}

/** Milliseconds per game frame. */
export const FRAME_MS = 33;

export const SPEED_LABELS: Record<number, string> = Object.fromEntries(Object.keys(SPEEDS).map((k) => [k, `${k}: ${frameTicks(Number(k))} game frames`]));

export function speedSelect(value: number, onChange: (v: number) => void): HTMLSelectElement {
  return h(
    'select',
    { onchange: (e: Event) => onChange(Number((e.target as HTMLSelectElement).value)) },
    Object.keys(SPEEDS)
      .map(Number)
      .sort((a, b) => frameTicks(a) - frameTicks(b))
      .map((k) => h('option', { value: String(k), selected: k === value }, SPEED_LABELS[k])),
  );
}

export function toast(message: string, error = false): void {
  const el = h('div', { class: `toast${error ? ' error' : ''}` }, message);
  document.body.append(el);
  setTimeout(() => el.remove(), error ? 6000 : 2500);
}
