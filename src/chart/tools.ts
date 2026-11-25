// Özel çizim araçları (KLineChart overlay'leri) ve sol araç çubuğundaki gruplar.
import {
  registerOverlay,
  type Chart,
  type Coordinate,
  type Overlay,
  type OverlayCreateFiguresCallbackParams,
  type OverlayFigure,
  type OverlayTemplate,
} from 'klinecharts';
import { cssVar, withAlpha } from '../ui/theme.ts';
import { FONT, toTurkishNumber } from './chart.ts';
import { extensionPrice, FIB_TIME_SEQUENCE, normalizeFibSettings, retracementPrice, type FibSettings } from './fib.ts';

type P = OverlayCreateFiguresCallbackParams<unknown>;

// ---------- Yardımcılar ----------

function lineColor(o: Overlay<unknown>, fallback = '--accent'): string {
  const c = o.styles?.line?.color;
  return typeof c === 'string' && c ? c : cssVar(fallback);
}

function lineSize(o: Overlay<unknown>): number {
  const s = o.styles?.line?.size;
  return typeof s === 'number' ? s : 1;
}

function fmtPrice(chart: Chart, v: number): string {
  const p = chart.getSymbol()?.pricePrecision ?? 2;
  return toTurkishNumber(v.toFixed(p));
}

function fmtPct(v: number): string {
  return `${v > 0 ? '+' : ''}${toTurkishNumber(v.toFixed(2))}%`;
}

function fmtDuration(ms: number): string {
  const m = Math.round(Math.abs(ms) / 60000);
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  const mm = m % 60;
  return [d ? `${d}g` : '', h ? `${h}sa` : '', mm ? `${mm}dk` : ''].filter(Boolean).join(' ') || '0dk';
}

function text(
  x: number,
  y: number,
  t: string,
  color: string,
  o: { align?: CanvasTextAlign; baseline?: CanvasTextBaseline; size?: number; weight?: string | number } = {},
): OverlayFigure {
  return {
    type: 'text',
    ignoreEvent: true,
    attrs: { x, y, text: t, align: o.align ?? 'left', baseline: o.baseline ?? 'bottom' },
    styles: {
      family: FONT,
      color,
      size: o.size ?? 12,
      weight: o.weight ?? 'normal',
      backgroundColor: 'transparent',
      borderSize: 0,
      borderColor: 'transparent',
      paddingLeft: 3,
      paddingRight: 3,
      paddingTop: 1,
      paddingBottom: 1,
    },
  };
}

function box(
  x: number,
  y: number,
  t: string,
  bg: string,
  o: { align?: CanvasTextAlign; baseline?: CanvasTextBaseline; color?: string } = {},
): OverlayFigure {
  return {
    type: 'text',
    ignoreEvent: true,
    attrs: { x, y, text: t, align: o.align ?? 'center', baseline: o.baseline ?? 'middle' },
    styles: {
      family: FONT,
      color: o.color ?? '#ffffff',
      size: 12,
      weight: 600,
      backgroundColor: bg,
      borderColor: bg,
      borderSize: 0,
      borderRadius: 4,
      paddingLeft: 7,
      paddingRight: 7,
      paddingTop: 4,
      paddingBottom: 4,
    },
  };
}

function line(a: Coordinate, b: Coordinate, styles?: Record<string, unknown>, ignoreEvent = false): OverlayFigure {
  return { type: 'line', attrs: { coordinates: [a, b] }, styles, ignoreEvent };
}

const DASHED = { style: 'dashed', dashedValue: [4, 4], size: 1 };

function arrowHead(from: Coordinate, to: Coordinate, color: string, size = 10): OverlayFigure {
  const ang = Math.atan2(to.y - from.y, to.x - from.x);
  const p1 = { x: to.x - size * Math.cos(ang - Math.PI / 7), y: to.y - size * Math.sin(ang - Math.PI / 7) };
  const p2 = { x: to.x - size * Math.cos(ang + Math.PI / 7), y: to.y - size * Math.sin(ang + Math.PI / 7) };
  return { type: 'polygon', ignoreEvent: true, attrs: { coordinates: [to, p1, p2] }, styles: { style: 'fill', color } };
}

function bars(p: P, a: Coordinate, b: Coordinate): number {
  if (!p.xAxis) return 0;
  return Math.round(p.xAxis.convertFromPixel(b.x)) - Math.round(p.xAxis.convertFromPixel(a.x));
}

/** Etiket noktanın tepe mi dip mi olduğuna göre üstte ya da altta durur. */
function pointLabel(cs: Coordinate[], i: number, t: string, color: string): OverlayFigure {
  const c = cs[i];
  const neighbors = [cs[i - 1], cs[i + 1]].filter(Boolean);
  const avg = neighbors.length ? neighbors.reduce((s, n) => s + n.y, 0) / neighbors.length : c.y + 1;
  const above = c.y <= avg;
  return text(c.x, above ? c.y - 6 : c.y + 6, t, color, { align: 'center', baseline: above ? 'bottom' : 'top', size: 13, weight: 700 });
}

function ratio(a?: number, b?: number, c?: number): string {
  if (a === undefined || b === undefined || c === undefined || a === b) return '';
  return toTurkishNumber((Math.abs(c - b) / Math.abs(b - a)).toFixed(3));
}

// ---------- Fibonacci ----------

function fibLevelLabel(s: FibSettings, level: number, price: string): string {
  const lv = s.levelsAsPercent ? `%${toTurkishNumber((level * 100).toFixed(1))}` : toTurkishNumber(String(level));
  return [s.showLevels ? lv : '', s.showPrices ? `(${price})` : ''].filter(Boolean).join(' ');
}

function fibFigures(
  p: P,
  s: FibSettings,
  left: number,
  right: number,
  priceOf: (level: number) => number,
): OverlayFigure[] {
  const { chart, yAxis, overlay } = p;
  if (!yAxis) return [];
  const width = lineSize(overlay);
  const shown = s.levels.filter((l) => l.show).sort((a, b) => a.value - b.value);
  const rows = shown.map((l) => ({ ...l, price: priceOf(l.value), y: yAxis.convertToPixel(priceOf(l.value)) }));
  const out: OverlayFigure[] = [];
  if (s.background) {
    for (let i = 0; i < rows.length - 1; i++) {
      const a = rows[i];
      const b = rows[i + 1];
      out.push({
        type: 'polygon',
        ignoreEvent: true,
        attrs: { coordinates: [{ x: left, y: a.y }, { x: right, y: a.y }, { x: right, y: b.y }, { x: left, y: b.y }] },
        styles: { style: 'fill', color: withAlpha(b.color, s.backgroundOpacity) },
      });
    }
  }
  for (const r of rows) {
    out.push(line({ x: left, y: r.y }, { x: right, y: r.y }, { color: r.color, size: width, style: 'solid' }));
    const label = fibLevelLabel(s, r.value, fmtPrice(chart, r.price));
    if (label) {
      out.push(
        s.labelSide === 'left'
          ? text(left, r.y, label, r.color, { align: 'left', baseline: 'bottom', weight: 600 })
          : text(right, r.y, label, r.color, { align: 'right', baseline: 'bottom', weight: 600 }),
      );
    }
  }
  return out;
}

const fibRetracement: OverlayTemplate = {
  name: 'gtFibRetracement',
  totalStep: 3,
  needDefaultPointFigure: true,
  needDefaultXAxisFigure: true,
  needDefaultYAxisFigure: true,
  createPointFigures: (p) => {
    const { coordinates: cs, overlay, bounding } = p;
    if (cs.length < 2) return [];
    const a = overlay.points[0]?.value;
    const b = overlay.points[1]?.value;
    if (a === undefined || b === undefined) return [];
    const s = normalizeFibSettings(overlay.extendData, 'retracement');
    const [start, end] = s.reverse ? [b, a] : [a, b];
    const left = s.extendLeft ? 0 : Math.min(cs[0].x, cs[1].x);
    const right = s.extendRight ? bounding.width : Math.max(cs[0].x, cs[1].x);
    const out = fibFigures(p, s, left, right, (lv) => retracementPrice(start, end, lv, s.log));
    if (s.trendLine) out.unshift(line(cs[0], cs[1], { ...DASHED, color: cssVar('--muted') }, true));
    return out;
  },
};

const fibExtension: OverlayTemplate = {
  name: 'gtFibExtension',
  totalStep: 4,
  needDefaultPointFigure: true,
  needDefaultXAxisFigure: true,
  needDefaultYAxisFigure: true,
  createPointFigures: (p) => {
    const { coordinates: cs, overlay, bounding } = p;
    const s = normalizeFibSettings(overlay.extendData, 'extension');
    const out: OverlayFigure[] = [];
    if (cs.length >= 2) out.push(line(cs[0], cs[1], { ...DASHED, color: cssVar('--muted') }));
    if (cs.length >= 3) out.push(line(cs[1], cs[2], { ...DASHED, color: cssVar('--muted') }));
    const [a, b, c] = overlay.points.map((x) => x.value);
    if (cs.length < 3 || a === undefined || b === undefined || c === undefined) return out;
    const span = Math.max(60, Math.abs(cs[1].x - cs[0].x));
    const left = s.extendLeft ? 0 : cs[2].x;
    const right = s.extendRight ? bounding.width : cs[2].x + span;
    return [...out, ...fibFigures(p, s, left, right, (lv) => (s.reverse ? extensionPrice(b, a, c, lv, s.log) : extensionPrice(a, b, c, lv, s.log)))];
  },
};

const FIB_TIME_COLORS = ['#8f8a7f', '#5ba4c9', '#4cb38a', '#e58a3a', '#e0614f', '#b48ade', '#d97757'];

const fibTimeZone: OverlayTemplate = {
  name: 'gtFibTimeZone',
  totalStep: 3,
  needDefaultPointFigure: true,
  needDefaultXAxisFigure: true,
  needDefaultYAxisFigure: false,
  createPointFigures: (p) => {
    const { coordinates: cs, bounding, xAxis } = p;
    if (cs.length < 2 || !xAxis) return [];
    const i0 = Math.round(xAxis.convertFromPixel(cs[0].x));
    const unit = Math.round(xAxis.convertFromPixel(cs[1].x)) - i0 || 1;
    const out: OverlayFigure[] = [];
    FIB_TIME_SEQUENCE.forEach((n, k) => {
      const x = xAxis.convertToPixel(i0 + n * unit);
      if (x < -bounding.width || x > bounding.width * 2) return;
      const color = FIB_TIME_COLORS[k % FIB_TIME_COLORS.length];
      out.push(line({ x, y: 0 }, { x, y: bounding.height }, { color, size: lineSize(p.overlay), style: 'solid' }));
      out.push(text(x + 2, bounding.height - 4, String(n), color, { align: 'left', baseline: 'bottom', weight: 700, size: 13 }));
    });
    return out;
  },
};

// ---------- Çizgiler ----------

const infoLine: OverlayTemplate = {
  name: 'gtInfoLine',
  totalStep: 3,
  needDefaultPointFigure: true,
  needDefaultXAxisFigure: true,
  needDefaultYAxisFigure: true,
  createPointFigures: (p) => {
    const { coordinates: cs, overlay, chart } = p;
    if (cs.length < 2) return [];
    const out: OverlayFigure[] = [line(cs[0], cs[1])];
    const [a, b] = overlay.points.map((x) => x.value);
    if (a === undefined || b === undefined) return out;
    const n = bars(p, cs[0], cs[1]);
    const ang = (Math.atan2(cs[0].y - cs[1].y, cs[1].x - cs[0].x) * 180) / Math.PI;
    const t = `${fmtPrice(chart, b - a)} (${fmtPct(((b - a) / a) * 100)}) · ${n} mum · ${toTurkishNumber(ang.toFixed(1))}°`;
    out.push(box(cs[1].x + 8, cs[1].y, t, withAlpha(lineColor(overlay), 0.9), { align: 'left' }));
    return out;
  },
};

/** TradingView gibi tek tıkla çizilen, her zaman sağa uzanan yatay ışın. */
const horizontalRay: OverlayTemplate = {
  name: 'horizontalRayLine',
  totalStep: 2,
  needDefaultPointFigure: true,
  needDefaultXAxisFigure: true,
  needDefaultYAxisFigure: true,
  createPointFigures: ({ coordinates: cs, bounding }) => {
    if (cs.length < 1) return [];
    return [line(cs[0], { x: bounding.width, y: cs[0].y })];
  },
  performEventPressedMove: ({ points, performPoint }) => {
    for (const p of points) p.value = performPoint.value;
  },
};

const crossLine: OverlayTemplate = {
  name: 'gtCrossLine',
  totalStep: 2,
  needDefaultPointFigure: true,
  needDefaultXAxisFigure: true,
  needDefaultYAxisFigure: true,
  createPointFigures: ({ coordinates: cs, bounding }) => {
    if (cs.length < 1) return [];
    const c = cs[0];
    return [line({ x: 0, y: c.y }, { x: bounding.width, y: c.y }), line({ x: c.x, y: 0 }, { x: c.x, y: bounding.height })];
  },
};

const pitchfork: OverlayTemplate = {
  name: 'gtPitchfork',
  totalStep: 4,
  needDefaultPointFigure: true,
  needDefaultXAxisFigure: true,
  needDefaultYAxisFigure: true,
  createPointFigures: ({ coordinates: cs, bounding }) => {
    if (cs.length < 2) return [];
    if (cs.length < 3) return [line(cs[0], cs[1])];
    const [p0, p1, p2] = cs;
    const m = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
    let dx = m.x - p0.x;
    const dy = m.y - p0.y;
    if (Math.abs(dx) < 1) dx = 1;
    const targetX = dx > 0 ? bounding.width : 0;
    const ext = (s: Coordinate) => ({ x: targetX, y: s.y + (dy / dx) * (targetX - s.x) });
    return [line(p0, ext(p0)), line(p1, ext(p1)), line(p2, ext(p2)), line(p1, p2, DASHED)];
  },
};

export interface ChannelData {
  extendLeft?: boolean;
  extendRight?: boolean;
  /** Kesikli orta çizgi (varsayılan açık) */
  middle?: boolean;
  /** Kanal içi dolgu (varsayılan açık) */
  background?: boolean;
}

/** TradingView tarzı paralel kanal: 1-2. nokta ana çizgi, 3. nokta kanal genişliği; ortada kesikli çizgi. */
const parallelChannel: OverlayTemplate = {
  name: 'gtParallelChannel',
  totalStep: 4,
  needDefaultPointFigure: true,
  needDefaultXAxisFigure: true,
  needDefaultYAxisFigure: true,
  createPointFigures: ({ coordinates: cs, overlay, bounding }) => {
    if (cs.length < 2) return [];
    const d = (overlay.extendData ?? {}) as ChannelData;
    const [p0, p1] = cs;
    const k = (p1.y - p0.y) / (p1.x - p0.x || 1e-9);
    const yAt = (x: number, off: number) => p0.y + k * (x - p0.x) + off;
    const left = d.extendLeft ? 0 : Math.min(p0.x, p1.x);
    const right = d.extendRight ? bounding.width : Math.max(p0.x, p1.x);
    const seg = (off: number): [Coordinate, Coordinate] => [
      { x: left, y: yAt(left, off) },
      { x: right, y: yAt(right, off) },
    ];
    const base = seg(0);
    if (cs.length < 3) return [line(base[0], base[1])];
    const off = cs[2].y - yAt(cs[2].x, 0);
    const other = seg(off);
    const out: OverlayFigure[] = [];
    if (d.background !== false) {
      out.push({ type: 'polygon', ignoreEvent: true, attrs: { coordinates: [base[0], base[1], other[1], other[0]] }, styles: { style: 'fill' } });
    }
    out.push(line(base[0], base[1]), line(other[0], other[1]));
    if (d.middle !== false) {
      const mid = seg(off / 2);
      out.push(line(mid[0], mid[1], { style: 'dashed', dashedValue: [5, 5] }));
    }
    return out;
  },
};

// ---------- Tahmin ve ölçüm ----------

/** Pozisyon aracının ilk hâli (tek tıkta): hedef ve zarar-durdur, grafik yüksekliğinin bu oranları kadar uzakta. */
export const POSITION_DEFAULTS = { target: 0.12, stop: 0.06, widthPx: 170 };

function positionTemplate(name: string, long: boolean): OverlayTemplate {
  return {
    name,
    totalStep: 2,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: false,
    needDefaultYAxisFigure: true,
    createPointFigures: ({ coordinates: given, overlay, chart, bounding }) => {
      if (given.length < 1) return [];
      // Tıklamadan önce (ve tıklandığı an) önizleme: hedef/zarar varsayılan uzaklıkta.
      const dir = long ? -1 : 1;
      const cs =
        given.length >= 3
          ? given
          : [
              given[0],
              { x: given[0].x + POSITION_DEFAULTS.widthPx, y: given[0].y + dir * bounding.height * POSITION_DEFAULTS.target },
              { x: given[0].x + POSITION_DEFAULTS.widthPx, y: given[0].y - dir * bounding.height * POSITION_DEFAULTS.stop },
            ];
      if (given.length < 3) {
        const [e] = given;
        const z = (y: number, c: string) => ({ type: 'rect', ignoreEvent: true, attrs: { x: e.x, y: Math.min(e.y, y), width: POSITION_DEFAULTS.widthPx, height: Math.abs(y - e.y) }, styles: { style: 'fill', color: withAlpha(c, 0.18) } });
        return [z(cs[1].y, cssVar('--up')), z(cs[2].y, cssVar('--down')), line({ x: e.x, y: e.y }, { x: e.x + POSITION_DEFAULTS.widthPx, y: e.y }, { color: cssVar('--muted'), size: 1, style: 'solid' }, true)];
      }
      const [entry, target, stop] = overlay.points.map((x) => x.value);
      const x0 = cs[0].x;
      const x1 = cs[1].x > x0 + 20 ? cs[1].x : x0 + 160;
      const w = x1 - x0;
      const up = cssVar('--up');
      const down = cssVar('--down');
      const out: OverlayFigure[] = [];
      const zone = (y: number, color: string) => ({
        type: 'rect',
        attrs: { x: x0, y: Math.min(cs[0].y, y), width: w, height: Math.abs(y - cs[0].y) },
        styles: { style: 'fill', color: withAlpha(color, 0.18) },
      });
      out.push(zone(cs[1].y, up));
      if (cs.length >= 3) out.push(zone(cs[2].y, down));
      out.push(line({ x: x0, y: cs[0].y }, { x: x1, y: cs[0].y }, { color: cssVar('--muted'), size: 1, style: 'solid' }));
      if (entry !== undefined && target !== undefined) {
        out.push(box(x0 + w / 2, cs[1].y, `Hedef: ${fmtPrice(chart, target)} (${fmtPct(((target - entry) / entry) * 100)})`, up));
      }
      if (entry !== undefined && stop !== undefined && cs.length >= 3) {
        out.push(box(x0 + w / 2, cs[2].y, `Zarar durdur: ${fmtPrice(chart, stop)} (${fmtPct(((stop - entry) / entry) * 100)})`, down));
        if (target !== undefined && stop !== entry) {
          const rr = Math.abs(target - entry) / Math.abs(entry - stop);
          out.push(box(x0 + w / 2, cs[0].y, `Risk/Ödül: ${toTurkishNumber(rr.toFixed(2))}`, cssVar('--hover'), { color: cssVar('--text') }));
        }
      }
      return out;
    },
  };
}

const measure: OverlayTemplate = {
  name: 'gtMeasure',
  totalStep: 3,
  needDefaultPointFigure: true,
  needDefaultXAxisFigure: true,
  needDefaultYAxisFigure: true,
  createPointFigures: (p) => {
    const { coordinates: cs, overlay, chart } = p;
    if (cs.length < 2) return [];
    const [a, b] = overlay.points.map((x) => x.value);
    const [ta, tb] = overlay.points.map((x) => x.timestamp);
    const rising = (b ?? 0) >= (a ?? 0);
    const color = rising ? cssVar('--up') : cssVar('--down');
    const x = Math.min(cs[0].x, cs[1].x);
    const y = Math.min(cs[0].y, cs[1].y);
    const w = Math.abs(cs[1].x - cs[0].x);
    const h = Math.abs(cs[1].y - cs[0].y);
    const mx = x + w / 2;
    const my = y + h / 2;
    const vFrom = { x: mx, y: cs[0].y };
    const vTo = { x: mx, y: cs[1].y };
    const hFrom = { x: cs[0].x, y: my };
    const hTo = { x: cs[1].x, y: my };
    const out: OverlayFigure[] = [
      { type: 'rect', attrs: { x, y, width: w, height: h }, styles: { style: 'fill', color: withAlpha(color, 0.15) } },
      line(vFrom, vTo, { color, size: 1, style: 'solid' }, true),
      arrowHead(vFrom, vTo, color),
      line(hFrom, hTo, { color, size: 1, style: 'solid' }, true),
      arrowHead(hFrom, hTo, color),
    ];
    if (a !== undefined && b !== undefined) {
      const parts = [`${fmtPrice(chart, b - a)} (${fmtPct(((b - a) / a) * 100)})`, `${bars(p, cs[0], cs[1])} mum`];
      if (ta !== undefined && tb !== undefined) parts.push(fmtDuration(tb - ta));
      const below = cs[1].y >= cs[0].y;
      const ly = below ? y + h + 18 : y - 18;
      out.push(box(mx, Math.min(Math.max(ly, 14), p.bounding.height - 14), parts.join(' · '), color));
    }
    return out;
  },
};

const priceRange: OverlayTemplate = {
  name: 'gtPriceRange',
  totalStep: 3,
  needDefaultPointFigure: true,
  needDefaultXAxisFigure: false,
  needDefaultYAxisFigure: true,
  createPointFigures: ({ coordinates: cs, overlay, chart }) => {
    if (cs.length < 2) return [];
    const [a, b] = overlay.points.map((x) => x.value);
    const color = lineColor(overlay, '--c-fx');
    const x0 = Math.min(cs[0].x, cs[1].x);
    const x1 = Math.max(cs[0].x, cs[1].x, x0 + 40);
    const mx = (x0 + x1) / 2;
    const out: OverlayFigure[] = [
      { type: 'rect', ignoreEvent: true, attrs: { x: x0, y: Math.min(cs[0].y, cs[1].y), width: x1 - x0, height: Math.abs(cs[1].y - cs[0].y) }, styles: { style: 'fill', color: withAlpha(color, 0.12) } },
      line({ x: x0, y: cs[0].y }, { x: x1, y: cs[0].y }, { color, size: 1, style: 'solid' }),
      line({ x: x0, y: cs[1].y }, { x: x1, y: cs[1].y }, { color, size: 1, style: 'solid' }),
      line({ x: mx, y: cs[0].y }, { x: mx, y: cs[1].y }, { color, size: 1, style: 'solid' }, true),
      arrowHead({ x: mx, y: cs[0].y }, { x: mx, y: cs[1].y }, color),
    ];
    if (a !== undefined && b !== undefined) {
      const below = cs[1].y >= cs[0].y;
      out.push(box(mx, cs[1].y + (below ? 16 : -16), `${fmtPrice(chart, b - a)} (${fmtPct(((b - a) / a) * 100)})`, color));
    }
    return out;
  },
};

const dateRange: OverlayTemplate = {
  name: 'gtDateRange',
  totalStep: 3,
  needDefaultPointFigure: true,
  needDefaultXAxisFigure: true,
  needDefaultYAxisFigure: false,
  createPointFigures: (p) => {
    const { coordinates: cs, overlay } = p;
    if (cs.length < 2) return [];
    const color = lineColor(overlay, '--c-fx');
    const y0 = Math.min(cs[0].y, cs[1].y);
    const y1 = Math.max(cs[0].y, cs[1].y, y0 + 30);
    const my = (y0 + y1) / 2;
    const [ta, tb] = overlay.points.map((x) => x.timestamp);
    const out: OverlayFigure[] = [
      { type: 'rect', ignoreEvent: true, attrs: { x: Math.min(cs[0].x, cs[1].x), y: y0, width: Math.abs(cs[1].x - cs[0].x), height: y1 - y0 }, styles: { style: 'fill', color: withAlpha(color, 0.12) } },
      line({ x: cs[0].x, y: y0 }, { x: cs[0].x, y: y1 }, { color, size: 1, style: 'solid' }),
      line({ x: cs[1].x, y: y0 }, { x: cs[1].x, y: y1 }, { color, size: 1, style: 'solid' }),
      line({ x: cs[0].x, y: my }, { x: cs[1].x, y: my }, { color, size: 1, style: 'solid' }, true),
      arrowHead({ x: cs[0].x, y: my }, { x: cs[1].x, y: my }, color),
    ];
    const t = [`${bars(p, cs[0], cs[1])} mum`, ta !== undefined && tb !== undefined ? fmtDuration(tb - ta) : ''].filter(Boolean).join(' · ');
    out.push(box((cs[0].x + cs[1].x) / 2, y1 + 16, t, color));
    return out;
  },
};

// ---------- Şekiller ----------

export interface RectData {
  /** Sağ kenara kadar uzat (arz/talep bölgeleri için) */
  extendRight?: boolean;
  /** Kutunun içindeki etiket */
  text?: string;
}

/** Dikdörtgen ve arz/talep bölgesi. Bölge varsayılan olarak sağa uzar ve etiket taşır. */
function rectTemplate(name: string, zone: boolean): OverlayTemplate {
  return {
    name,
    totalStep: 3,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: ({ coordinates: cs, overlay, bounding, chart }) => {
      if (cs.length < 2) return [];
      const d = (overlay.extendData ?? {}) as RectData;
      const extend = d.extendRight ?? zone;
      const x = Math.min(cs[0].x, cs[1].x);
      const y = Math.min(cs[0].y, cs[1].y);
      const right = extend ? bounding.width : Math.max(cs[0].x, cs[1].x);
      const h = Math.abs(cs[1].y - cs[0].y);
      const out: OverlayFigure[] = [{ type: 'rect', attrs: { x, y, width: right - x, height: h }, styles: { style: 'stroke_fill' } }];
      const label = d.text ?? '';
      if (label) out.push(text(x + 6, y + 4, label, lineColor(overlay), { baseline: 'top', weight: 700, size: 14 }));
      if (zone) {
        const [a, b] = overlay.points.map((p) => p.value);
        if (a !== undefined && b !== undefined) {
          const hi = Math.max(a, b);
          const lo = Math.min(a, b);
          out.push(text(right - 6, y + 4, `${fmtPrice(chart, lo)} – ${fmtPrice(chart, hi)}`, lineColor(overlay), { align: 'right', baseline: 'top', weight: 600 }));
        }
      }
      return out;
    },
  };
}

const rectangle = rectTemplate('gtRect', false);
const zoneTool = rectTemplate('gtZone', true);

const circle: OverlayTemplate = {
  name: 'gtCircle',
  totalStep: 3,
  needDefaultPointFigure: true,
  needDefaultXAxisFigure: false,
  needDefaultYAxisFigure: false,
  createPointFigures: ({ coordinates: cs }) => {
    if (cs.length < 2) return [];
    const r = Math.hypot(cs[1].x - cs[0].x, cs[1].y - cs[0].y);
    return [{ type: 'circle', attrs: { x: cs[0].x, y: cs[0].y, r }, styles: { style: 'stroke_fill' } }];
  },
};

const triangle: OverlayTemplate = {
  name: 'gtTriangle',
  totalStep: 4,
  needDefaultPointFigure: true,
  needDefaultXAxisFigure: false,
  needDefaultYAxisFigure: false,
  createPointFigures: ({ coordinates: cs }) => {
    if (cs.length < 2) return [];
    if (cs.length < 3) return [line(cs[0], cs[1])];
    return [{ type: 'polygon', attrs: { coordinates: cs.slice(0, 3) }, styles: { style: 'stroke_fill' } }];
  },
};

const arrow: OverlayTemplate = {
  name: 'gtArrow',
  totalStep: 3,
  needDefaultPointFigure: true,
  needDefaultXAxisFigure: false,
  needDefaultYAxisFigure: false,
  createPointFigures: ({ coordinates: cs, overlay }) => {
    if (cs.length < 2) return [];
    return [line(cs[0], cs[1]), arrowHead(cs[0], cs[1], lineColor(overlay), 10 + lineSize(overlay) * 2)];
  },
};

const highlighter: OverlayTemplate = {
  name: 'gtHighlighter',
  totalStep: 2,
  drawingMode: 'continuous',
  needDefaultPointFigure: false,
  needDefaultXAxisFigure: false,
  needDefaultYAxisFigure: false,
  createPointFigures: ({ coordinates: cs, overlay }) => {
    if (cs.length < 2) return [];
    const c = overlay.styles?.line?.color;
    return [
      {
        type: 'line',
        attrs: { coordinates: cs },
        styles: { color: withAlpha(typeof c === 'string' ? c : cssVar('--warn'), 0.35), size: 14, lineCap: 'round', lineJoin: 'round', style: 'solid' },
      },
    ];
  },
};

// ---------- Metin ----------

interface TextData {
  text?: string;
  size?: number;
}

const textTool: OverlayTemplate = {
  name: 'gtText',
  totalStep: 2,
  needDefaultPointFigure: true,
  needDefaultXAxisFigure: false,
  needDefaultYAxisFigure: false,
  createPointFigures: ({ coordinates: cs, overlay }) => {
    if (cs.length < 1) return [];
    const d = (overlay.extendData ?? {}) as TextData;
    const f = text(cs[0].x, cs[0].y, d.text || 'Metin', lineColor(overlay, '--text'), { baseline: 'middle', size: d.size ?? 16, weight: 600 });
    return [{ ...f, ignoreEvent: false }];
  },
};

const emojiTool: OverlayTemplate = {
  name: 'gtEmoji',
  totalStep: 2,
  needDefaultPointFigure: true,
  needDefaultXAxisFigure: false,
  needDefaultYAxisFigure: false,
  createPointFigures: ({ coordinates: cs, overlay }) => {
    if (cs.length < 1) return [];
    const d = (overlay.extendData ?? {}) as TextData;
    const f = text(cs[0].x, cs[0].y, d.text || '⭐', '#000', { align: 'center', baseline: 'middle', size: d.size ?? 30 });
    return [{ ...f, ignoreEvent: false }];
  },
};

// ---------- Formasyonlar ----------

function patternTemplate(name: string, labels: string[], extra?: (p: P) => OverlayFigure[]): OverlayTemplate {
  return {
    name,
    totalStep: labels.length + 1,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: false,
    needDefaultYAxisFigure: false,
    createPointFigures: (p) => {
      const { coordinates: cs, overlay } = p;
      if (cs.length < 2) return [];
      const color = lineColor(overlay);
      const out: OverlayFigure[] = [];
      if (extra) out.push(...extra(p));
      for (let i = 0; i < cs.length - 1; i++) out.push(line(cs[i], cs[i + 1]));
      cs.forEach((_, i) => labels[i] && out.push(pointLabel(cs, i, labels[i], color)));
      return out;
    },
  };
}

function ratioLine(cs: Coordinate[], i: number, j: number, r: string, color: string): OverlayFigure[] {
  if (!cs[i] || !cs[j] || !r) return [];
  const m = { x: (cs[i].x + cs[j].x) / 2, y: (cs[i].y + cs[j].y) / 2 };
  return [line(cs[i], cs[j], { ...DASHED, color }, true), box(m.x, m.y, r, withAlpha(color, 0.85))];
}

const xabcd = patternTemplate('gtXABCD', ['X', 'A', 'B', 'C', 'D'], ({ coordinates: cs, overlay }) => {
  const color = lineColor(overlay);
  const v = overlay.points.map((x) => x.value);
  const out: OverlayFigure[] = [];
  const fill = (pts: Coordinate[]) =>
    out.push({ type: 'polygon', ignoreEvent: true, attrs: { coordinates: pts }, styles: { style: 'fill', color: withAlpha(color, 0.14) } });
  if (cs.length >= 3) fill([cs[0], cs[1], cs[2]]);
  if (cs.length >= 5) fill([cs[2], cs[3], cs[4]]);
  out.push(...ratioLine(cs, 0, 2, ratio(v[0], v[1], v[2]), color));
  out.push(...ratioLine(cs, 1, 3, ratio(v[1], v[2], v[3]), color));
  out.push(...ratioLine(cs, 2, 4, ratio(v[2], v[3], v[4]), color));
  if (v[0] !== undefined && v[1] !== undefined && v[4] !== undefined && v[0] !== v[1]) {
    out.push(...ratioLine(cs, 0, 4, toTurkishNumber((Math.abs(v[4] - v[1]) / Math.abs(v[1] - v[0])).toFixed(3)), color));
  }
  return out;
});

const abcd = patternTemplate('gtABCD', ['A', 'B', 'C', 'D'], ({ coordinates: cs, overlay }) => {
  const color = lineColor(overlay);
  const v = overlay.points.map((x) => x.value);
  return [...ratioLine(cs, 0, 2, ratio(v[0], v[1], v[2]), color), ...ratioLine(cs, 1, 3, ratio(v[1], v[2], v[3]), color)];
});

const headShoulders = patternTemplate('gtHeadShoulders', ['', 'Sol omuz', '', 'Baş', '', 'Sağ omuz', ''], ({ coordinates: cs, overlay }) => {
  if (cs.length < 5) return [];
  const color = lineColor(overlay);
  const [a, b] = [cs[2], cs[4]];
  const k = (b.y - a.y) / (b.x - a.x || 1);
  const x0 = cs[0].x;
  const x1 = cs[cs.length - 1].x;
  return [
    line({ x: x0, y: a.y + k * (x0 - a.x) }, { x: x1, y: a.y + k * (x1 - a.x) }, { color, size: 2, style: 'dashed', dashedValue: [6, 4] }, true),
    text(x1, a.y + k * (x1 - a.x) - 4, 'Boyun çizgisi', color, { align: 'right' }),
  ];
});

const elliottImpulse = patternTemplate('gtElliottImpulse', ['(0)', '(1)', '(2)', '(3)', '(4)', '(5)']);
const elliottCorrection = patternTemplate('gtElliottCorrection', ['(0)', '(A)', '(B)', '(C)']);

const TEMPLATES: OverlayTemplate[] = [
  fibRetracement,
  fibExtension,
  fibTimeZone,
  infoLine,
  horizontalRay,
  crossLine,
  pitchfork,
  parallelChannel,
  positionTemplate('gtLongPosition', true),
  positionTemplate('gtShortPosition', false),
  measure,
  { ...measure, name: 'gtRuler' },
  priceRange,
  dateRange,
  rectangle,
  zoneTool,
  circle,
  triangle,
  arrow,
  highlighter,
  textTool,
  emojiTool,
  xabcd,
  abcd,
  headShoulders,
  elliottImpulse,
  elliottCorrection,
];

let registered = false;
export function registerTools(): void {
  if (registered) return;
  registered = true;
  TEMPLATES.forEach((t) => registerOverlay(t));
}

// ---------- Araç çubuğu tanımları ----------

export interface ToolDef {
  name: string;
  title: string;
  icon: string;
  /** Kısayol (Alt+...) */
  hotkey?: string;
  /** Oluşturmadan önce sorulacak içerik */
  input?: 'text' | 'emoji' | 'note' | 'zone';
  /** Ayar penceresi olan araçlar */
  settings?: 'fib-retracement' | 'fib-extension';
  /** Renk yerine kendi renkleri olanlar (Fibonacci seviyeleri, pozisyon) */
  fixedColors?: boolean;
}

export interface ToolGroup {
  id: string;
  title: string;
  tools: ToolDef[];
}

const svg = (body: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const dot = (x: number, y: number) => `<circle cx="${x}" cy="${y}" r="1.9" fill="currentColor"/>`;

export const TOOL_GROUPS: ToolGroup[] = [
  {
    id: 'lines',
    title: 'Çizgiler',
    tools: [
      { name: 'segment', title: 'Trend çizgisi', hotkey: 'T', icon: svg(`<path d="M5 18L19 6"/>${dot(5, 18)}${dot(19, 6)}`) },
      { name: 'rayLine', title: 'Işın', icon: svg(`<path d="M5 18L22 4"/>${dot(5, 18)}${dot(12, 12.2)}`) },
      { name: 'gtInfoLine', title: 'Bilgi çizgisi', icon: svg(`<path d="M4 18L15 8"/>${dot(4, 18)}${dot(15, 8)}<path d="M17 4h5v5h-5z"/>`) },
      { name: 'straightLine', title: 'Uzatılmış çizgi', icon: svg(`<path d="M2 21L22 3"/>${dot(8, 15.6)}${dot(16, 8.4)}`) },
      { name: 'horizontalStraightLine', title: 'Yatay çizgi (destek/direnç)', hotkey: 'H', icon: svg(`<path d="M2 12h20"/>${dot(12, 12)}`) },
      { name: 'horizontalRayLine', title: 'Yatay ışın', hotkey: 'J', icon: svg(`<path d="M6 12h16"/>${dot(6, 12)}`) },
      { name: 'verticalStraightLine', title: 'Dikey çizgi', hotkey: 'V', icon: svg(`<path d="M12 2v20"/>${dot(12, 12)}`) },
      { name: 'gtCrossLine', title: 'Kesişen çizgiler', hotkey: 'C', icon: svg(`<path d="M2 12h20M12 2v20"/>${dot(12, 12)}`) },
      { name: 'priceLine', title: 'Fiyat etiketi', icon: svg('<path d="M4 12h9"/><path d="M13 8h7v8h-7z"/>') },
    ],
  },
  {
    id: 'fib',
    title: 'Fibonacci',
    tools: [
      {
        name: 'gtFibRetracement',
        title: 'Fibonacci düzeltmesi',
        hotkey: 'F',
        settings: 'fib-retracement',
        fixedColors: true,
        icon: svg('<path d="M3 5h18M3 9h18M3 12.5h18M3 16h18M3 20h18" stroke-width="1.5"/><path d="M5 20L19 5" stroke-dasharray="2 2"/>'),
      },
      {
        name: 'gtFibExtension',
        title: 'Trend tabanlı Fibonacci uzantısı',
        settings: 'fib-extension',
        fixedColors: true,
        icon: svg('<path d="M3 18l6-10 4 6" stroke-dasharray="2 2"/><path d="M13 4h9M13 8h9M13 12h9M13 16h9" stroke-width="1.5"/>'),
      },
      {
        name: 'gtFibTimeZone',
        title: 'Fibonacci zaman bölgeleri',
        fixedColors: true,
        icon: svg('<path d="M3 3v18M6 3v18M9 3v18M13 3v18M19 3v18" stroke-width="1.5"/>'),
      },
    ],
  },
  {
    id: 'channels',
    title: 'Kanallar ve çatal',
    tools: [
      {
        name: 'gtParallelChannel',
        title: 'Paralel kanal (orta çizgili)',
        hotkey: 'K',
        icon: svg('<path d="M3 13L21 3"/><path d="M3 21L21 11"/><path d="M3 17L21 7" stroke-dasharray="2 2.5"/>'),
      },
      { name: 'parallelStraightLine', title: 'Paralel çizgiler (sonsuz)', icon: svg('<path d="M3 15L21 5"/><path d="M3 21L21 11"/>') },
      { name: 'priceChannelLine', title: 'Fiyat kanalı', icon: svg('<path d="M3 14L21 6"/><path d="M3 20L21 12" stroke-dasharray="3 2"/>') },
      { name: 'gtPitchfork', title: 'Andrews çatalı (pitchfork)', icon: svg('<path d="M3 12h4M7 12l14-7M7 12h14M7 12l14 7"/>') },
    ],
  },
  {
    id: 'patterns',
    title: 'Formasyonlar',
    tools: [
      { name: 'gtXABCD', title: 'XABCD formasyonu', icon: svg('<path d="M2 18L7 6l4 8 5-10 6 14"/>') },
      { name: 'gtABCD', title: 'ABCD formasyonu', icon: svg('<path d="M3 18L9 6l5 8 7-10"/>') },
      { name: 'gtHeadShoulders', title: 'Omuz-baş-omuz', icon: svg('<path d="M2 18l3-7 3 4 4-11 4 11 3-4 3 7"/><path d="M2 15h20" stroke-dasharray="2 2"/>') },
      { name: 'gtElliottImpulse', title: 'Elliott itki dalgası (12345)', icon: svg('<path d="M2 19l4-7 3 3 5-11 3 5 5-6"/>') },
      { name: 'gtElliottCorrection', title: 'Elliott düzeltme dalgası (ABC)', icon: svg('<path d="M3 5l6 12 5-6 7 9"/>') },
    ],
  },
  {
    id: 'measure',
    title: 'Tahmin ve ölçüm',
    tools: [
      { name: 'gtLongPosition', title: 'Uzun pozisyon (tek tık, sonra sürükle)', fixedColors: true, icon: svg('<path d="M4 4h16v8H4z" fill="currentColor" fill-opacity=".25"/><path d="M4 12h16v8H4z"/>') },
      { name: 'gtShortPosition', title: 'Kısa pozisyon (tek tık, sonra sürükle)', fixedColors: true, icon: svg('<path d="M4 4h16v8H4z"/><path d="M4 12h16v8H4z" fill="currentColor" fill-opacity=".25"/>') },
      { name: 'gtMeasure', title: 'Tarih ve fiyat aralığı (kalıcı ölçüm)', fixedColors: true, icon: svg('<path d="M3 17L17 3l4 4L7 21z"/><path d="M7 13l2 2M10 10l2 2M13 7l2 2"/>') },
      { name: 'gtPriceRange', title: 'Fiyat aralığı', icon: svg('<path d="M4 4h16M4 20h16M12 6v12M9 9l3-3 3 3M9 15l3 3 3-3"/>') },
      { name: 'gtDateRange', title: 'Tarih aralığı', icon: svg('<path d="M4 4v16M20 4v16M6 12h12M9 9l-3 3 3 3M15 9l3 3-3 3"/>') },
    ],
  },
  {
    id: 'zones',
    title: 'Arz / talep bölgeleri',
    tools: [
      {
        name: 'gtZone',
        title: 'Arz / talep bölgesi (sağa uzar)',
        hotkey: 'Z',
        input: 'zone',
        icon: svg('<path d="M3 8h18v7H3z" fill="currentColor" fill-opacity=".22"/><path d="M17 11.5h4M19 9.5l2 2-2 2"/>'),
      },
      { name: 'gtRect', title: 'Dikdörtgen', icon: svg('<rect x="4" y="6" width="16" height="12" rx="1"/>') },
    ],
  },
  {
    id: 'shapes',
    title: 'Şekiller ve fırça',
    tools: [
      { name: 'brush', title: 'Fırça', icon: svg('<path d="M4 20c3 0 4-2 4-4s2-3 3-3M13 11l7-7"/>') },
      { name: 'gtHighlighter', title: 'Vurgulayıcı', icon: svg('<path d="M4 20h7M14 4l6 6-8 8H6v-6z"/>') },
      { name: 'gtRect', title: 'Dikdörtgen', icon: svg('<rect x="4" y="6" width="16" height="12" rx="1"/>') },
      { name: 'gtCircle', title: 'Daire', icon: svg('<circle cx="12" cy="12" r="8"/>') },
      { name: 'gtTriangle', title: 'Üçgen', icon: svg('<path d="M12 4l9 16H3z"/>') },
      { name: 'gtArrow', title: 'Ok', icon: svg('<path d="M4 20L20 4M11 4h9v9"/>') },
    ],
  },
  {
    id: 'text',
    title: 'Metin ve simgeler',
    tools: [
      { name: 'gtText', title: 'Metin', input: 'text', icon: svg('<path d="M5 6V4h14v2M12 4v16M9 20h6"/>') },
      { name: 'simpleAnnotation', title: 'Not (işaretçili)', input: 'note', icon: svg('<path d="M5 5h14v10H10l-4 4v-4H5z"/>') },
      { name: 'gtEmoji', title: 'Simge / emoji', input: 'emoji', icon: svg('<circle cx="12" cy="12" r="9"/><path d="M8.5 14.5c1 1.5 6 1.5 7 0"/><path d="M9 9.5h.01M15 9.5h.01" stroke-width="2.4"/>') },
    ],
  },
];

/** TradingView'daki cetvel: geçici ölçüm (kaydedilmez, sonraki tıklamada kaybolur). Kısayol: Shift + tık. */
export const RULER_TOOL: ToolDef = {
  name: 'gtRuler',
  title: 'Cetvel (Shift + tık)',
  fixedColors: true,
  icon: svg('<path d="M3.5 16.5L16.5 3.5l4 4-13 13z"/><path d="M7 13l2 2M9.5 10.5l1.5 1.5M12 8l2 2M14.5 5.5l1.5 1.5"/>'),
};

/** Araç çubuğundan kaldırılmış ama eski kayıtlarda bulunabilecek araçlar (nesne ağacında adı görünsün). */
const LEGACY_TOOLS: ToolDef[] = [
  { name: 'fibonacciLine', title: 'Basit Fibonacci (eski)', fixedColors: true, icon: svg('<path d="M3 6h18M3 12h18M3 18h18" stroke-width="1.2"/>') },
];

export function findTool(name: string): ToolDef | undefined {
  for (const g of TOOL_GROUPS) {
    const t = g.tools.find((x) => x.name === name);
    if (t) return t;
  }
  return LEGACY_TOOLS.find((t) => t.name === name);
}

export const EMOJIS = ['🚀', '📈', '📉', '🔥', '⭐', '✅', '❌', '⚠️', '💰', '🎯', '🐂', '🐻', '👀', '💎', '⛔', '🔔', '👍', '👎', '❓', '❗'];
