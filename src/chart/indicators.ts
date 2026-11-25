import type { Chart, IndicatorCreate, IndicatorTooltipData, TooltipFeatureStyle } from 'klinecharts';
import { load, save } from '../store.ts';
import { clear, h, modal } from '../ui/dom.ts';
import { cssVar, currentTheme } from '../ui/theme.ts';

interface CatalogItem {
  name: string;
  title: string;
  /** true: fiyat grafiğinin üstüne çizilir; false: ayrı alt panelde */
  main: boolean;
  /** Varsayılan parametreler (verilmezse kütüphanenin varsayılanı) */
  params?: number[];
}

export const CATALOG: CatalogItem[] = [
  { name: 'MA', title: 'Hareketli Ortalama (MA)', main: true, params: [20, 50, 200] },
  { name: 'EMA', title: 'Üssel Hareketli Ortalama (EMA)', main: true, params: [9, 21, 50] },
  { name: 'SMA', title: 'Düzleştirilmiş Hareketli Ortalama (SMA)', main: true },
  { name: 'BOLL', title: 'Bollinger Bantları', main: true, params: [20, 2] },
  { name: 'SAR', title: 'Parabolik SAR', main: true },
  { name: 'BBI', title: 'Boğa-Ayı Endeksi (BBI)', main: true },
  { name: 'AVP', title: 'Ortalama Fiyat (AVP)', main: true },
  { name: 'VOL', title: 'Hacim', main: false },
  { name: 'RSI', title: 'Göreceli Güç Endeksi (RSI)', main: false, params: [14] },
  { name: 'MACD', title: 'MACD', main: false, params: [12, 26, 9] },
  { name: 'KDJ', title: 'Stokastik (KDJ)', main: false },
  { name: 'CCI', title: 'Emtia Kanal Endeksi (CCI)', main: false, params: [20] },
  { name: 'WR', title: 'Williams %R', main: false, params: [14] },
  { name: 'DMI', title: 'Yönsel Hareket / ADX (DMI)', main: false },
  { name: 'OBV', title: 'Denge Hacmi (OBV)', main: false },
  { name: 'MTM', title: 'Momentum (MTM)', main: false },
  { name: 'ROC', title: 'Değişim Oranı (ROC)', main: false },
  { name: 'TRIX', title: 'Üçlü Üssel Ortalama (TRIX)', main: false },
  { name: 'AO', title: 'Müthiş Osilatör (AO)', main: false },
  { name: 'BIAS', title: 'Sapma Oranı (BIAS)', main: false },
  { name: 'PSY', title: 'Psikolojik Çizgi (PSY)', main: false },
  { name: 'DMA', title: 'Ortalama Farkı (DMA)', main: false },
  { name: 'BRAR', title: 'Duygu Göstergesi (BRAR)', main: false },
  { name: 'CR', title: 'Enerji Göstergesi (CR)', main: false },
  { name: 'VR', title: 'Hacim Oranı (VR)', main: false },
  { name: 'EMV', title: 'Hareket Kolaylığı (EMV)', main: false },
  { name: 'PVT', title: 'Fiyat-Hacim Trendi (PVT)', main: false },
];

const CANDLE_PANE = 'candle_pane';

interface Saved {
  name: string;
  main: boolean;
  params: number[] | null;
  hidden?: boolean;
}

// Grafikteki gösterge başlığının yanındaki düğmeler (göz, ayar, kapat). Yollar 14×14 kutuda çizilir.
const EYE = 'M1 7 Q7 0 13 7 Q7 14 1 7 Z M5 7 C5 5.9 5.9 5 7 5 C8.1 5 9 5.9 9 7 C9 8.1 8.1 9 7 9 C5.9 9 5 8.1 5 7 Z';
const FEATURE_PATHS: Record<string, string> = {
  'gt-eye': EYE,
  'gt-eye-off': `${EYE} M2 12 L12 2`,
  'gt-settings': 'M2 4 L12 4 M2 10 L12 10 M5 2 L5 6 M9 8 L9 12',
  'gt-close': 'M3 3 L11 11 M11 3 L3 11',
};

let featureCache: { theme: string; visible: TooltipFeatureStyle[]; hidden: TooltipFeatureStyle[] } | null = null;

export function featuresFor(visible: boolean): TooltipFeatureStyle[] {
  const theme = currentTheme();
  if (!featureCache || featureCache.theme !== theme) {
    const make = (id: string): TooltipFeatureStyle => ({
      id,
      position: 'middle',
      type: 'path',
      content: { path: FEATURE_PATHS[id], style: 'stroke', lineWidth: 1.4 },
      size: 14,
      color: cssVar('--muted'),
      activeColor: cssVar('--text'),
      backgroundColor: 'transparent',
      activeBackgroundColor: cssVar('--hover'),
      borderRadius: 4,
      paddingLeft: 3,
      paddingRight: 3,
      paddingTop: 3,
      paddingBottom: 3,
      marginLeft: 2,
      marginRight: 0,
      marginTop: -3,
      marginBottom: 0,
    });
    featureCache = {
      theme,
      visible: [make('gt-eye'), make('gt-settings'), make('gt-close')],
      hidden: [make('gt-eye-off'), make('gt-settings'), make('gt-close')],
    };
  }
  return visible ? featureCache.visible : featureCache.hidden;
}

interface FeatureClick {
  feature?: { id?: string };
  indicator?: { id?: string };
}

interface Active extends Saved {
  id: string;
}

function parseParams(text: string): number[] | null {
  const nums = text
    .split(/[,;\s]+/)
    .filter(Boolean)
    .map((x) => Number(x.replace(',', '.')));
  return nums.length > 0 && nums.every((n) => Number.isFinite(n) && n > 0) ? nums : null;
}

function titleOf(name: string): string {
  return CATALOG.find((c) => c.name === name)?.title ?? name;
}

export class Indicators {
  private active: Active[] = [];
  /** Liste değişince (nesne ağacı için) */
  onChange: () => void = () => {};

  constructor(private readonly chart: Chart) {
    const saved = load<Saved[]>('indicators', [{ name: 'VOL', main: false, params: null }]);
    for (const s of saved) this.create(s);
    chart.subscribeAction('onIndicatorTooltipFeatureClick', (data) => this.onFeature(data as FeatureClick));
  }

  private onFeature(data: FeatureClick): void {
    const id = data.indicator?.id;
    const a = this.active.find((x) => x.id === id);
    if (!a) return;
    switch (data.feature?.id) {
      case 'gt-eye':
      case 'gt-eye-off':
        this.toggleVisible(a.id);
        break;
      case 'gt-settings':
        this.openSettings(a.id);
        break;
      case 'gt-close':
        this.remove(a.id);
        break;
    }
  }

  toggleVisible(id: string): void {
    const a = this.active.find((x) => x.id === id);
    if (!a) return;
    a.hidden = !a.hidden;
    this.chart.overrideIndicator({ id, name: a.name, visible: !a.hidden });
    this.persist();
  }

  /** Tek göstergenin parametre penceresi (grafikteki ayar düğmesinden). */
  openSettings(id: string): void {
    const a = this.active.find((x) => x.id === id);
    if (!a) return;
    const input = h('input', { type: 'text', value: this.paramsOf(a).join(', '), 'aria-label': 'Parametreler' });
    const ok = h('button', { class: 'btn primary', text: 'Uygula', type: 'submit' });
    const del = h('button', { class: 'btn danger', text: 'Kaldır', type: 'button' });
    const form = h(
      'form',
      null,
      h('div', { class: 'field' }, h('label', { text: 'Parametreler (virgülle ayırın, ör. 14 ya da 12, 26, 9)' }), input),
      h('div', { class: 'modal-actions' }, del, ok),
    );
    const m = modal(titleOf(a.name), form, { small: true });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const nums = parseParams(input.value);
      if (nums) {
        this.setParams(a.id, nums);
        m.close();
      } else {
        input.setCustomValidity('Pozitif sayılar girin');
        input.reportValidity();
      }
    });
    input.addEventListener('input', () => input.setCustomValidity(''));
    del.addEventListener('click', () => {
      this.remove(a.id);
      m.close();
    });
    input.focus();
    input.select();
  }

  private create(s: Saved): Active | null {
    const value: IndicatorCreate = {
      name: s.name,
      visible: !s.hidden,
      createTooltipDataSource: ({ indicator }) => ({ features: featuresFor(indicator.visible) }) as unknown as IndicatorTooltipData,
    };
    if (s.params) value.calcParams = s.params;
    if (s.main) value.paneId = CANDLE_PANE;
    const id = this.chart.createIndicator(value, s.main);
    if (!id) return null;
    const a = { ...s, id };
    this.active.push(a);
    return a;
  }

  private persist(): void {
    save(
      'indicators',
      this.active.map(({ name, main, params, hidden }) => ({ name, main, params, hidden: hidden || undefined })),
    );
    this.onChange();
  }

  /** Nesne ağacı için: ad, parametreler, görünürlük. */
  list(): { id: string; title: string; info: string; hidden: boolean }[] {
    return this.active.map((a) => ({
      id: a.id,
      title: titleOf(a.name),
      info: [a.main ? 'Ana grafik' : 'Alt panel', this.paramsOf(a).join(', ')].filter(Boolean).join(' · '),
      hidden: !!a.hidden,
    }));
  }

  add(item: CatalogItem): void {
    if (this.create({ name: item.name, main: item.main, params: item.params ?? null })) this.persist();
  }

  /** Grafikteki gösterge sayısı (çöp kutusu menüsü için). */
  count(): number {
    return this.active.length;
  }

  /** Tüm göstergeleri kaldırır; geri almak için çağrılacak fonksiyonu döndürür. */
  removeAll(): () => void {
    const saved: Saved[] = this.active.map(({ name, main, params, hidden }) => ({ name, main, params, hidden }));
    for (const a of this.active) this.chart.removeIndicator({ id: a.id });
    this.active = [];
    this.persist();
    return () => {
      for (const s of saved) this.create(s);
      this.persist();
    };
  }

  remove(id: string): void {
    this.chart.removeIndicator({ id });
    this.active = this.active.filter((a) => a.id !== id);
    this.persist();
  }

  paramsOf(a: Active): number[] {
    const ind = this.chart.getIndicators({ id: a.id })[0];
    return (ind?.calcParams as number[] | undefined) ?? a.params ?? [];
  }

  setParams(id: string, params: number[]): void {
    const a = this.active.find((x) => x.id === id);
    if (!a) return;
    this.chart.overrideIndicator({ id, name: a.name, calcParams: params });
    a.params = params;
    this.persist();
  }

  openDialog(): void {
    const search = h('input', { type: 'search', placeholder: 'Gösterge ara… (RSI, ortalama, hacim)', class: 'search-input' });
    const activeBox = h('div', { class: 'ind-active' });
    const listBox = h('div');

    const renderActive = () => {
      clear(activeBox);
      if (this.active.length === 0) return;
      activeBox.append(h('div', { class: 'section-title', text: 'Grafikteki göstergeler' }));
      for (const a of this.active) {
        const input = h('input', {
          type: 'text',
          value: this.paramsOf(a).join(', '),
          title: 'Parametreler (virgülle ayırın), Enter ile uygula',
          'aria-label': `${a.name} parametreleri`,
        });
        const apply = () => {
          const nums = parseParams(input.value);
          if (nums) this.setParams(a.id, nums);
          else input.value = this.paramsOf(a).join(', ');
        };
        input.addEventListener('change', apply);
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') input.blur();
        });
        activeBox.append(
          h(
            'div',
            { class: 'ind-row' },
            h('div', { class: 'name' }, titleOf(a.name), h('small', { text: a.main ? 'Fiyat grafiğinde' : 'Alt panelde' })),
            input,
            h('button', {
              class: 'icon-btn',
              title: 'Kaldır',
              'aria-label': `${a.name} kaldır`,
              text: '×',
              onclick: () => {
                this.remove(a.id);
                renderActive();
              },
            }),
          ),
        );
      }
    };

    const renderList = () => {
      clear(listBox);
      const q = search.value.trim().toLocaleLowerCase('tr-TR');
      const items = CATALOG.filter((c) => !q || `${c.name} ${c.title}`.toLocaleLowerCase('tr-TR').includes(q));
      listBox.append(h('div', { class: 'section-title', text: 'Eklemek için tıklayın' }));
      for (const c of items) {
        listBox.append(
          h(
            'div',
            {
              class: 'ind-row',
              style: 'cursor:pointer',
              role: 'button',
              tabindex: '0',
              onclick: () => {
                this.add(c);
                renderActive();
              },
              onkeydown: (e: KeyboardEvent) => {
                if (e.key === 'Enter') {
                  this.add(c);
                  renderActive();
                }
              },
            },
            h('div', { class: 'name', text: c.title }),
            h('span', { class: 'ind-tag', text: c.main ? 'Fiyat üstü' : 'Alt panel' }),
          ),
        );
      }
      if (items.length === 0) listBox.append(h('div', { class: 'search-empty', text: 'Eşleşen gösterge yok.' }));
    };

    search.addEventListener('input', renderList);
    renderActive();
    renderList();
    modal('Göstergeler', h('div', null, search, h('div', { style: 'height:12px' }), activeBox, listBox));
    search.focus();
  }
}
