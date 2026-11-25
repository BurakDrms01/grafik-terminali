// Sembol karşılaştırma (TradingView'daki "+" düğmesi): başka sembolleri fiyat grafiğinin üstüne çizgi olarak ekler.
// Çizgiler ekranın sol kenarındaki mumda ana sembolle aynı noktadan başlar; böylece yüzde olarak kıyaslanır.
import { registerIndicator, type Chart, type IndicatorCreate, type IndicatorTooltipData, type VisibleRange } from 'klinecharts';
import { loadSeries } from '../data/feed.ts';
import type { Interval } from '../data/intervals.ts';
import type { Quote, SymbolDef } from '../data/types.ts';
import { load, save } from '../store.ts';
import { toast } from '../ui/dom.ts';
import { displayTicker } from '../ui/format.ts';
import { toTurkishNumber } from './chart.ts';
import { featuresFor } from './indicators.ts';

const NAME = 'gtCompare';
const COLORS = ['#ff6d00', '#2962ff', '#9c27b0', '#00897b', '#e91e63', '#795548'];
const MAX = 6;

interface Entry {
  def: SymbolDef;
  color: string;
  id: string | null;
  ts: number[];
  closes: number[];
  precision: number;
  version: number;
  visible: boolean;
}

interface Point {
  v?: number;
  raw?: number;
}

/** calcParams: [sol kenardaki mumun zamanı, sürüm, mum süresi (ms)] */
type Params = [number, number, number];

/** Kütüphane extendData'yı kopyaladığı için veriler burada tutulur; göstergede yalnızca anahtar durur. */
const REGISTRY = new Map<string, Entry>();

interface Ext {
  key: string;
}

let registered = false;

function register(): void {
  if (registered) return;
  registered = true;
  registerIndicator<Point, number, Ext>({
    name: NAME,
    shortName: 'Karşılaştır',
    series: 'price',
    precision: 2,
    calcParams: [0, 0, 60_000],
    figures: [{ key: 'v', title: '', type: 'line' }],
    calc: (dataList, indicator) => {
      const e = REGISTRY.get((indicator.extendData as Ext | undefined)?.key ?? '');
      const out: Point[] = dataList.map(() => ({}));
      if (!e || e.ts.length === 0) return out;
      const [anchorTs, , spanMs] = indicator.calcParams as Params;
      // Her mum için o mumun içinde ya da öncesindeki son karşılaştırma kapanışı.
      const raws: (number | undefined)[] = [];
      let j = 0;
      for (const d of dataList) {
        const limit = d.timestamp + spanMs - 1;
        while (j < e.ts.length && e.ts[j] <= limit) j++;
        raws.push(j > 0 ? e.closes[j - 1] : undefined);
      }
      let k = dataList.findIndex((d, i) => d.timestamp >= anchorTs && raws[i] !== undefined && d.close > 0);
      if (k < 0) k = raws.findIndex((r) => r !== undefined);
      if (k < 0) return out;
      const f = dataList[k].close / (raws[k] as number);
      raws.forEach((r, i) => {
        if (r !== undefined) out[i] = { v: r * f, raw: r };
      });
      return out;
    },
  });
}

export interface CompareDeps {
  chart: Chart;
  getInterval(): Interval;
  /** İlk karşılaştırma eklenince (TradingView gibi) yüzde ölçeğe geç */
  onFirstAdd(): void;
  onChange(): void;
}

export class Compare {
  private entries: Entry[] = [];
  private anchorTs = 0;
  private anchorTimer: ReturnType<typeof setTimeout> | undefined;
  private quoteTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly deps: CompareDeps) {
    register();
    const { chart } = deps;
    chart.subscribeAction('onVisibleRangeChange', (r) => {
      clearTimeout(this.anchorTimer);
      this.anchorTimer = setTimeout(() => this.reanchor(r as VisibleRange), 120);
    });
    chart.subscribeAction('onIndicatorTooltipFeatureClick', (data) => {
      const d = data as { feature?: { id?: string }; indicator?: { id?: string } };
      const e = this.entries.find((x) => x.id && x.id === d.indicator?.id);
      if (!e) return;
      if (d.feature?.id === 'gt-close') this.remove(e);
      else if (d.feature?.id === 'gt-eye' || d.feature?.id === 'gt-eye-off') {
        e.visible = !e.visible;
        if (e.id) chart.overrideIndicator({ id: e.id, name: NAME, visible: e.visible });
      }
    });
  }

  /** Kayıtlı karşılaştırmaları geri yükler (grafik ilk açıldığında). */
  restore(): void {
    for (const def of load<SymbolDef[]>('compare', [])) void this.add(def, true);
  }

  ids(): string[] {
    return this.entries.map((e) => e.def.id);
  }

  defs(): SymbolDef[] {
    return this.entries.map((e) => e.def);
  }

  private persist(): void {
    save(
      'compare',
      this.entries.map((e) => e.def),
    );
    this.deps.onChange();
  }

  private spanMs(): number {
    const iv = this.deps.getInterval();
    const unit = { second: 1, minute: 60, hour: 3600, day: 86400, week: 604800, month: 2629800 }[iv.unit];
    return unit * iv.span * 1000;
  }

  private params(e: Entry): Params {
    return [this.anchorTs, e.version, this.spanMs()];
  }

  private refresh(e: Entry): void {
    e.version++;
    if (e.id) this.deps.chart.overrideIndicator({ id: e.id, name: NAME, calcParams: this.params(e) });
  }

  private reanchor(r: VisibleRange): void {
    const list = this.deps.chart.getDataList();
    const ts = list[Math.max(0, Math.floor(r.from))]?.timestamp;
    if (ts === undefined || ts === this.anchorTs) return;
    this.anchorTs = ts;
    this.entries.forEach((e) => this.refresh(e));
  }

  async add(def: SymbolDef, silent = false): Promise<void> {
    if (this.entries.some((e) => e.def.id === def.id)) {
      if (!silent) toast('Zaten karşılaştırılıyor', displayTicker(def));
      return;
    }
    if (this.entries.length >= MAX) {
      toast('En fazla 6 sembol karşılaştırılabilir');
      return;
    }
    const used = new Set(this.entries.map((e) => e.color));
    const e: Entry = {
      def,
      color: COLORS.find((c) => !used.has(c)) ?? COLORS[this.entries.length % COLORS.length],
      id: null,
      ts: [],
      closes: [],
      precision: 2,
      version: 0,
      visible: true,
    };
    const first = this.entries.length === 0;
    this.entries.push(e);
    REGISTRY.set(def.id, e);
    const value: IndicatorCreate<Point, number, Ext> = {
      name: NAME,
      paneId: 'candle_pane',
      calcParams: this.params(e),
      extendData: { key: def.id },
      styles: { lines: [{ color: e.color, size: 2, style: 'solid', smooth: false, dashedValue: [] }] },
      createTooltipDataSource: ({ indicator, crosshair }) => this.tooltip(e, indicator.result as Point[], crosshair.dataIndex, indicator.visible),
    };
    e.id = this.deps.chart.createIndicator(value as IndicatorCreate, true);
    this.persist();
    if (first && !silent) this.deps.onFirstAdd();
    await this.loadData(e);
  }

  private async loadData(e: Entry): Promise<void> {
    const list = this.deps.chart.getDataList();
    try {
      const { symbol, bars } = await loadSeries(e.def, this.deps.getInterval(), list[0]?.timestamp);
      if (!this.entries.includes(e)) return;
      e.ts = bars.map((b) => b.timestamp);
      e.closes = bars.map((b) => b.close);
      e.precision = symbol.pricePrecision;
      this.refresh(e);
    } catch (err) {
      if (!this.entries.includes(e)) return;
      toast('Karşılaştırma yüklenemedi', `${displayTicker(e.def)}: ${err instanceof Error ? err.message : String(err)}`, 'error');
      this.remove(e);
    }
  }

  private tooltip(e: Entry, result: Point[], dataIndex: number | undefined, visible: boolean): IndicatorTooltipData {
    const features = featuresFor(visible).filter((f) => f.id !== 'gt-settings');
    const i = dataIndex ?? result.length - 1;
    const raw = result[i]?.raw;
    const anchorIdx = result.findIndex((p) => p.raw !== undefined && p.v !== undefined);
    const list = this.deps.chart.getDataList();
    let pct: number | undefined;
    if (raw !== undefined) {
      const k = list.findIndex((d, j) => d.timestamp >= this.anchorTs && result[j]?.raw !== undefined);
      const base = result[k >= 0 ? k : anchorIdx]?.raw;
      if (base) pct = (raw / base - 1) * 100;
    }
    const text =
      raw === undefined
        ? e.ts.length === 0
          ? 'yükleniyor…'
          : '—'
        : `${toTurkishNumber(raw.toFixed(e.precision))}${pct !== undefined ? `  ${pct >= 0 ? '+' : ''}${toTurkishNumber(pct.toFixed(2))}%` : ''}`;
    return {
      name: displayTicker(e.def),
      calcParamsText: '',
      features,
      legends: [{ title: '', value: { text, color: e.color } }],
    };
  }

  remove(e: Entry): void {
    if (e.id) this.deps.chart.removeIndicator({ id: e.id });
    REGISTRY.delete(e.def.id);
    this.entries = this.entries.filter((x) => x !== e);
    this.persist();
  }

  removeAll(): void {
    [...this.entries].forEach((e) => this.remove(e));
  }

  /** Dilim değişince karşılaştırma verisi yeni dilimle yeniden yüklenir. */
  reload(): void {
    for (const e of this.entries) {
      e.ts = [];
      e.closes = [];
      this.refresh(e);
      void this.loadData(e);
    }
  }

  /** Canlı fiyat: son noktayı günceller ya da yeni mum ekler. */
  ingest(q: Quote): void {
    const e = this.entries.find((x) => x.def.id === q.id);
    if (!e || e.ts.length === 0 || !Number.isFinite(q.price)) return;
    const lastTs = e.ts[e.ts.length - 1];
    const time = q.time || Date.now();
    if (time >= lastTs + this.spanMs()) {
      e.ts.push(time);
      e.closes.push(q.price);
    } else {
      e.closes[e.closes.length - 1] = q.price;
    }
    clearTimeout(this.quoteTimer);
    this.quoteTimer = setTimeout(() => this.entries.forEach((x) => this.refresh(x)), 500);
  }
}
