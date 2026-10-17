// A floating window that shows a reference image while painting. It can be moved by its title bar,
// resized from its corner, and keeps its image between paint sessions.
import { Crosshair, Image as ImageIcon, X, ZoomIn, ZoomOut } from 'lucide';
import { button, h, pickFile } from './util.ts';

let url: string | null = null;
let zoom = 0;
let place = { x: 80, y: 80, w: 320, h: 300 };
let win: HTMLDivElement | null = null;

export function toggleReference(currentFrame: () => HTMLCanvasElement): void {
  if (win) return closeReference();
  const img = h('img', { class: 'ref-image', draggable: false });
  const empty = h('p', { class: 'hint' }, 'Open an image file, or keep a copy of the current frame here.');
  const view = h('div', { class: 'ref-view' }, img, empty);
  const size = () => {
    img.style.width = zoom ? `${img.naturalWidth * zoom}px` : '';
    img.classList.toggle('fit', !zoom);
  };
  const show = () => {
    img.hidden = !url;
    empty.hidden = !!url;
    if (url && img.getAttribute('src') !== url) img.src = url;
    size();
  };
  img.addEventListener('load', size);
  const setUrl = (u: string) => {
    if (url?.startsWith('blob:')) URL.revokeObjectURL(url);
    url = u;
    zoom = 0;
    show();
  };
  const bar = h(
    'div',
    { class: 'ref-bar' },
    h('strong', null, 'Reference'),
    h('span', { class: 'grow' }),
    button(ImageIcon, '', async () => {
      const [f] = await pickFile('image/*');
      if (f) setUrl(URL.createObjectURL(f));
    }, { title: 'Open an image file' }),
    button(Crosshair, '', () => setUrl(currentFrame().toDataURL()), { title: 'Keep a copy of the current frame' }),
    button(ZoomOut, '', () => ((zoom = Math.max(0, (zoom || 1) - 1)), show()), { title: 'Zoom out (0 fits the window)' }),
    button(ZoomIn, '', () => ((zoom = (zoom || 1) + 1), show()), { title: 'Zoom in' }),
    button(X, '', closeReference, { title: 'Close' }),
  );
  win = h('div', { class: 'ref-window', style: `left:${place.x}px; top:${place.y}px; width:${place.w}px; height:${place.h}px` }, bar, view);
  let drag: [number, number] | null = null;
  bar.addEventListener('pointerdown', (e) => {
    if ((e.target as HTMLElement).closest('button')) return;
    drag = [e.clientX - win!.offsetLeft, e.clientY - win!.offsetTop];
    bar.setPointerCapture(e.pointerId);
  });
  bar.addEventListener('pointermove', (e) => {
    if (!drag || !win) return;
    win.style.left = `${Math.max(0, e.clientX - drag[0])}px`;
    win.style.top = `${Math.max(0, e.clientY - drag[1])}px`;
  });
  bar.addEventListener('pointerup', () => (drag = null));
  view.addEventListener('dragover', (e) => e.preventDefault());
  view.addEventListener('drop', (e) => {
    e.preventDefault();
    const f = e.dataTransfer?.files[0];
    if (f?.type.startsWith('image/')) setUrl(URL.createObjectURL(f));
  });
  document.body.append(win);
  show();
}

export function closeReference(): void {
  if (!win) return;
  place = { x: win.offsetLeft, y: win.offsetTop, w: win.offsetWidth, h: win.offsetHeight };
  win.remove();
  win = null;
}
