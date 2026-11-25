// Grafiğin altındaki çubuk: tarih aralıkları, saat, ölçek (log / % / ters).
import type { Chart } from 'klinecharts';
import { DISPLAY_TIMEZONE } from '../chart/chart.ts';
import { LOG_AXIS } from '../chart/logAxis.ts';
import type { Interval } from '../data/intervals.ts';
import { extendedHours } from '../data/session.ts';
import { load, save } from '../store.ts';
import { h, isModalOpen, isTyping } from './dom.ts';

export type ScaleMode = 'normal' | 'logarithm' | 'percentage';

interface ScalePrefs {
  mode: ScaleMode;
  reverse: boolean;
}

export interface RangeDef {
  label: string;
  title: string;
  interval: Interval;
  /** Saniye cinsinden süre; 'ytd' yılbaşından beri, 'all' tüm veri */
  span: number | 'ytd' | 'all';
}

const DAY = 86400;

export const RANGES: RangeDef[] = [
  { label: '1G', title: '1 gün (1 dakikalık)', interval: { unit: 'minute', span: 1 }, span: DAY },
  { label: '5G', title: '5 gün (5 dakikalık)', interval: { unit: 'minute', span: 5 }, span: 5 * DAY },
  { label: '1A', title: '1 ay (30 dakikalık)', interval: { unit: 'minute', span: 30 }, span: 30 * DAY },
  { label: '3A', title: '3 ay (1 saatlik)', interval: { unit: 'hour', span: 1 }, span: 91 * DAY },
  { label: '6A', title: '6 ay (2 saatlik)', interval: { unit: 'hour', span: 2 }, span: 182 * DAY },
  { label: 'YB', title: 'Yılbaşından beri (günlük)', interval: { unit: 'day', span: 1 }, span: 'ytd' },
  { label: '1Y', title: '1 yıl (günlük)', interval: { unit: 'day', span: 1 }, span: 365 * DAY },
  { label: '5Y', title: '5 yıl (haftalık)', interval: { unit: 'week', span: 1 }, span: 5 * 365 * DAY },
  { label: 'Tümü', title: 'Tüm geçmiş (aylık)', interval: { unit: 'month', span: 1 }, span: 'all' },
];

const CANDLE_PANE = 'candle_pane';

export class BottomBar {
  private prefs: ScalePrefs = { mode: 'normal', reverse: false, ...load<Partial<ScalePrefs>>('scale', {}) };
  private readonly pctBtn: HTMLButtonElement;
  private readonly logBtn: HTMLButtonElement;
  private readonly revBtn: HTMLButtonElement;
  private readonly extBtn: HTMLButtonElement;
  private readonly clock: HTMLElement;
  private axisPosition: 'right' | 'left' = 'right';
  private timeZone = DISPLAY_TIMEZONE;
  private timeFmt = BottomBar.makeFormat(DISPLAY_TIMEZONE);

  private static makeFormat(timeZone: string): Intl.DateTimeFormat {
    return new Intl.DateTimeFormat('tr-TR', { timeZone, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  constructor(
    el: HTMLElement,
    private readonly chart: Chart,
    onRange: (r: RangeDef) => void,
    onExtended: (on: boolean) => void,
  ) {
    const ranges = h('div', { class: 'bb-ranges' });
    for (const r of RANGES) {
      ranges.append(h('button', { class: 'bb-btn', text: r.label, title: r.title, onclick: () => onRange(r) }));
    }
    this.clock = h('span', { class: 'bb-clock', title: `Saat dilimi: ${DISPLAY_TIMEZONE}` });
    this.pctBtn = h('button', { class: 'bb-btn', text: '%', title: 'Yüzde ölçek (Alt+P)', onclick: () => this.toggle('percentage') });
    this.logBtn = h('button', { class: 'bb-btn', text: 'log', title: 'Logaritmik ölçek (Alt+L)', onclick: () => this.toggle('logarithm') });
    this.revBtn = h('button', {
      class: 'bb-btn',
      text: 'ters',
      title: 'Ölçeği ters çevir (Alt+I)',
      onclick: () => this.setScale({ ...this.prefs, reverse: !this.prefs.reverse }),
    });
    this.extBtn = h('button', {
      class: 'bb-btn',
      text: 'Uzatılmış',
      onclick: () => {
        onExtended(!extendedHours());
        this.updateExtended();
      },
    });
    this.updateExtended();
    el.append(
      ranges,
      h('div', { class: 'spacer' }),
      this.clock,
      h('span', { class: 'bb-sep' }),
      this.extBtn,
      h('span', { class: 'bb-sep' }),
      this.pctBtn,
      this.logBtn,
      this.revBtn,
    );

    this.applyScale();
    this.tick();
    setInterval(() => this.tick(), 1000);

    document.addEventListener('keydown', (e) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || isTyping(e) || isModalOpen()) return;
      if (e.code === 'KeyL') this.toggle('logarithm');
      else if (e.code === 'KeyP') this.toggle('percentage');
      else if (e.code === 'KeyI') this.setScale({ ...this.prefs, reverse: !this.prefs.reverse });
      else return;
      e.preventDefault();
    });
  }

  private extAvailable = true;

  /** Açık sembolde ön/son piyasa verisi var mı (yoksa düğme soluk görünür). */
  setExtendedAvailable(available: boolean): void {
    this.extAvailable = available;
    this.updateExtended();
  }

  private updateExtended(): void {
    const on = extendedHours();
    this.extBtn.classList.toggle('active', on);
    this.extBtn.classList.toggle('unavailable', !this.extAvailable);
    this.extBtn.setAttribute('aria-pressed', String(on));
    this.extBtn.title = this.extAvailable
      ? `Uzatılmış seans: ${on ? 'açık' : 'kapalı'}. ABD hisselerinde ön piyasa (04:00–09:30) ve son piyasa (16:00–20:00, New York saati) mumları. Gece seansı verisi yok.`
      : 'Bu sembolde ön/son piyasa verisi yok (yalnızca ABD hisse ve ETF’lerinde var).';
  }

  private tick(): void {
    this.clock.textContent = `${this.timeFmt.format(new Date())} (${utcLabel(this.timeZone)})`;
  }

  /** Grafik ayarlarındaki saat dilimi (saat göstergesi de ona göre). */
  setTimezone(tz: string): void {
    if (tz === this.timeZone) return;
    this.timeZone = tz;
    this.timeFmt = BottomBar.makeFormat(tz);
    this.clock.title = `Saat dilimi: ${tz}`;
    this.tick();
  }

  setAxisPosition(pos: 'right' | 'left'): void {
    if (pos === this.axisPosition) return;
    this.axisPosition = pos;
    this.applyScale();
  }

  get mode(): ScaleMode {
    return this.prefs.mode;
  }

  /** Dışarıdan ölçek seçimi (ör. karşılaştırma eklenince yüzde ölçeğe geç). */
  setMode(mode: ScaleMode): void {
    if (mode !== this.prefs.mode) this.setScale({ ...this.prefs, mode });
  }

  get reverse(): boolean {
    return this.prefs.reverse;
  }

  toggleReverse(): void {
    this.setScale({ ...this.prefs, reverse: !this.prefs.reverse });
  }

  private toggle(mode: ScaleMode): void {
    this.setScale({ ...this.prefs, mode: this.prefs.mode === mode ? 'normal' : mode });
  }

  private setScale(p: ScalePrefs): void {
    this.prefs = p;
    save('scale', p);
    this.applyScale();
  }

  private applyScale(): void {
    // Tüm panellerin ekseni aynı tarafta; fiyat panelinde ölçek türü de uygulanır.
    this.chart.overrideYAxis({ position: this.axisPosition });
    // Log için kütüphanenin log(1+x) ekseni yerine gerçek log ekseni (logAxis.ts).
    const name = this.prefs.mode === 'logarithm' ? LOG_AXIS : this.prefs.mode;
    this.chart.overrideYAxis({ paneId: CANDLE_PANE, name, reverse: this.prefs.reverse, position: this.axisPosition });
    const set = (b: HTMLButtonElement, on: boolean) => {
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    };
    set(this.pctBtn, this.prefs.mode === 'percentage');
    set(this.logBtn, this.prefs.mode === 'logarithm');
    set(this.revBtn, this.prefs.reverse);
  }
}

/** "UTC+3", "UTC−5", "UTC" */
function utcLabel(timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'shortOffset' }).formatToParts(new Date());
    const off = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
    return off.replace('GMT', 'UTC');
  } catch {
    return 'UTC';
  }
}

/** Seçilen aralık ekrana sığacak şekilde mum genişliğini ayarlar. */
export function fitRange(chart: Chart, r: RangeDef): void {
  const list = chart.getDataList();
  if (list.length === 0) return;
  const lastTs = list[list.length - 1].timestamp;
  let from: number;
  if (r.span === 'all') from = -Infinity;
  else if (r.span === 'ytd') from = Date.UTC(new Date(lastTs).getUTCFullYear(), 0, 1) - 3 * 3600 * 1000;
  else from = lastTs - r.span * 1000;
  let idx = list.findIndex((b) => b.timestamp >= from);
  if (idx < 0) idx = 0;
  const count = list.length - idx;
  const size = chart.getSize(CANDLE_PANE, 'main');
  const width = size?.width ?? 800;
  // Son mumdan sonraki sağ boşluğu da hesaba kat.
  const usable = Math.max(100, width - chart.getOffsetRightDistance());
  chart.setBarSpace(Math.max(1, Math.min(50, usable / Math.max(1, count))));
  chart.scrollToRealTime();
}
