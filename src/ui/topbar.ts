import { binanceSearch } from '../data/binance.ts';
import {
  chooseBase,
  DEFAULT_FAVORITES,
  intervalKey,
  intervalLabel,
  intervalLongLabel,
  isValidInterval,
  parseIntervalKey,
  PRESET_GROUPS,
  sameInterval,
  SPAN_LIMITS,
  type Interval,
  type Unit,
} from '../data/intervals.ts';
import type { SymbolDef } from '../data/types.ts';
import { aliasMatches, probeCandidates } from '../data/aliases.ts';
import { yahooProbe, yahooSearch } from '../data/yahoo.ts';
import { load, save } from '../store.ts';
import { clear, h, isModalOpen, isTyping, modal, popover, toast } from './dom.ts';
import { displayTicker, KIND_LABEL, kindOf } from './format.ts';

export interface TopbarDeps {
  getSymbol(): SymbolDef;
  getInterval(): Interval;
  openSymbol(def: SymbolDef): void;
  setInterval(i: Interval): void;
  addToWatchlist(def: SymbolDef): void;
}

const UNIT_SECONDS: Record<Unit, number> = {
  second: 1,
  minute: 60,
  hour: 3600,
  day: 86400,
  week: 604800,
  month: 2629800,
};

const approxSeconds = (i: Interval) => UNIT_SECONDS[i.unit] * i.span;

type Category = 'all' | 'stock' | 'crypto' | 'fx' | 'index' | 'futures' | 'fund';

const CATEGORIES: { id: Category; label: string }[] = [
  { id: 'all', label: 'Tümü' },
  { id: 'stock', label: 'Hisse' },
  { id: 'crypto', label: 'Kripto' },
  { id: 'fx', label: 'Döviz' },
  { id: 'index', label: 'Endeks' },
  { id: 'futures', label: 'Vadeli / Emtia' },
  { id: 'fund', label: 'Fon' },
];

function categoryOf(def: SymbolDef): Category {
  if (def.source === 'BINANCE' || def.type === 'Kripto') return 'crypto';
  switch (def.type) {
    case 'Döviz':
      return 'fx';
    case 'Endeks':
      return 'index';
    case 'Vadeli':
    case 'Emtia':
      return 'futures';
    case 'ETF':
      return 'fund';
    default:
      return 'stock';
  }
}

export interface SearchOptions {
  title?: string;
  /** Verilirse seçilen sembol grafikte açılmaz, bu fonksiyona verilir (karşılaştırma için). */
  onPick?: (def: SymbolDef) => void;
}

export class Topbar {
  private favorites: string[] = load<string[]>('favorites', DEFAULT_FAVORITES).filter((k) => parseIntervalKey(k));
  private readonly ivBox = document.getElementById('intervals')!;
  private readonly tickerEl = document.getElementById('sym-ticker')!;
  private readonly nameEl = document.getElementById('sym-name')!;
  private readonly statusEl = document.getElementById('feed-status')!;

  constructor(private readonly deps: TopbarDeps) {
    document.getElementById('sym-btn')!.addEventListener('click', () => this.openSearch());
    // TradingView'daki gibi: grafikteyken harf yazmaya başlamak aramayı açar.
    document.addEventListener('keydown', (e) => {
      if (isTyping(e) || isModalOpen() || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key.length === 1 && /[\p{L}\p{N}]/u.test(e.key)) {
        e.preventDefault();
        this.openSearch(e.key);
      }
    });
  }

  update(def: SymbolDef): void {
    this.tickerEl.textContent = displayTicker(def);
    this.nameEl.textContent = def.name !== def.ticker ? def.name : '';
    document.title = `${displayTicker(def)} · Grafik Terminali`;
    clear(this.statusEl);
    const live = def.source === 'BINANCE';
    const text = live
      ? 'Canlı · Binance'
      : def.ticker.endsWith('.IS')
        ? 'BIST · ~15 dk gecikmeli'
        : 'Yahoo · gecikmeli olabilir';
    this.statusEl.append(h('span', { class: `dot${live ? ' live' : ''}` }), text);
    this.renderIntervals();
  }

  private supported(i: Interval): boolean {
    return chooseBase(i, this.deps.getSymbol().source) !== null;
  }

  private choose(i: Interval): void {
    if (!this.supported(i)) {
      toast('Bu dilim bu sembolde yok', 'Saniye grafikleri yalnızca kripto (Binance) sembollerinde var.', 'error');
      return;
    }
    this.deps.setInterval(i);
  }

  renderIntervals(): void {
    clear(this.ivBox);
    const current = this.deps.getInterval();
    const favs = this.favorites
      .map((k) => parseIntervalKey(k)!)
      .sort((a, b) => approxSeconds(a) - approxSeconds(b));
    const list = favs.some((f) => sameInterval(f, current)) ? favs : [...favs, current];
    for (const i of list) {
      const active = sameInterval(i, current);
      this.ivBox.append(
        h('button', {
          class: `iv-btn${active ? ' active' : ''}`,
          title: intervalLongLabel(i),
          text: intervalLabel(i),
          'aria-pressed': String(active),
          style: this.supported(i) ? undefined : 'opacity:.35',
          onclick: () => this.choose(i),
        }),
      );
    }
    const more = h('button', { class: 'iv-btn', title: 'Tüm zaman dilimleri ve özel dilim', text: '▾' });
    more.addEventListener('click', () => this.openIntervalMenu(more));
    this.ivBox.append(more);
  }

  private openIntervalMenu(anchor: HTMLElement): void {
    const current = this.deps.getInterval();
    const box = h('div');
    let close = () => {};

    for (const g of PRESET_GROUPS) {
      box.append(h('div', { class: 'iv-group-title', text: g.title }));
      for (const i of g.items) {
        const key = intervalKey(i);
        const fav = this.favorites.includes(key);
        const star = h('span', {
          class: `iv-star${fav ? ' on' : ''}`,
          title: fav ? 'Üst çubuktan kaldır' : 'Üst çubuğa ekle',
          text: fav ? '★' : '☆',
        });
        star.addEventListener('click', (e) => {
          e.stopPropagation();
          this.toggleFavorite(key);
          const on = this.favorites.includes(key);
          star.textContent = on ? '★' : '☆';
          star.classList.toggle('on', on);
        });
        const supported = this.supported(i);
        box.append(
          h(
            'button',
            {
              class: `iv-item${sameInterval(i, current) ? ' active' : ''}`,
              disabled: !supported,
              title: supported ? '' : 'Bu sembolde yok (saniye verisi yalnızca kriptoda)',
              onclick: () => {
                close();
                this.choose(i);
              },
            },
            h('span', { class: 'label', text: intervalLongLabel(i) }),
            star,
          ),
        );
      }
    }

    // Özel dilim: istediğin sayı + birim
    const num = h('input', { type: 'number', min: '1', value: '7', 'aria-label': 'Adet' });
    const unit = h(
      'select',
      { 'aria-label': 'Birim' },
      ...(['second', 'minute', 'hour', 'day', 'week', 'month'] as Unit[]).map((u) =>
        h('option', { value: u, text: intervalLongLabel({ unit: u, span: 1 }).replace(/^1 /, '') }),
      ),
    );
    unit.value = 'minute';
    const go = h('button', { class: 'btn primary', text: 'Aç', type: 'submit' });
    const form = h('form', { class: 'iv-custom', title: 'Özel zaman dilimi' }, num, unit, go);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const i: Interval = { unit: unit.value as Unit, span: Number(num.value) };
      if (!isValidInterval(i)) {
        toast('Geçersiz dilim', `${intervalLongLabel({ unit: i.unit, span: 1 }).replace(/^1 /, '')} için 1–${SPAN_LIMITS[i.unit]} arası bir sayı girin.`, 'error');
        return;
      }
      close();
      this.choose(i);
    });
    box.append(h('div', { class: 'iv-group-title', text: 'Özel dilim' }), form);
    close = popover(anchor, box, 'iv-menu');
  }

  private toggleFavorite(key: string): void {
    if (this.favorites.includes(key)) this.favorites = this.favorites.filter((k) => k !== key);
    else this.favorites.push(key);
    save('favorites', this.favorites);
    this.renderIntervals();
  }

  openSearch(initial = '', opts: SearchOptions = {}): void {
    const input = h('input', {
      type: 'text',
      class: 'search-input',
      placeholder: 'Sembol ara: THYAO, XU100, BTC, AAPL, XAUUSD, US100, altın, dolar…',
      value: initial,
      autocomplete: 'off',
      spellcheck: false,
      'aria-label': 'Sembol ara',
    });
    const clearBtn = h('button', { class: 'search-clear', type: 'button', title: 'Temizle', 'aria-label': 'Aramayı temizle', text: '×' });
    const status = h('div', { class: 'search-status', role: 'status' });
    const chips = h('div', { class: 'search-chips', role: 'tablist' });
    const results = h('div', { class: 'search-results', role: 'listbox' });
    const m = modal(
      opts.title ?? 'Sembol ara',
      h('div', { class: 'search-box' }, h('div', { class: 'search-field' }, input, clearBtn), chips, status, results),
      { wide: true },
    );

    let seq = 0;
    let rows: { el: HTMLElement; def: SymbolDef }[] = [];
    let sel = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pending = false;
    let category: Category = 'all';
    let last: { yahoo: SymbolDef[]; crypto: SymbolDef[]; cryptoFirst: boolean; note: string } | null = null;

    const choose = (def: SymbolDef) => {
      m.close();
      if (opts.onPick) opts.onPick(def);
      else this.deps.openSymbol(def);
    };

    const highlight = () => {
      rows.forEach((r, i) => {
        r.el.classList.toggle('sel', i === sel);
        r.el.setAttribute('aria-selected', String(i === sel));
      });
      rows[sel]?.el.scrollIntoView({ block: 'nearest' });
    };

    const renderChips = () => {
      clear(chips);
      for (const c of CATEGORIES) {
        const b = h('button', { class: `search-chip${c.id === category ? ' active' : ''}`, type: 'button', role: 'tab', text: c.label });
        b.addEventListener('click', () => {
          category = c.id;
          renderChips();
          render();
          input.focus();
        });
        chips.append(b);
      }
    };

    const row = (def: SymbolDef) => {
      const add = h('button', { class: 'search-add', type: 'button', title: 'İzleme listesine ekle', 'aria-label': 'İzleme listesine ekle', text: '+' });
      add.addEventListener('click', (e) => {
        e.stopPropagation();
        this.deps.addToWatchlist(def);
        toast('İzleme listesine eklendi', displayTicker(def));
      });
      const el = h(
        'div',
        { class: 'search-row', role: 'option' },
        h('span', { class: 't' }, h('span', { class: `kind-dot kind-${kindOf(def)}`, title: KIND_LABEL[kindOf(def)] }), displayTicker(def)),
        h('span', { class: 'n', text: def.name }),
        h('span', { class: 'x', text: [def.type, def.exchange].filter(Boolean).join(' · ') }),
        add,
      );
      el.addEventListener('click', () => choose(def));
      rows.push({ el, def });
      return el;
    };

    const render = () => {
      clear(results);
      rows = [];
      sel = 0;
      if (!last) return;
      const keep = (d: SymbolDef) => category === 'all' || categoryOf(d) === category;
      const groups = [
        { title: 'Borsa · Endeks · Döviz · Emtia', items: last.yahoo.filter(keep) },
        { title: 'Kripto (Binance, anlık)', items: last.crypto.filter(keep) },
      ];
      if (last.cryptoFirst) groups.reverse();
      for (const g of groups) {
        if (g.items.length === 0) continue;
        results.append(h('div', { class: 'search-group', text: g.title }));
        for (const def of g.items) results.append(row(def));
      }
      if (rows.length === 0) {
        const empty = last.note || (category === 'all' ? 'Sonuç yok. Sembolü farklı yazmayı deneyin (ör. XAUUSD, GC=F, THYAO).' : 'Bu kategoride sonuç yok.');
        results.append(h('div', { class: 'search-empty', text: empty }));
      }
      highlight();
    };

    const run = async () => {
      const q = input.value.trim();
      const my = ++seq;
      clearBtn.hidden = !q;
      if (!q) {
        status.textContent = '';
        last = { yahoo: [], crypto: [], cryptoFirst: false, note: 'Aramak için yazın. Örnek: THYAO, ASELS, XU100, BTC, ETHTRY, AAPL, USDTRY, XAUUSD, US100.' };
        render();
        return;
      }
      status.textContent = 'Aranıyor…';
      const aliases = aliasMatches(q);
      const [y, b] = await Promise.allSettled([yahooSearch(q), binanceSearch(q, 8)]);
      if (my !== seq) return;
      let yItems = y.status === 'fulfilled' ? y.value : [];
      const bItems = b.status === 'fulfilled' ? b.value : [];
      // Arama dizininde yoksa sembolü doğrudan dene (BIST, ABD, döviz, vadeli).
      if (yItems.length === 0 && aliases.length === 0 && bItems.length === 0) {
        const probed = await yahooProbe(probeCandidates(q)).catch(() => []);
        if (my !== seq) return;
        yItems = probed;
      }
      const merged = [...aliases, ...yItems.filter((d) => !aliases.some((a) => a.ticker === d.ticker))];
      const qu = q.toUpperCase();
      const cryptoFirst =
        aliases.length === 0 &&
        bItems.length > 0 &&
        (bItems[0].ticker === qu || bItems[0].name.startsWith(`${qu} /`)) &&
        !merged.some((d) => displayTicker(d) === qu && d.type !== 'Vadeli' && d.type !== 'Kripto');
      const failed = y.status === 'rejected' && b.status === 'rejected' && merged.length === 0;
      status.textContent = '';
      last = { yahoo: merged, crypto: bItems, cryptoFirst, note: failed ? 'Arama yapılamadı: internet bağlantısını kontrol edin.' : '' };
      render();
    };

    input.addEventListener('input', () => {
      clearTimeout(timer);
      pending = true;
      status.textContent = input.value.trim() ? 'Aranıyor…' : '';
      timer = setTimeout(() => {
        pending = false;
        void run();
      }, 250);
    });
    clearBtn.addEventListener('click', () => {
      input.value = '';
      input.focus();
      void run();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        sel = Math.min(rows.length - 1, sel + 1);
        highlight();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        sel = Math.max(0, sel - 1);
        highlight();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (pending) {
          // Yazıp hemen Enter'a basıldı: eski sonuçları değil, güncel aramanın ilkini aç.
          clearTimeout(timer);
          pending = false;
          void run().then(() => rows[0] && choose(rows[0].def));
          return;
        }
        const r = rows[sel];
        if (r) choose(r.def);
      } else if (e.key === 'Tab' && !e.shiftKey) {
        // Tab ile kategoriler arasında gez (TradingView'daki gibi).
        e.preventDefault();
        const i = CATEGORIES.findIndex((c) => c.id === category);
        category = CATEGORIES[(i + 1) % CATEGORIES.length].id;
        renderChips();
        render();
      }
    });
    renderChips();
    input.focus();
    // İlk harfle açıldığında imleç sona gelsin ("btc" yazınca "tcb" olmasın).
    input.setSelectionRange(input.value.length, input.value.length);
    void run();
  }
}
