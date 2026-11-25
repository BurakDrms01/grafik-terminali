// Nesne ağacı: grafikteki göstergeler ve çizimler tek listede (TradingView'daki "Nesne ağacı" paneli).
import type { Drawings } from '../chart/drawings.ts';
import type { Indicators } from '../chart/indicators.ts';
import { clear, h } from './dom.ts';

const svg = (d: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const EYE = svg('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>');
const EYE_OFF = svg('<path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6A17 17 0 0 0 2 12s3.6 7 10 7a9.6 9.6 0 0 0 5.4-1.6"/>');
const LOCK = svg('<rect x="5" y="11" width="14" height="9" rx="1.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>');
const UNLOCK = svg('<rect x="5" y="11" width="14" height="9" rx="1.5"/><path d="M8 11V8a4 4 0 0 1 7.5-2"/>');
const GEAR = svg('<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>');
const TRASH = svg('<path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13M10 11v5M14 11v5"/>');
const FX = svg('<path d="M10 4.5c-2 0-2.5 1.2-2.8 3L5.5 19.5M4.5 10h6M13 10l6 8M19 10l-6 8"/>');

export class ObjectTree {
  private pending = false;

  constructor(
    private readonly el: HTMLElement,
    private readonly drawings: Drawings,
    private readonly indicators: Indicators,
    private readonly isOpen: () => boolean,
  ) {
    drawings.onListChange = () => this.schedule();
    indicators.onChange = () => this.schedule();
  }

  /** Aynı karede gelen birden çok değişikliği tek çizime indirir; panel kapalıyken çizmez. */
  schedule(): void {
    if (this.pending) return;
    this.pending = true;
    requestAnimationFrame(() => {
      this.pending = false;
      if (this.isOpen()) this.render();
    });
  }

  private iconBtn(html: string, title: string, onClick: () => void, active = false): HTMLButtonElement {
    const b = h('button', { class: `ot-btn${active ? ' active' : ''}`, title, 'aria-label': title, html });
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      onClick();
    });
    return b;
  }

  render(): void {
    clear(this.el);
    this.el.append(h('div', { class: 'panel-head' }, h('span', { class: 'title', text: 'Nesne ağacı' })));
    const body = h('div', { class: 'panel-body ot-body' });

    const inds = this.indicators.list();
    body.append(h('div', { class: 'ot-section', text: `Göstergeler · ${inds.length}` }));
    if (inds.length === 0) body.append(h('div', { class: 'ot-empty', text: 'Gösterge yok.' }));
    for (const it of inds) {
      body.append(
        h(
          'div',
          { class: `ot-row${it.hidden ? ' is-hidden' : ''}` },
          h('span', { class: 'ot-icon', html: FX }),
          h('span', { class: 'ot-text' }, h('span', { class: 'ot-title', text: it.title }), h('span', { class: 'ot-info', text: it.info })),
          this.iconBtn(it.hidden ? EYE_OFF : EYE, it.hidden ? 'Göster' : 'Gizle', () => this.indicators.toggleVisible(it.id), it.hidden),
          this.iconBtn(GEAR, 'Ayarlar', () => this.indicators.openSettings(it.id)),
          this.iconBtn(TRASH, 'Kaldır', () => this.indicators.remove(it.id)),
        ),
      );
    }

    const draws = this.drawings.listDrawings();
    body.append(h('div', { class: 'ot-section', text: `Çizimler · ${draws.length}` }));
    if (draws.length === 0) body.append(h('div', { class: 'ot-empty', text: 'Bu sembolde çizim yok.' }));
    for (const it of draws) {
      const row = h(
        'div',
        {
          class: `ot-row clickable${it.hidden ? ' is-hidden' : ''}`,
          role: 'button',
          tabindex: '0',
          title: 'Çizime git',
          onclick: () => this.drawings.focusItem(it.id),
          onkeydown: (e: KeyboardEvent) => {
            if (e.key === 'Enter') this.drawings.focusItem(it.id);
          },
        },
        h('span', { class: 'ot-icon', html: it.icon }),
        h('span', { class: 'ot-text' }, h('span', { class: 'ot-title', text: it.title }), h('span', { class: 'ot-info', text: it.info })),
        this.iconBtn(it.hidden ? EYE_OFF : EYE, it.hidden ? 'Göster' : 'Gizle', () => this.drawings.toggleItemHidden(it.id), it.hidden),
        this.iconBtn(it.locked ? LOCK : UNLOCK, it.locked ? 'Kilidi aç' : 'Kilitle', () => this.drawings.toggleItemLock(it.id), it.locked),
        this.iconBtn(TRASH, 'Kaldır', () => this.drawings.removeItem(it.id)),
      );
      body.append(row);
    }
    this.el.append(body);
  }
}
