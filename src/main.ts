import { applyChartTheme, createChart, downloadScreenshot, setChartTitle } from './chart/chart.ts';
import { Compare } from './chart/compare.ts';
import { Drawings } from './chart/drawings.ts';
import { installEngine } from './chart/engine.ts';
import { Indicators } from './chart/indicators.ts';
import { registerLogAxis } from './chart/logAxis.ts';
import { Replay } from './chart/replay.ts';
import { ChartSettingsManager } from './chart/settings.ts';
import { ChartFeed, intervalToPeriod, resolveSymbol } from './data/feed.ts';
import { setExtendedHours } from './data/session.ts';
import { installSessionShading, setOvernightPrice } from './chart/sessions.ts';
import { chooseBase, intervalKey, intervalLabel, intervalLongLabel, parseIntervalKey, sameInterval, type Interval } from './data/intervals.ts';
import { QuoteHub } from './data/quotes.ts';
import type { SymbolDef } from './data/types.ts';
import { load, save } from './store.ts';
import { Alerts, unlockAudio } from './ui/alerts.ts';
import { BottomBar, fitRange, type RangeDef } from './ui/bottombar.ts';
import { h, isModalOpen, isTyping, menuAt, menuList, modal, popover, toast } from './ui/dom.ts';
import { displayTicker, fmtPrice, setPrecision } from './ui/format.ts';
import { ObjectTree } from './ui/objectTree.ts';
import { currentAccent, currentTheme, setAccent, setTheme, type AccentName, type ThemeName } from './ui/theme.ts';
import { Topbar } from './ui/topbar.ts';
import { DEFAULT_WATCHLIST, Watchlist } from './ui/watchlist.ts';

interface LastView {
  symbol: SymbolDef;
  interval: string;
}

const last = load<LastView | null>('last', null);
const state: { symbol: SymbolDef; interval: Interval } = {
  symbol: last?.symbol ?? DEFAULT_WATCHLIST[0],
  interval: (last && parseIntervalKey(last.interval)) || { unit: 'day', span: 1 },
};

const app = document.getElementById('app')!;
const chartEl = document.getElementById('chart')!;
const chartWrap = document.getElementById('chart-wrap')!;
const msgEl = document.getElementById('chart-msg')!;

// ---------- Yükleniyor / hata mesajı ----------
let loadingTimer: ReturnType<typeof setTimeout> | undefined;
/** Alt çubuktan seçilen tarih aralığı: veri gelince ekrana sığdırılır. */
let pendingRange: RangeDef | null = null;
/** Dilim değişince karşılaştırmalar, ana veri yüklendikten sonra yeniden yüklenir. */
let compareReloadPending = false;
function showMessage(text: string | null): void {
  msgEl.hidden = text === null;
  msgEl.textContent = text ?? '';
}
function setLoading(loading: boolean): void {
  clearTimeout(loadingTimer);
  if (loading) {
    showMessage(null);
    loadingTimer = setTimeout(() => showMessage('Yükleniyor…'), 150);
  } else {
    if (msgEl.textContent === 'Yükleniyor…') showMessage(null);
    const r = pendingRange;
    pendingRange = null;
    if (r) requestAnimationFrame(() => fitRange(chart, r));
    if (compareReloadPending) {
      compareReloadPending = false;
      compare.reload();
    }
  }
}

// ---------- Veri, grafik ve paneller ----------
const quotes = new QuoteHub();
const feed = new ChartFeed({
  onLoading: setLoading,
  onError: (message) => {
    clearTimeout(loadingTimer);
    showMessage(message);
    toast('Veri alınamadı', message, 'error');
  },
  onPrice: (id, price) => quotes.ingestPrice(id, price),
  onOvernightPrice: (price) => setOvernightPrice(price),
});
const chart = createChart(chartEl, feed.loader);
installEngine(chart);
registerLogAxis(() => chart.getSymbol()?.pricePrecision ?? 2, 13);
feed.attach(() => ({ symbol: chart.getSymbol(), period: chart.getPeriod() }));
installSessionShading(chart, () => (feed.replaying ? null : feed.sessionShading()));

const indicators = new Indicators(chart);
const drawings = new Drawings(chart, document.getElementById('drawbar')!, chartWrap);
drawings.formatPrice = (v) => fmtPrice(v, state.symbol.id);
// Yalnızca geliştirme sunucusunda: tarayıcı konsolundan test için.
if ((import.meta as { env?: { DEV?: boolean } }).env?.DEV) Object.assign(window, { __gt: { chart, drawings } });

// Grafik ayarları (mum türü, renkler, geri sayım…), tekrar oynatma ve sembol karşılaştırma
let bottomBar: BottomBar | null = null;
const settings = new ChartSettingsManager({
  chart,
  chartWrap,
  setBarStyle: (style) => feed.setBarStyle(style),
  setAxisPosition: (pos) => bottomBar?.setAxisPosition(pos),
  setTimezone: (tz) => {
    chart.setTimezone(tz);
    bottomBar?.setTimezone(tz);
  },
  isLive: () => !feed.replaying,
  watermarkText: () => `${displayTicker(state.symbol)} · ${intervalLabel(state.interval)}`,
});
const replay = new Replay({ chart, feed, chartWrap, chartEl, button: document.getElementById('btn-replay') as HTMLButtonElement });
const compare = new Compare({
  chart,
  getInterval: () => state.interval,
  onFirstAdd: () => {
    if (bottomBar && bottomBar.mode === 'normal') {
      bottomBar.setMode('percentage');
      toast('Yüzde ölçeğe geçildi', 'Karşılaştırmada semboller yüzde değişimle kıyaslanır. Alttaki % düğmesiyle kapatabilirsiniz.');
    }
  },
  onChange: () => refreshQuoteSymbols(),
});

drawings.indicatorOps = {
  count: () => indicators.count() + compare.ids().length,
  removeAll: () => {
    const restoreIndicators = indicators.removeAll();
    const defs = compare.defs();
    compare.removeAll();
    return () => {
      restoreIndicators();
      defs.forEach((d) => void compare.add(d, true));
    };
  },
};

function lastPrice(): number | null {
  const real = feed.replaying ? null : feed.lastClose();
  if (real !== null) return real;
  const list = chart.getDataList();
  return list.length > 0 ? list[list.length - 1].close : null;
}

let watchlist: Watchlist;
let alerts: Alerts;

function refreshQuoteSymbols(): void {
  quotes.setSymbols([...watchlist.ids(), ...alerts.symbolIds(), ...compare.ids(), state.symbol.id]);
  const n = alerts.activeCount();
  document.getElementById('alert-badge')!.textContent = n > 0 ? String(n) : '';
}

let openSeq = 0;
let hasPrePost = false;

async function openSymbol(def: SymbolDef, interval: Interval = state.interval): Promise<void> {
  const seq = ++openSeq;
  let iv = interval;
  if (!chooseBase(iv, def.source)) {
    iv = { unit: 'minute', span: 1 };
    toast('Dilim değişti', `${intervalLongLabel(interval)} bu sembolde yok, 1 dakikaya geçildi.`);
  }
  let symbol;
  try {
    symbol = await resolveSymbol(def);
  } catch (e) {
    if (seq === openSeq) toast('Sembol açılamadı', e instanceof Error ? e.message : String(e), 'error');
    return;
  }
  if (seq !== openSeq) return;

  const resolved: SymbolDef = { ...def, name: symbol.name, exchange: symbol.exchange };
  setPrecision(def.id, symbol.pricePrecision);
  hasPrePost = symbol.hasPrePost;
  bottomBar?.setExtendedAvailable(hasPrePost);
  state.symbol = resolved;
  state.interval = iv;
  save('last', { symbol: resolved, interval: intervalKey(iv) } satisfies LastView);

  const prevSymbol = chart.getSymbol();
  const prevPeriod = chart.getPeriod();
  const symbolChanged = !prevSymbol || prevSymbol.ticker !== symbol.ticker;
  const periodChanged = !prevPeriod || prevPeriod.type !== iv.unit || prevPeriod.span !== iv.span;
  // Tekrar oynatmadaysak çık; sembol/dilim değişmiyorsa canlı veriyi yeniden yükle.
  if (replay.isOn) replay.exit(!symbolChanged && !periodChanged);
  if (symbolChanged) {
    drawings.switchSymbol(def.id);
    setChartTitle(chart, [displayTicker(resolved), resolved.name].filter((x, i, a) => x && a.indexOf(x) === i).join(' · '));
    chart.setSymbol(symbol);
  }
  if (periodChanged) {
    if (prevPeriod) compareReloadPending = true;
    chart.setPeriod(intervalToPeriod(iv));
  }
  settings.updateWatermark();

  topbar.update(resolved);
  watchlist.setActive(def.id);
  alerts.drawLines();
  refreshQuoteSymbols();
}

function setInterval_(iv: Interval): void {
  if (sameInterval(iv, state.interval)) return;
  void openSymbol(state.symbol, iv);
}

const topbar = new Topbar({
  getSymbol: () => state.symbol,
  getInterval: () => state.interval,
  openSymbol: (def) => void openSymbol(def),
  setInterval: setInterval_,
  addToWatchlist: (def) => watchlist.add(def),
});

watchlist = new Watchlist(document.getElementById('watchlist')!, quotes, {
  open: (def) => {
    void openSymbol(def);
    // Telefonda liste grafiğin üstünde açık; sembol seçilince kapansın ki grafik görünsün.
    if (window.matchMedia('(max-width: 760px)').matches) showPanel('none');
  },
  current: () => state.symbol,
  onChange: refreshQuoteSymbols,
});

alerts = new Alerts(document.getElementById('alerts')!, chart, quotes, {
  open: (def) => void openSymbol(def),
  current: () => state.symbol,
  currentPrice: lastPrice,
  onChange: refreshQuoteSymbols,
});

bottomBar = new BottomBar(
  document.getElementById('bottombar')!,
  chart,
  (r) => {
    if (sameInterval(r.interval, state.interval)) {
      fitRange(chart, r);
    } else {
      pendingRange = r;
      void openSymbol(state.symbol, r.interval);
    }
  },
  (on) => {
    setExtendedHours(on);
    if (!hasPrePost) {
      toast('Uzatılmış seans', `${on ? 'Açıldı' : 'Kapatıldı'}. Bu sembolde ön/son piyasa verisi yok; ABD hisselerinde geçerli olur.`);
      return;
    }
    // Tekrar oynatmadaysak çık; grafiği (ve karşılaştırmaları) yeni seans ayarıyla yeniden yükle.
    if (replay.isOn) replay.exit(false);
    compareReloadPending = true;
    chart.resetData();
  },
);
bottomBar.setExtendedAvailable(hasPrePost);

settings.apply();
settings.attachTypeButton(document.getElementById('btn-charttype') as HTMLButtonElement);
document.getElementById('btn-settings')!.addEventListener('click', () => settings.openDialog());
document.getElementById('btn-compare')!.addEventListener('click', () =>
  topbar.openSearch('', { title: 'Sembol karşılaştır', onPick: (def) => void compare.add(def) }),
);
quotes.on((q) => compare.ingest(q));

// ---------- Geri al / yinele ----------
const undoBtn = document.getElementById('btn-undo') as HTMLButtonElement;
const redoBtn = document.getElementById('btn-redo') as HTMLButtonElement;
undoBtn.addEventListener('click', () => drawings.undo());
redoBtn.addEventListener('click', () => drawings.redo());
drawings.onHistoryChange = (canUndo, canRedo) => {
  undoBtn.disabled = !canUndo;
  redoBtn.disabled = !canRedo;
};

// ---------- Tam ekran ----------
document.getElementById('btn-full')!.addEventListener('click', () => {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void document.documentElement.requestFullscreen();
});

// ---------- Üst çubuk düğmeleri ----------
document.getElementById('btn-indicators')!.addEventListener('click', () => indicators.openDialog());
document.getElementById('btn-alert')!.addEventListener('click', () => alerts.openCreateDialog());
document.getElementById('btn-shot')!.addEventListener('click', () => {
  const date = new Date().toISOString().slice(0, 10);
  downloadScreenshot(chart, `${displayTicker(state.symbol)}_${intervalKey(state.interval)}_${date}.png`);
});
// ---------- Sağ panel (TradingView'daki gibi sağdaki dikey çubuktan) ----------
type SidePanel = 'watchlist' | 'alerts' | 'objects' | 'none';
const side = document.getElementById('side')!;
const widgetButtons = [...document.querySelectorAll<HTMLButtonElement>('#widgetbar .wb-btn[data-panel]')];
const objectTree = new ObjectTree(document.getElementById('objects')!, drawings, indicators, () => sidePanel === 'objects');
let sidePanel = load<SidePanel>('sidePanel', window.matchMedia('(max-width: 760px)').matches ? 'none' : 'watchlist');
function applySidePanel(): void {
  app.classList.toggle('side-hidden', sidePanel === 'none');
  if (sidePanel !== 'none') side.dataset.panel = sidePanel;
  if (sidePanel === 'objects') objectTree.render();
  for (const b of widgetButtons) {
    const on = b.dataset.panel === sidePanel;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  }
}
function showPanel(p: SidePanel, toggle = false): void {
  sidePanel = toggle && sidePanel === p ? 'none' : p;
  save('sidePanel', sidePanel);
  applySidePanel();
}
for (const b of widgetButtons) b.addEventListener('click', () => showPanel(b.dataset.panel as SidePanel, true));
applySidePanel();

// ---------- Grafiği sıfırla, son muma git ----------
function resetChart(): void {
  // Fiyat eksenini otomatiğe döndür (eksen sürüklenerek elle ölçeklendiyse), mum aralığını ve konumu sıfırla.
  (chart as unknown as { _resetYAxisAutoCalcTickFlag?: () => void })._resetYAxisAutoCalcTickFlag?.();
  chart.setBarSpace(8);
  chart.scrollToRealTime(0);
}
const toRealtime = h('button', {
  class: 'to-realtime',
  title: 'Son muma git',
  'aria-label': 'Son muma git',
  hidden: true,
  html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6l6 6-6 6M13 6l6 6-6 6"/></svg>',
  onclick: () => chart.scrollToRealTime(250),
});
chartWrap.append(toRealtime);
chart.subscribeAction('onVisibleRangeChange', (data) => {
  const r = data as { realTo?: number };
  const n = chart.getDataList().length;
  toRealtime.hidden = !(n > 0 && typeof r.realTo === 'number' && r.realTo < n - 1);
});

const IC = (d: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
// ---------- Fiyat ekseni menüsü (sağ alt köşedeki dişli ve eksende sağ tık) ----------
const CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
function resetPriceScale(): void {
  (chart as unknown as { _resetYAxisAutoCalcTickFlag?: () => void })._resetYAxisAutoCalcTickFlag?.();
  chart.resize();
}
function openScaleMenu(x: number, y: number): void {
  if (!bottomBar) return;
  const bb = bottomBar;
  const s = settings.settings;
  const on = (v: boolean) => (v ? CHECK : '');
  let close = () => {};
  const items = [
    { label: 'Fiyat ölçeğini sıfırla (otomatik)', hint: 'Alt+R', icon: IC('<path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4"/>'), onClick: resetPriceScale },
    null,
    { label: 'Normal', icon: on(bb.mode === 'normal'), onClick: () => bb.setMode('normal') },
    { label: 'Yüzde', hint: 'Alt+P', icon: on(bb.mode === 'percentage'), onClick: () => bb.setMode('percentage') },
    { label: 'Logaritmik', hint: 'Alt+L', icon: on(bb.mode === 'logarithm'), onClick: () => bb.setMode('logarithm') },
    { label: 'Ölçeği ters çevir', hint: 'Alt+I', icon: on(bb.reverse), onClick: () => bb.toggleReverse() },
    null,
    { label: 'Ölçek sağda', icon: on(s.axisPosition === 'right'), onClick: () => settings.update({ axisPosition: 'right' }) },
    { label: 'Ölçek solda', icon: on(s.axisPosition === 'left'), onClick: () => settings.update({ axisPosition: 'left' }) },
    null,
    { label: 'Son fiyat etiketi', icon: on(s.lastPriceLabel), onClick: () => settings.update({ lastPriceLabel: !s.lastPriceLabel }) },
    { label: 'Son fiyat çizgisi', icon: on(s.lastPriceLine), onClick: () => settings.update({ lastPriceLine: !s.lastPriceLine }) },
    { label: 'Mum kapanışına geri sayım', icon: on(s.countdown), onClick: () => settings.update({ countdown: !s.countdown }) },
    { label: 'En yüksek / en düşük işaretleri', icon: on(s.highLow), onClick: () => settings.update({ highLow: !s.highLow }) },
    null,
    { label: 'Diğer ayarlar…', icon: IC('<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>'), onClick: () => settings.openDialog('scales') },
  ];
  close = menuAt(x, y, menuList(items, () => close(), 'Fiyat ölçeği'));
}

// Sağ alt köşe (fiyat ekseni ile zaman ekseninin kesiştiği kutu): TradingView'daki ayar dişlisi.
const scaleCorner = h('button', {
  class: 'scale-corner',
  title: 'Fiyat ölçeği ayarları',
  'aria-label': 'Fiyat ölçeği ayarları',
  html: IC('<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>'),
});
scaleCorner.addEventListener('click', () => {
  const r = scaleCorner.getBoundingClientRect();
  openScaleMenu(r.left - 250, r.top - 8 - 520);
});
chartWrap.append(scaleCorner);
/** Fiyat ekseninin grafikteki yeri (px, grafiğin sol kenarına göre). */
function yAxisBox(): { left: number; width: number } | null {
  const b = chart.getSize('candle_pane', 'yAxis');
  return b && b.width > 0 ? { left: b.left, width: b.width } : null;
}
function placeScaleCorner(): void {
  const ax = yAxisBox();
  const xa = chart.getSize('x_axis_pane');
  if (!ax || !xa) return;
  scaleCorner.style.left = `${ax.left}px`;
  scaleCorner.style.width = `${ax.width}px`;
  scaleCorner.style.top = `${xa.top}px`;
  scaleCorner.style.height = `${xa.height}px`;
}
new ResizeObserver(() => requestAnimationFrame(placeScaleCorner)).observe(chartEl);
chart.subscribeAction('onVisibleRangeChange', () => requestAnimationFrame(placeScaleCorner));

// ---------- Grafikte sağ tık menüsü ----------
let crossPoint: { x: number; y: number; paneId: string } | null = null;
chart.subscribeAction('onCrosshairChange', (data) => {
  const c = data as { x?: number; y?: number; paneId?: string };
  crossPoint = c.x !== undefined && c.y !== undefined && c.paneId ? { x: c.x, y: c.y, paneId: c.paneId } : null;
});
/** Artı imlecin olduğu yerdeki fiyat ve zaman (yalnızca ana grafik bölmesinde). */
function pointUnderCursor(): { price: number; ts: number } | null {
  if (!crossPoint || crossPoint.paneId !== 'candle_pane') return null;
  const p = chart.convertFromPixel([{ x: crossPoint.x, y: crossPoint.y }], { paneId: 'candle_pane' });
  const pt = Array.isArray(p) ? p[0] : p;
  return typeof pt?.value === 'number' && typeof pt.timestamp === 'number' ? { price: pt.value, ts: pt.timestamp } : null;
}
function roundPrice(v: number): number {
  const prec = chart.getSymbol()?.pricePrecision ?? 2;
  return Number(v.toFixed(prec));
}
chartEl.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (replay.isOn && document.querySelector('#chart-wrap.replay-selecting')) return;
  const x = e.clientX;
  const y = e.clientY;
  // Fiyat ekseninin üstünde sağ tık: ölçek menüsü
  const ax = yAxisBox();
  const localX = x - chartEl.getBoundingClientRect().left;
  if (ax && localX >= ax.left && localX <= ax.left + ax.width) {
    openScaleMenu(x, y);
    return;
  }
  // Çizimin kendi menüsü aynı tıklamada açıldıysa grafik menüsünü açma.
  setTimeout(() => {
    if (drawings.overlayMenuRecently()) return;
    const at = pointUnderCursor();
    const price = at ? roundPrice(at.price) : null;
    const nd = drawings.drawingCount();
    const ni = indicators.count() + compare.ids().length;
    let close = () => {};
    const items = [
      { label: 'Grafiği sıfırla', hint: 'Alt+R', icon: IC('<path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4"/>'), onClick: resetChart },
      null,
      price !== null
        ? { label: `Alarm ekle: ${fmtPrice(price, state.symbol.id)}`, hint: 'Alt+A', icon: IC('<circle cx="12" cy="13" r="7"/><path d="M12 9.5V13l2.5 1.5M4 5l3-2.5M20 5l-3-2.5"/>'), onClick: () => alerts.openCreateDialog(price) }
        : { label: 'Alarm ekle…', hint: 'Alt+A', icon: IC('<circle cx="12" cy="13" r="7"/><path d="M12 9.5V13l2.5 1.5"/>'), onClick: () => alerts.openCreateDialog() },
      price !== null && at
        ? { label: `Yatay çizgi: ${fmtPrice(price, state.symbol.id)}`, icon: IC('<path d="M3 12h18"/><circle cx="12" cy="12" r="2"/>'), onClick: () => drawings.addHorizontalLine(price, at.ts) }
        : null,
      null,
      { label: 'Nesne ağacı', icon: IC('<path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 12.5l9 5 9-5M3 17l9 5 9-5"/>'), onClick: () => showPanel('objects') },
      { label: `Çizimleri kaldır (${nd})`, disabled: nd === 0, icon: IC('<path d="M4 20l4-1 11-11-3-3L5 16l-1 4z"/>'), onClick: () => drawings.removeDrawings() },
      { label: `Göstergeleri kaldır (${ni})`, disabled: ni === 0, icon: IC('<path d="M10 4.5c-2 0-2.5 1.2-2.8 3L5.5 19.5M4.5 10h6M13 10l6 8M19 10l-6 8"/>'), onClick: () => drawings.removeIndicators() },
      null,
      { label: 'Ayarlar…', icon: IC('<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>'), onClick: () => settings.openDialog() },
    ].filter((it, i, arr) => it !== null || (i > 0 && arr[i - 1] !== null));
    close = menuAt(x, y, menuList(items, () => close(), `${displayTicker(state.symbol)} · ${intervalLabel(state.interval)}`));
  }, 0);
});

// ---------- Klavye kısayolları ----------
const SHORTCUTS: [string, [string, string][]][] = [
  [
    'Grafik',
    [
      ['Sembol ara (harf yazmaya başlayın)', 'A–Z'],
      ['Grafiği sıfırla', 'Alt+R'],
      ['Alarm ekle', 'Alt+A'],
      ['Yakınlaştır / uzaklaştır', 'Fare tekerleği'],
      ['Fiyat eksenini sürükleyerek ölçekle, çift tıkla sıfırla', 'Eksen'],
      ['Tam ekran', 'F11'],
    ],
  ],
  [
    'Çizim',
    [
      ['Trend çizgisi', 'Alt+T'],
      ['Yatay çizgi', 'Alt+H'],
      ['Yatay ışın', 'Alt+J'],
      ['Dikey çizgi', 'Alt+V'],
      ['Kesişen çizgiler', 'Alt+C'],
      ['Fibonacci düzeltme', 'Alt+F'],
      ['Paralel kanal', 'Alt+K'],
      ['Arz / talep bölgesi', 'Alt+Z'],
      ['Cetvel: fiyat farkı, yüzde, mum, süre', 'Shift + tık'],
      ['Mıknatısı geçici aç / kapat', 'Ctrl (basılı)'],
      ['Çizgiyi yatay kilitle (çizerken)', 'Shift (basılı)'],
      ['Seçili çizimi sil', 'Delete'],
      ['Çizimi iptal et', 'Esc'],
      ['Geri al / yinele', 'Ctrl+Z / Ctrl+Y'],
      ['Çizim menüsü', 'Sağ tık'],
    ],
  ],
  [
    'Tekrar oynat',
    [
      ['Bir mum ileri', 'Shift+→'],
      ['Oynat / duraklat', 'Shift+↓'],
    ],
  ],
];
function openShortcuts(): void {
  const grid = h('div', { class: 'keys-grid' });
  for (const [section, rows] of SHORTCUTS) {
    grid.append(h('div', { class: 'keys-section', text: section }));
    for (const [label, key] of rows) grid.append(h('span', { text: label }), h('span', null, h('kbd', { text: key })));
  }
  modal('Klavye kısayolları', grid);
}
document.getElementById('btn-keys')!.addEventListener('click', openShortcuts);
document.addEventListener('keydown', (e) => {
  if (isTyping(e) || isModalOpen()) return;
  if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyR') {
    e.preventDefault();
    resetChart();
  } else if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyA') {
    e.preventDefault();
    const at = pointUnderCursor();
    alerts.openCreateDialog(at ? roundPrice(at.price) : undefined);
  } else if (e.key === '?' && !e.ctrlKey && !e.altKey) {
    e.preventDefault();
    openShortcuts();
  }
});

// ---------- Görünüm menüsü: aydınlık / karanlık, vurgu rengi ----------
const themeBtn = document.getElementById('btn-theme')!;
function applyAppearance(): void {
  applyChartTheme(chart);
  settings.apply();
  drawings.refreshCursor();
  alerts.drawLines(true);
}
themeBtn.addEventListener('click', () => {
  let close = () => {};
  const row = (label: string, on: boolean, icon: string, pick: () => void) => {
    const b = h(
      'button',
      { class: `menu-row${on ? ' active' : ''}` },
      h('span', { class: 'menu-icon', html: icon }),
      h('span', { class: 'menu-label', text: label }),
      h('span', { class: 'menu-check', text: on ? '✓' : '' }),
    );
    b.addEventListener('click', () => {
      close();
      pick();
      applyAppearance();
    });
    return b;
  };
  const sun = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
  const moon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>';
  const dot = (c: string) => `<span class="menu-swatch" style="background:${c}"></span>`;
  const themes: { t: ThemeName; label: string; icon: string }[] = [
    { t: 'light', label: 'Aydınlık tema', icon: sun },
    { t: 'dark', label: 'Karanlık tema', icon: moon },
  ];
  const accents: { a: AccentName; label: string; color: string }[] = [
    { a: 'coral', label: 'Mercan (Claude)', color: '#d97757' },
    { a: 'blue', label: 'Mavi (klasik)', color: '#2962ff' },
  ];
  const box = h(
    'div',
    null,
    h('div', { class: 'menu-title', text: 'Tema' }),
    ...themes.map((x) => row(x.label, currentTheme() === x.t, x.icon, () => setTheme(x.t))),
    h('div', { class: 'menu-title', text: 'Vurgu rengi' }),
    ...accents.map((x) => row(x.label, currentAccent() === x.a, dot(x.color), () => setAccent(x.a))),
  );
  close = popover(themeBtn, box, 'tool-menu');
});

// Ses ilk tıklamada açılır (önceki oturumdan kalan alarmlar da ses çıkarabilsin).
document.addEventListener('pointerdown', unlockAudio, { once: true });

// Gram altın listede yoksa bir kez eklenir (sonradan çıkarılırsa geri gelmez).
if (!load<boolean>('gramAltinAdded', false)) {
  watchlist.add({ id: 'YAHOO:GRAMALTIN', source: 'YAHOO', ticker: 'GRAMALTIN', name: 'Gram altın (TL)', exchange: 'Hesaplanan', type: 'Emtia' });
  save('gramAltinAdded', true);
}

void openSymbol(state.symbol, state.interval);
compare.restore();
