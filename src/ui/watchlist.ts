import type { QuoteHub } from '../data/quotes.ts';
import type { Quote, SymbolDef } from '../data/types.ts';
import { load, save } from '../store.ts';
import { clear, h } from './dom.ts';
import { displayTicker, fmtPct, fmtPrice, KIND_LABEL, kindOf, setPrecision } from './format.ts';

export const DEFAULT_WATCHLIST: SymbolDef[] = [
  { id: 'YAHOO:XU100.IS', source: 'YAHOO', ticker: 'XU100.IS', name: 'BIST 100', exchange: 'Borsa İstanbul', type: 'Endeks' },
  { id: 'YAHOO:THYAO.IS', source: 'YAHOO', ticker: 'THYAO.IS', name: 'Türk Hava Yolları', exchange: 'Borsa İstanbul', type: 'Hisse' },
  { id: 'YAHOO:ASELS.IS', source: 'YAHOO', ticker: 'ASELS.IS', name: 'Aselsan', exchange: 'Borsa İstanbul', type: 'Hisse' },
  { id: 'BINANCE:BTCUSDT', source: 'BINANCE', ticker: 'BTCUSDT', name: 'BTC / USDT', exchange: 'Binance', type: 'Kripto' },
  { id: 'BINANCE:ETHUSDT', source: 'BINANCE', ticker: 'ETHUSDT', name: 'ETH / USDT', exchange: 'Binance', type: 'Kripto' },
  { id: 'YAHOO:USDTRY=X', source: 'YAHOO', ticker: 'USDTRY=X', name: 'Dolar / TL', exchange: 'Döviz', type: 'Döviz' },
  { id: 'YAHOO:GC=F', source: 'YAHOO', ticker: 'GC=F', name: 'Altın (ons, vadeli)', exchange: 'COMEX', type: 'Emtia' },
  { id: 'YAHOO:^GSPC', source: 'YAHOO', ticker: '^GSPC', name: 'S&P 500', exchange: 'ABD', type: 'Endeks' },
];

interface Row {
  row: HTMLElement;
  price: HTMLElement;
  chg: HTMLElement;
  last?: number;
}

export interface WatchlistDeps {
  open(def: SymbolDef): void;
  current(): SymbolDef;
  onChange(): void;
}

export class Watchlist {
  private items: SymbolDef[] = load<SymbolDef[]>('watchlist', DEFAULT_WATCHLIST);
  private rows = new Map<string, Row>();

  constructor(
    private readonly el: HTMLElement,
    private readonly quotes: QuoteHub,
    private readonly deps: WatchlistDeps,
  ) {
    quotes.on((q) => this.onQuote(q));
    this.render();
  }

  ids(): string[] {
    return this.items.map((d) => d.id);
  }

  has(id: string): boolean {
    return this.items.some((d) => d.id === id);
  }

  add(def: SymbolDef): void {
    if (this.has(def.id)) return;
    this.items.push(def);
    this.persist();
  }

  private removeItem(id: string): void {
    this.items = this.items.filter((d) => d.id !== id);
    this.persist();
  }

  private persist(): void {
    save('watchlist', this.items);
    this.render();
    this.deps.onChange();
  }

  setActive(id: string): void {
    for (const [rid, r] of this.rows) r.row.classList.toggle('active', rid === id);
  }

  render(): void {
    clear(this.el);
    this.rows.clear();
    const addBtn = h('button', {
      class: 'icon-btn',
      title: 'Açık grafiği listeye ekle',
      'aria-label': 'Açık grafiği listeye ekle',
      text: '+',
      onclick: () => this.add(this.deps.current()),
    });
    this.el.append(
      h('div', { class: 'panel-head' }, h('span', { class: 'title', text: 'İzleme listesi' }), addBtn),
      h('div', { class: 'wl-cols' }, h('span', { text: 'Sembol' }), h('span', { text: 'Son' }), h('span', { text: 'Değ. %' }), h('span')),
    );
    const body = h('div', { class: 'panel-body' });
    if (this.items.length === 0) {
      body.append(h('div', { class: 'empty', text: 'Liste boş. Sembol aramasındaki + ile ya da yukarıdaki + ile ekleyin.' }));
    }
    const activeId = this.deps.current().id;
    for (const def of this.items) {
      const price = h('span', { class: 'wl-price', text: '—' });
      const chg = h('span', { class: 'wl-chg muted', text: '—' });
      const del = h('button', {
        class: 'wl-del',
        title: 'Listeden çıkar',
        'aria-label': `${displayTicker(def)} listeden çıkar`,
        text: '×',
        onclick: (e: Event) => {
          e.stopPropagation();
          this.removeItem(def.id);
        },
      });
      const row = h(
        'div',
        {
          class: `wl-row${def.id === activeId ? ' active' : ''}`,
          role: 'button',
          tabindex: '0',
          title: `${def.name}${def.exchange ? ` · ${def.exchange}` : ''}`,
          onclick: () => this.deps.open(def),
          onkeydown: (e: KeyboardEvent) => {
            if (e.key === 'Enter') this.deps.open(def);
          },
        },
        h(
          'span',
          { class: 'wl-sym' },
          h(
            'span',
            { class: 't' },
            h('span', { class: `kind-dot kind-${kindOf(def)}`, title: KIND_LABEL[kindOf(def)] }),
            displayTicker(def),
          ),
          h('span', { class: 'n', text: def.name }),
        ),
        price,
        chg,
        del,
      );
      const r: Row = { row, price, chg };
      this.rows.set(def.id, r);
      body.append(row);
      const q = this.quotes.get(def.id);
      if (q) this.paint(r, q, false);
    }
    this.el.append(body);
  }

  private onQuote(q: Quote): void {
    const r = this.rows.get(q.id);
    if (r) this.paint(r, q, true);
  }

  private paint(r: Row, q: Quote, flash: boolean): void {
    if (q.precision !== undefined) setPrecision(q.id, q.precision);
    r.price.textContent = fmtPrice(q.price, q.id);
    r.chg.textContent = fmtPct(q.changePct);
    r.chg.className = `wl-chg ${q.changePct === null || q.changePct === 0 ? 'muted' : q.changePct > 0 ? 'up' : 'down'}`;
    if (flash && r.last !== undefined && r.last !== q.price) {
      r.price.classList.remove('flash-up', 'flash-down');
      void r.price.offsetWidth; // animasyonu yeniden başlat
      r.price.classList.add(q.price > r.last ? 'flash-up' : 'flash-down');
    }
    r.last = q.price;
  }
}
