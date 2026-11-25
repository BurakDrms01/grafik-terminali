// Grafik ayarları (TradingView'daki "Grafik ayarları" penceresi), mum türleri ve mum kapanışına geri sayım.
import type { Chart, KLineData } from 'klinecharts';
import type { BarStyle } from '../data/feed.ts';
import { load, save } from '../store.ts';
import { clear, h, modal, popover } from '../ui/dom.ts';
import { cssVar, withAlpha } from '../ui/theme.ts';
import { FONT, legendOptions } from './chart.ts';
import { barEnd, formatRemaining } from './countdown.ts';

export type ChartType = 'ohlc' | 'candle_solid' | 'candle_up_stroke' | 'heikin_ashi' | 'line' | 'area';

const svg = (body: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const CHART_TYPES: { id: ChartType; label: string; icon: string }[] = [
  { id: 'ohlc', label: 'Çubuklar', icon: svg('<path d="M7 4v16M4 8h3M7 15h3M16 5v15M13 9h3M16 15h3"/>') },
  {
    id: 'candle_solid',
    label: 'Mumlar',
    icon: svg('<path d="M8 3v3M8 17v4M16 5v3M16 17v3"/><rect x="5.5" y="6" width="5" height="11" rx=".5" fill="currentColor"/><rect x="13.5" y="8" width="5" height="9" rx=".5" fill="currentColor"/>'),
  },
  {
    id: 'candle_up_stroke',
    label: 'İçi boş mumlar',
    icon: svg('<path d="M8 3v3M8 17v4M16 5v3M16 17v3"/><rect x="5.5" y="6" width="5" height="11" rx=".5"/><rect x="13.5" y="8" width="5" height="9" rx=".5" fill="currentColor"/>'),
  },
  {
    id: 'heikin_ashi',
    label: 'Heikin Ashi',
    icon: svg('<path d="M8 4v3M8 15v4M16 6v3M16 16v3"/><rect x="5.5" y="7" width="5" height="8" rx="1.5" fill="currentColor"/><rect x="13.5" y="9" width="5" height="7" rx="1.5"/>'),
  },
  { id: 'line', label: 'Çizgi', icon: svg('<path d="M3 17l5-6 4 3 8-9"/>') },
  { id: 'area', label: 'Alan', icon: svg('<path d="M3 17l5-6 4 3 8-9v15H3z" fill="currentColor" fill-opacity=".22" stroke="none"/><path d="M3 17l5-6 4 3 8-9"/>') },
];

export interface ChartSettings {
  chartType: ChartType;
  /** null: temanın rengi */
  upColor: string | null;
  downColor: string | null;
  wicks: boolean;
  colorByPrevClose: boolean;
  lastPriceLine: boolean;
  lastPriceLabel: boolean;
  countdown: boolean;
  highLow: boolean;
  legendTitle: boolean;
  legendOhlc: boolean;
  legendChange: boolean;
  legendVolume: boolean;
  indicatorValues: boolean;
  gridH: boolean;
  gridV: boolean;
  background: string | null;
  watermark: boolean;
  axisPosition: 'right' | 'left';
  timezone: string;
  rightOffset: number;
}

export const DEFAULT_SETTINGS: ChartSettings = {
  chartType: 'candle_solid',
  upColor: null,
  downColor: null,
  wicks: true,
  colorByPrevClose: false,
  lastPriceLine: true,
  lastPriceLabel: true,
  countdown: true,
  highLow: true,
  legendTitle: true,
  legendOhlc: true,
  legendChange: true,
  legendVolume: true,
  indicatorValues: true,
  gridH: true,
  gridV: true,
  background: null,
  watermark: false,
  axisPosition: 'right',
  timezone: 'Europe/Istanbul',
  rightOffset: 80,
};

export const TIMEZONES: { id: string; label: string }[] = [
  { id: 'Europe/Istanbul', label: '(UTC+3) İstanbul' },
  { id: 'UTC', label: 'UTC' },
  { id: 'Europe/London', label: 'Londra' },
  { id: 'Europe/Berlin', label: 'Berlin / Frankfurt' },
  { id: 'America/New_York', label: 'New York' },
  { id: 'America/Chicago', label: 'Chicago' },
  { id: 'America/Los_Angeles', label: 'Los Angeles' },
  { id: 'Asia/Dubai', label: 'Dubai' },
  { id: 'Asia/Tokyo', label: 'Tokyo' },
  { id: 'Asia/Hong_Kong', label: 'Hong Kong' },
  { id: 'Asia/Singapore', label: 'Singapur' },
  { id: 'Australia/Sydney', label: 'Sidney' },
];

// ---------- Uygulama ----------

export interface SettingsDeps {
  chart: Chart;
  chartWrap: HTMLElement;
  /** Mum biçimi değişince veri yeniden yüklenmeli (Heikin Ashi) */
  setBarStyle(style: BarStyle): void;
  /** Fiyat ekseni konumu (ölçek ayarlarıyla birlikte uygulanır) */
  setAxisPosition(pos: 'right' | 'left'): void;
  setTimezone(tz: string): void;
  /** Canlı mod mu (tekrar oynatmada geri sayım gösterilmez) */
  isLive(): boolean;
  /** Filigran yazısı: "SLV · 1G" */
  watermarkText(): string;
}

export class ChartSettingsManager {
  settings: ChartSettings = { ...DEFAULT_SETTINGS, ...load<Partial<ChartSettings>>('chartSettings', {}) };
  private readonly watermarkEl: HTMLElement;
  private typeBtn: HTMLButtonElement | null = null;

  constructor(private readonly deps: SettingsDeps) {
    this.watermarkEl = h('div', { class: 'watermark', 'aria-hidden': 'true' });
    deps.chartWrap.prepend(this.watermarkEl);
    deps.chart.setFormatter({ formatExtendText: (p) => this.countdownText(p.data) });
    deps.setBarStyle(this.settings.chartType === 'heikin_ashi' ? 'heikin' : 'normal');
  }

  private countdownText(data: KLineData): string {
    if (!this.settings.countdown || !this.deps.isLive()) return '';
    const period = this.deps.chart.getPeriod();
    if (!period || !data) return '';
    const ms = barEnd(data.timestamp, period) - Date.now();
    if (ms <= 0 || ms > 400 * 86_400_000) return '';
    return formatRemaining(ms);
  }

  /** Tema uygulandıktan sonra çağrılır: kullanıcı ayarlarını grafiğe işler. */
  apply(): void {
    const s = this.settings;
    const { chart } = this.deps;
    const up = s.upColor ?? cssVar('--up');
    const down = s.downColor ?? cssVar('--down');
    const line = cssVar('--line-1');
    const kType = s.chartType === 'heikin_ashi' ? 'candle_solid' : s.chartType === 'line' ? 'area' : s.chartType;
    legendOptions.ohlc = s.legendOhlc;
    legendOptions.change = s.legendChange;
    legendOptions.volume = s.legendVolume;
    legendOptions.up = s.upColor;
    legendOptions.down = s.downColor;
    chart.setStyles({
      grid: { horizontal: { show: s.gridH }, vertical: { show: s.gridV } },
      candle: {
        type: kType,
        bar: {
          compareRule: s.colorByPrevClose ? 'previous_close' : 'current_open',
          upColor: up,
          downColor: down,
          upBorderColor: up,
          downBorderColor: down,
          upWickColor: s.wicks ? up : 'rgba(0,0,0,0)',
          downWickColor: s.wicks ? down : 'rgba(0,0,0,0)',
        },
        area: {
          lineColor: line,
          lineSize: 2,
          backgroundColor:
            s.chartType === 'line'
              ? 'rgba(0,0,0,0)'
              : [
                  { offset: 0, color: withAlpha(line, 0.02) },
                  { offset: 1, color: withAlpha(line, 0.28) },
                ],
          point: { show: s.chartType === 'area', color: line, rippleColor: withAlpha(line, 0.3) },
        },
        priceMark: {
          high: { show: s.highLow },
          low: { show: s.highLow },
          last: {
            show: s.lastPriceLine || s.lastPriceLabel,
            upColor: up,
            downColor: down,
            line: { show: s.lastPriceLine },
            text: { show: s.lastPriceLabel },
            extendTexts: [
              {
                show: s.countdown && s.lastPriceLabel,
                position: 'below_price',
                updateInterval: 1000,
                size: 12,
                family: FONT,
                weight: 600,
                color: '#ffffff',
                style: 'fill',
                paddingLeft: 4,
                paddingRight: 4,
                paddingTop: 2,
                paddingBottom: 3,
                borderRadius: 0,
                borderSize: 0,
                borderColor: 'rgba(0,0,0,0)',
                borderStyle: 'solid',
                borderDashedValue: [],
                backgroundColor: null,
              },
            ],
          },
        },
        tooltip: { title: { show: s.legendTitle } },
      },
      indicator: { tooltip: { showRule: s.indicatorValues ? 'always' : 'follow_cross' } },
    });
    chart.setOffsetRightDistance(s.rightOffset);
    this.deps.setAxisPosition(s.axisPosition);
    this.deps.setTimezone(s.timezone);
    this.deps.chartWrap.style.background = s.background ?? '';
    this.updateWatermark();
    this.paintTypeButton();
  }

  updateWatermark(): void {
    this.watermarkEl.hidden = !this.settings.watermark;
    this.watermarkEl.textContent = this.settings.watermark ? this.deps.watermarkText() : '';
  }

  private commit(next: ChartSettings): void {
    const prevType = this.settings.chartType;
    this.settings = next;
    save('chartSettings', next);
    const wasHA = prevType === 'heikin_ashi';
    const isHA = next.chartType === 'heikin_ashi';
    this.apply();
    if (wasHA !== isHA) {
      this.deps.setBarStyle(isHA ? 'heikin' : 'normal');
      this.deps.chart.resetData();
    }
  }

  setChartType(t: ChartType): void {
    if (t === this.settings.chartType) return;
    this.commit({ ...this.settings, chartType: t });
  }

  // ---------- Üst çubuktaki mum türü düğmesi ----------

  attachTypeButton(btn: HTMLButtonElement): void {
    this.typeBtn = btn;
    btn.addEventListener('click', () => {
      let close = () => {};
      const box = h('div', null, h('div', { class: 'menu-title', text: 'Grafik türü' }));
      for (const t of CHART_TYPES) {
        const on = t.id === this.settings.chartType;
        const row = h(
          'button',
          { class: `menu-row${on ? ' active' : ''}` },
          h('span', { class: 'menu-icon', html: t.icon }),
          h('span', { class: 'menu-label', text: t.label }),
          h('span', { class: 'menu-check', text: on ? '✓' : '' }),
        );
        row.addEventListener('click', () => {
          close();
          this.setChartType(t.id);
        });
        box.append(row);
      }
      close = popover(btn, box, 'tool-menu');
    });
    this.paintTypeButton();
  }

  private paintTypeButton(): void {
    const t = CHART_TYPES.find((x) => x.id === this.settings.chartType) ?? CHART_TYPES[1];
    if (!this.typeBtn) return;
    this.typeBtn.innerHTML = t.icon;
    this.typeBtn.title = `Grafik türü: ${t.label}`;
    this.typeBtn.setAttribute('aria-label', `Grafik türü: ${t.label}`);
  }

  // ---------- Ayarlar penceresi ----------

  /** Menülerden tek ayar değişikliği (ör. fiyat ekseni menüsü). */
  update(patch: Partial<ChartSettings>): void {
    this.commit({ ...this.settings, ...patch });
  }

  /** tab: açılacak sekme ('symbol' | 'status' | 'scales' | 'look'); verilmezse son açılan. */
  openDialog(tab?: string): void {
    const original = structuredClone(this.settings);
    let draft: ChartSettings = structuredClone(this.settings);
    let committed = false;
    const update = (patch: Partial<ChartSettings>) => {
      draft = { ...draft, ...patch };
      this.commit(draft);
    };

    const check = (label: string, key: keyof ChartSettings) => {
      const input = h('input', { type: 'checkbox', checked: Boolean(draft[key]) });
      input.addEventListener('change', () => update({ [key]: input.checked } as Partial<ChartSettings>));
      return h('label', { class: 'check set-row' }, input, label);
    };
    const color = (label: string, key: 'upColor' | 'downColor' | 'background', fallbackVar: string) => {
      const current = () => draft[key] ?? cssVar(fallbackVar);
      const input = h('input', { type: 'color', value: toHex(current()), 'aria-label': label });
      const reset = h('button', { class: 'link-btn', type: 'button', text: 'Tema rengi' });
      input.addEventListener('input', () => update({ [key]: input.value } as Partial<ChartSettings>));
      reset.addEventListener('click', () => {
        update({ [key]: null } as Partial<ChartSettings>);
        input.value = toHex(current());
      });
      return h('div', { class: 'set-row field-inline' }, h('span', { text: label }), h('span', { class: 'set-ctl' }, reset, input));
    };
    const select = <K extends keyof ChartSettings>(label: string, key: K, options: { id: string; label: string }[]) => {
      const sel = h('select', { 'aria-label': label });
      for (const o of options) sel.append(h('option', { value: o.id, text: o.label }));
      sel.value = String(draft[key]);
      sel.addEventListener('change', () => update({ [key]: sel.value } as Partial<ChartSettings>));
      return h('div', { class: 'set-row field-inline' }, h('span', { text: label }), sel);
    };
    const number = (label: string, key: 'rightOffset', min: number, max: number) => {
      const input = h('input', { type: 'number', min: String(min), max: String(max), value: String(draft[key]), class: 'set-num' });
      input.addEventListener('change', () => {
        const v = Math.max(min, Math.min(max, Number(input.value) || 0));
        input.value = String(v);
        update({ [key]: v } as Partial<ChartSettings>);
      });
      return h('div', { class: 'set-row field-inline' }, h('span', { text: label }), input);
    };

    const tabs: { id: string; label: string; build: () => HTMLElement[] }[] = [
      {
        id: 'symbol',
        label: 'Sembol',
        build: () => [
          select('Grafik türü', 'chartType', CHART_TYPES),
          color('Yükselen mum', 'upColor', '--up'),
          color('Düşen mum', 'downColor', '--down'),
          check('Fitilleri göster', 'wicks'),
          check('Mum rengini önceki kapanışa göre belirle', 'colorByPrevClose'),
        ],
      },
      {
        id: 'status',
        label: 'Durum çizgisi',
        build: () => [
          check('Sembol başlığı', 'legendTitle'),
          check('Açılış / Yüksek / Düşük / Kapanış değerleri', 'legendOhlc'),
          check('Mum değişimi (fiyat ve yüzde)', 'legendChange'),
          check('Hacim', 'legendVolume'),
          check('Gösterge değerlerini her zaman göster', 'indicatorValues'),
        ],
      },
      {
        id: 'scales',
        label: 'Ölçekler',
        build: () => [
          check('Son fiyat çizgisi', 'lastPriceLine'),
          check('Son fiyat etiketi', 'lastPriceLabel'),
          check('Mum kapanışına geri sayım (etiketin altında)', 'countdown'),
          check('En yüksek / en düşük fiyat işaretleri', 'highLow'),
          select('Fiyat ekseni', 'axisPosition', [
            { id: 'right', label: 'Sağda' },
            { id: 'left', label: 'Solda' },
          ]),
          h('p', { class: 'set-note', text: 'Log, yüzde ve ters ölçek grafiğin altındaki çubukta (Alt+L, Alt+P, Alt+I).' }),
        ],
      },
      {
        id: 'look',
        label: 'Görünüm',
        build: () => [
          color('Arka plan', 'background', '--bg'),
          check('Yatay ızgara çizgileri', 'gridH'),
          check('Dikey ızgara çizgileri', 'gridV'),
          check('Filigran (sembol ve dilim)', 'watermark'),
          number('Sağ boşluk (piksel)', 'rightOffset', 0, 400),
          select('Saat dilimi', 'timezone', TIMEZONES),
        ],
      },
    ];

    const nav = h('div', { class: 'set-nav', role: 'tablist' });
    const pane = h('div', { class: 'set-pane' });
    let active = tab ?? load<string>('settingsTab', 'symbol');
    const render = () => {
      clear(nav);
      clear(pane);
      for (const t of tabs) {
        const b = h('button', { class: `set-tab${t.id === active ? ' active' : ''}`, type: 'button', role: 'tab', text: t.label });
        b.addEventListener('click', () => {
          active = t.id;
          save('settingsTab', active);
          render();
        });
        nav.append(b);
      }
      (tabs.find((t) => t.id === active) ?? tabs[0]).build().forEach((el) => pane.append(el));
    };

    const resetBtn = h('button', { class: 'btn', type: 'button', text: 'Varsayılana dön' });
    const cancel = h('button', { class: 'btn', type: 'button', text: 'İptal' });
    const ok = h('button', { class: 'btn primary', type: 'button', text: 'Tamam' });
    const m = modal('Grafik ayarları', h('div', null, h('div', { class: 'set-wrap' }, nav, pane), h('div', { class: 'modal-actions spread' }, h('div', null, resetBtn), h('div', null, cancel, ok))), {
      wide: true,
      onClose: () => {
        if (!committed) this.commit(original);
      },
    });
    resetBtn.addEventListener('click', () => {
      draft = { ...DEFAULT_SETTINGS };
      this.commit(draft);
      render();
    });
    ok.addEventListener('click', () => {
      committed = true;
      m.close();
    });
    cancel.addEventListener('click', () => m.close());
    render();
  }
}

/** "rgb(…)" ya da "#abc" → "#aabbcc" (renk seçici için). */
function toHex(c: string): string {
  const v = c.trim();
  if (/^#[0-9a-f]{6}$/i.test(v)) return v;
  if (/^#[0-9a-f]{3}$/i.test(v)) return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`;
  const m = /rgba?\((\d+)\D+(\d+)\D+(\d+)/.exec(v);
  if (m) return `#${[m[1], m[2], m[3]].map((x) => Number(x).toString(16).padStart(2, '0')).join('')}`;
  return '#000000';
}
