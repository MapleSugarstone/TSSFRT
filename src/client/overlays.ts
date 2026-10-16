// HTML overlays the game needs on top of the canvas: the question box and list monitors.
import type { Runtime } from '../engine/runtime.ts';
import type { Monitors } from '../engine/defs.ts';
import type { Value } from '../engine/cast.ts';

export class QuestionBox {
  private el: HTMLDivElement;
  private label: HTMLDivElement;
  private input: HTMLInputElement;
  private shownFor: unknown = null;
  /** Text submitted since the last frame, taken by the next simulation input. */
  pendingAnswer: string | undefined;
  onFocusChange?: (focused: boolean) => void;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'question';
    this.label = document.createElement('div');
    this.label.className = 'question-text';
    const row = document.createElement('div');
    row.className = 'question-row';
    this.input = document.createElement('input');
    this.input.type = 'text';
    const ok = document.createElement('button');
    ok.textContent = '✔';
    ok.setAttribute('aria-label', 'Submit answer');
    row.append(this.input, ok);
    this.el.append(this.label, row);
    this.el.hidden = true;
    parent.append(this.el);
    const submit = () => {
      this.pendingAnswer = this.input.value;
      this.input.value = '';
    };
    ok.addEventListener('click', submit);
    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') submit();
    });
    this.input.addEventListener('keyup', (e) => e.stopPropagation());
    this.input.addEventListener('focus', () => this.onFocusChange?.(true));
    this.input.addEventListener('blur', () => this.onFocusChange?.(false));
  }

  update(rt: Runtime): void {
    const q = rt.questions[0];
    if (!q) {
      if (!this.el.hidden) {
        this.el.hidden = true;
        this.shownFor = null;
        this.input.blur();
      }
      return;
    }
    if (this.shownFor !== q) {
      this.shownFor = q;
      this.label.textContent = q.text;
      this.el.hidden = false;
      this.input.focus();
    }
  }
}

export class ListMonitors {
  private els = new Map<string, { root: HTMLDivElement; body: HTMLDivElement; footer: HTMLDivElement; last: string }>();

  constructor(private parent: HTMLElement, private defs: Monitors) {}

  update(rt: Runtime): void {
    for (const d of this.defs.lists) {
      const visible = rt.monitorVisible[d.prop] ?? d.visible;
      let m = this.els.get(d.prop);
      if (!visible) {
        if (m) m.root.hidden = true;
        continue;
      }
      if (!m) {
        const root = document.createElement('div');
        root.className = 'list-monitor';
        root.style.left = `${(d.x / 480) * 100}%`;
        root.style.top = `${(d.y / 360) * 100}%`;
        root.style.width = `${(d.width / 480) * 100}%`;
        root.style.height = `${(d.height / 360) * 100}%`;
        const header = document.createElement('div');
        header.className = 'list-header';
        header.textContent = d.label;
        const body = document.createElement('div');
        body.className = 'list-body';
        const footer = document.createElement('div');
        footer.className = 'list-footer';
        root.append(header, body, footer);
        this.parent.append(root);
        m = { root, body, footer, last: '' };
        this.els.set(d.prop, m);
      }
      m.root.hidden = false;
      const items: Value[] = rt.stage.l[d.prop];
      const key = JSON.stringify(items);
      if (key !== m.last) {
        m.last = key;
        m.body.replaceChildren(
          ...items.map((v, i) => {
            const row = document.createElement('div');
            row.className = 'list-row';
            const idx = document.createElement('span');
            idx.className = 'list-index';
            idx.textContent = String(i + 1);
            const val = document.createElement('span');
            val.className = 'list-value';
            val.textContent = String(v);
            row.append(idx, val);
            return row;
          }),
        );
        m.footer.textContent = `length ${items.length}`;
      }
    }
  }
}
