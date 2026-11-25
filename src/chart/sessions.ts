// Uzatılmış seansta ön piyasa (turuncu) ve son piyasa (mavi) mumlarının arkasını gölgelendirir.
// Mumların arkasına çizilsin diye zLevel < 0 olan, başlığı/değeri olmayan bir gösterge olarak eklenir.
// Ayrıca ABD gece seansında son fiyatı mor noktalı çizgi ve "Gece seansı" etiketiyle gösterir (TradingView gibi).
import { registerIndicator, type Chart } from 'klinecharts';
import type { SessionShading } from '../data/feed.ts';
import { extendedPart } from '../data/session.ts';
import { cssVar } from '../ui/theme.ts';
import { FONT, toTurkishNumber } from './chart.ts';

const NAME = 'gtSessions';
const NIGHT = 'gtOvernight';
const CANDLE_PANE = 'candle_pane';
const noTooltip = () => ({ name: '', calcParams: [], calcParamsText: '', features: [], legends: [] });

let nightChart: Chart | null = null;

/** Gece seansı fiyatı (null: gösterme). */
export function setOvernightPrice(price: number | null): void {
  nightChart?.overrideIndicator({ name: NIGHT, calcParams: [price ?? 0] });
}

export function installSessionShading(chart: Chart, info: () => SessionShading | null): void {
  registerIndicator({
    name: NAME,
    shortName: '',
    series: 'price',
    figures: [],
    calc: (dataList) => dataList.map(() => ({})),
    createTooltipDataSource: noTooltip,
    draw: ({ ctx, chart: c, bounding, xAxis }) => {
      const s = info();
      if (!s) return true;
      const list = c.getDataList();
      const { from, to } = c.getVisibleRange();
      const half = c.getBarSpace().halfGapBar;
      const colors = { pre: cssVar('--session-pre'), post: cssVar('--session-post') };
      // Art arda gelen aynı türdeki mumlar tek dikdörtgende birleşir (çizgi çizgi görünmesin).
      let runKind: 'pre' | 'post' | null = null;
      let runStart = 0;
      let runEnd = 0;
      const flush = () => {
        if (!runKind) return;
        ctx.fillStyle = colors[runKind];
        const x0 = Math.max(0, Math.round(runStart));
        const x1 = Math.min(bounding.width, Math.round(runEnd));
        if (x1 > x0) ctx.fillRect(x0, 0, x1 - x0, bounding.height);
      };
      for (let i = Math.max(0, from); i < Math.min(list.length, to); i++) {
        const kind = extendedPart(list[i].timestamp, s.spanMs, s.regular, s.timeZone);
        const x = xAxis.convertToPixel(i);
        if (kind !== runKind) {
          flush();
          runKind = kind;
          runStart = x - half;
        }
        runEnd = x + half;
      }
      flush();
      return true;
    },
  });
  chart.createIndicator({ name: NAME, paneId: CANDLE_PANE, zLevel: -1 }, true);

  registerIndicator({
    name: NIGHT,
    shortName: '',
    series: 'price',
    // Değer yalnızca son mumda: fiyat ekseni gece fiyatını da kapsasın (çizgiyi draw kendisi çizer).
    figures: [{ key: 'v', title: '', type: 'line' }],
    calcParams: [0],
    calc: (dataList, indicator) => {
      const price = Number(indicator.calcParams[0]);
      const last = dataList.length - 1;
      return dataList.map((_, i) => (i === last && price > 0 ? { v: price } : {}));
    },
    createTooltipDataSource: noTooltip,
    draw: ({ ctx, chart: c, indicator, bounding, yAxis }) => {
      const price = Number(indicator.calcParams[0]);
      if (!(price > 0)) return true;
      const y = Math.round(yAxis.convertToPixel(price)) + 0.5;
      if (y < 0 || y > bounding.height) return true;
      const color = cssVar('--session-night');
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(bounding.width, y);
      ctx.stroke();
      ctx.setLineDash([]);
      // Etiket: fiyat ekseninin hemen solunda
      const precision = c.getSymbol()?.pricePrecision ?? 2;
      const text = `Gece seansı ${toTurkishNumber(price.toFixed(precision))}`;
      ctx.font = `600 12px ${FONT}`;
      const w = Math.ceil(ctx.measureText(text).width) + 12;
      const h = 20;
      const x = Math.round(bounding.width - w - 2);
      const top = Math.round(y - h / 2);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.roundRect(x, top, w, h, 3);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, x + 6, top + h / 2 + 0.5);
      return true;
    },
  });
  chart.createIndicator({ name: NIGHT, paneId: CANDLE_PANE }, true);
  nightChart = chart;
}
