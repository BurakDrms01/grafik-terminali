import { init, registerLocale, type Chart, type DataLoader, type DeepPartial, type Styles, type TooltipLegend } from 'klinecharts';
import { cssVar, currentTheme, withAlpha } from '../ui/theme.ts';

export const DISPLAY_TIMEZONE = 'Europe/Istanbul';

registerLocale('tr-TR', {
  time: 'Zaman: ',
  open: 'Açılış: ',
  high: 'Yüksek: ',
  low: 'Düşük: ',
  close: 'Kapanış: ',
  volume: 'Hacim: ',
  turnover: 'Tutar: ',
  change: 'Değişim: ',
  second: 'sn',
  minute: 'dk',
  hour: 'sa',
  day: 'G',
  week: 'H',
  month: 'A',
  year: 'Y',
});

// Windows'ta Segoe UI (Trebuchet MS'ten daha dolgun ve net), Mac'te sistem yazısı.
export const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Ubuntu, 'Trebuchet MS', sans-serif";

/** Durum çizgisinde (sol üst) gösterilecekler; grafik ayarları penceresinden değişir. */
export const legendOptions: { ohlc: boolean; change: boolean; volume: boolean; up: string | null; down: string | null } = {
  ohlc: true,
  change: true,
  volume: true,
  up: null,
  down: null,
};

/** Grafik renkleri styles.css'teki tema değişkenlerinden üretilir. */
function chartTheme(chart: Chart): DeepPartial<Styles> {
  const up = cssVar('--up');
  const down = cssVar('--down');
  const accent = cssVar('--accent');
  const text = cssVar('--text');
  const muted = cssVar('--muted');
  const grid = cssVar('--grid');
  const axis = cssVar('--axis');
  const cross = cssVar('--crosshair');
  const panel = cssVar('--panel-2');
  const crossLabel = cssVar('--cross-label');

  // TradingView tarzı üst bilgi: A Y D K değerleri mumun rengiyle, yanında değişim ve hacim.
  const legend = ({ prev, current }: { prev: { close: number } | null; current: { open: number; close: number } | null }): TooltipLegend[] => {
    if (!current) return [];
    const U = legendOptions.up ?? up;
    const D = legendOptions.down ?? down;
    const dir = current.close >= current.open ? U : D;
    const p = chart.getSymbol()?.pricePrecision ?? 2;
    const base = prev?.close ?? current.open;
    const diff = current.close - base;
    const pct = base ? (diff / base) * 100 : 0;
    const sign = diff > 0 ? '+' : '';
    const out: TooltipLegend[] = [];
    if (legendOptions.ohlc) {
      out.push(
        { title: { text: 'A ', color: muted }, value: { text: '{open}', color: dir } },
        { title: { text: 'Y ', color: muted }, value: { text: '{high}', color: dir } },
        { title: { text: 'D ', color: muted }, value: { text: '{low}', color: dir } },
        { title: { text: 'K ', color: muted }, value: { text: '{close}', color: dir } },
      );
    }
    if (legendOptions.change) {
      out.push({
        title: '',
        value: { text: `${sign}${toTurkishNumber(diff.toFixed(p))} (${sign}${toTurkishNumber(pct.toFixed(2))}%)`, color: diff >= 0 ? U : D },
      });
    }
    if (legendOptions.volume) out.push({ title: { text: 'Hac ', color: muted }, value: { text: '{volume}', color: muted } });
    return out;
  };
  const lines = [1, 2, 3, 4, 5].map((i) => ({ color: cssVar(`--line-${i}`) }));

  return {
    grid: { horizontal: { color: grid }, vertical: { color: grid } },
    candle: {
      bar: {
        upColor: up,
        downColor: down,
        noChangeColor: muted,
        upBorderColor: up,
        downBorderColor: down,
        noChangeBorderColor: muted,
        upWickColor: up,
        downWickColor: down,
        noChangeWickColor: muted,
      },
      priceMark: {
        high: { color: muted, textFamily: FONT, textSize: 11 },
        low: { color: muted, textFamily: FONT, textSize: 11 },
        last: { upColor: up, downColor: down, noChangeColor: muted, text: { family: FONT, size: 13, weight: 600 } },
      },
      tooltip: {
        title: { color: text, size: 15, family: FONT, weight: 600 },
        legend: { color: muted, size: 14, family: FONT, weight: 600, template: legend },
        rect: { color: withAlpha(panel, 0.92), borderColor: axis },
      },
    },
    indicator: {
      ohlc: { upColor: withAlpha(up, 0.7), downColor: withAlpha(down, 0.7), noChangeColor: muted },
      bars: [{ upColor: withAlpha(up, 0.5), downColor: withAlpha(down, 0.5), noChangeColor: muted }],
      lines,
      tooltip: { title: { color: text, family: FONT, size: 13, weight: 600 }, legend: { color: muted, family: FONT, size: 13, weight: 600 } },
    },
    xAxis: { axisLine: { color: axis }, tickLine: { show: false }, tickText: { color: text, family: FONT, size: 13 } },
    yAxis: { axisLine: { color: axis }, tickLine: { show: false }, tickText: { color: text, family: FONT, size: 13 } },
    separator: { color: axis },
    crosshair: {
      horizontal: {
        line: { color: cross, style: 'dashed', dashedValue: [4, 4] },
        text: { color: '#ffffff', backgroundColor: crossLabel, borderColor: crossLabel, family: FONT, size: 13, weight: 600 },
      },
      vertical: {
        line: { color: cross, style: 'dashed', dashedValue: [4, 4] },
        text: { color: '#ffffff', backgroundColor: crossLabel, borderColor: crossLabel, family: FONT, size: 13, weight: 600 },
      },
    },
    overlay: {
      // TradingView gibi belirgin tutamaçlar: içi beyaz, kenarı çizim renginde.
      point: {
        color: '#ffffff',
        borderColor: accent,
        borderSize: 2,
        radius: 5,
        activeColor: accent,
        activeBorderColor: withAlpha(accent, 0.35),
        activeBorderSize: 4,
        activeRadius: 6,
      },
      line: { color: accent, size: 2 },
      rect: { color: withAlpha(accent, 0.12), borderColor: accent, borderSize: 1 },
      polygon: { color: withAlpha(accent, 0.12), borderColor: accent, borderSize: 1 },
      circle: { color: withAlpha(accent, 0.12), borderColor: accent, borderSize: 1 },
      arc: { color: accent, size: 2 },
      text: { color: '#ffffff', backgroundColor: accent, borderColor: accent, family: FONT, size: 13, weight: 600 },
    },
  };
}

/** Temayı (açık/koyu) grafiğe uygular. */
export function applyChartTheme(chart: Chart): void {
  chart.setStyles(currentTheme());
  chart.setStyles(chartTheme(chart));
}

/** Kütüphanenin ürettiği "11104.38" / "2.941B" gibi metinleri Türkçe biçime çevirir: 11.104,38 / 2,941B */
export function toTurkishNumber(value: string | number): string {
  const s = String(value);
  const m = /^(-?)(\d+)(?:\.(\d+))?(.*)$/.exec(s);
  if (!m) return s;
  const int = m[2].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${m[1]}${int}${m[3] !== undefined ? `,${m[3]}` : ''}${m[4]}`;
}

export function createChart(el: HTMLElement, loader: DataLoader): Chart {
  const chart = init(el, {
    locale: 'tr-TR',
    timezone: DISPLAY_TIMEZONE,
    thousandsSeparator: { sign: '.', format: toTurkishNumber },
  });
  if (!chart) throw new Error('Grafik başlatılamadı');
  applyChartTheme(chart);
  chart.setDataLoader(loader);
  new ResizeObserver(() => chart.resize()).observe(el);
  return chart;
}

/** Grafiğin sol üstündeki başlık: "THYAO · Türk Hava Yolları · 1G" */
export function setChartTitle(chart: Chart, title: string): void {
  chart.setStyles({ candle: { tooltip: { title: { template: `${title.replace(/[{}]/g, '')} · {period}` } } } });
}

export function downloadScreenshot(chart: Chart, fileName: string): void {
  const url = chart.getConvertPictureUrl(true, 'png', cssVar('--bg') || '#1f1e1d');
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
}
