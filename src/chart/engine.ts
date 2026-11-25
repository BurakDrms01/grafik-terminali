// KLineChart'ın çizim motoruna yapılan TradingView tarzı düzeltmeler (bir kez kurulur):
//
// 1. Net çizim: yatay/dikey çizgiler, dikdörtgenler (mumlar dahil) ve yazılar tam piksele oturtulur.
//    Yarım piksele düşen çizgi iki piksele yayılıp silik ve bulanık görünüyordu.
// 2. Mıknatıs: kütüphane zayıf mıknatısta bile mumun gövdesine tıklanınca her zaman yapıştırıyordu ve
//    mesafeyi fiyatla ölçüyordu. Şimdi en yakın A/Y/D/K değeri piksel mesafesine göre seçilir:
//    zayıf = yakınsa yapışır, güçlü = her zaman yapışır. Ctrl basılıyken mıknatıs geçici olarak açılır/kapanır.
//    Mıknatıs yalnızca çizerken ve uç noktası sürüklenirken çalışır; çizimin tamamı taşınırken zıplatmaz.
// 3. Çizimi bütün olarak taşımak: kütüphane fiyata sabit bir fark ekliyordu; log ölçekte kutular ve
//    Fibonacci'ler taşındıkça daralıp genişliyordu. Artık ekranda ne kadar kaydırıldıysa o kadar kayar.
// 4. Shift basılıyken çizgi çizmek yatay kilitler (destek/direnç için).
import { getFigureClass, getOverlayClass, type Chart } from 'klinecharts';
import { magnetValue, snapLines, snapPolygons, snapRects, snapTexts } from './snap.ts';

const keys = { ctrl: false, shift: false };

/** Shift ile yatay kilitlenen 2 noktalı çizgiler */
const HORIZONTAL_LOCK = new Set(['segment', 'rayLine', 'straightLine', 'gtInfoLine', 'gtArrow', 'gtExtendedLine']);

/** Mıknatıs uygulanmayan araçlar */
const NO_MAGNET = new Set(['brush', 'gtHighlighter', 'gtText', 'gtEmoji', 'simpleAnnotation']);

// ---------- Kütüphanenin iç tipleri (yalnızca kullandığımız kadarı) ----------

interface Pt {
  timestamp?: number;
  dataIndex?: number;
  value?: number;
}

interface YAxisLike {
  convertToPixel(v: number): number;
  convertFromPixel(px: number): number;
}

interface StoreLike {
  getChart(): ChartLike;
  getDataByDataIndex(i: number): { open: number; high: number; low: number; close: number } | null;
  getPressedOverlayInfo(): { overlay: unknown; figureType: string };
  timestampToDataIndex(ts: number): number;
  timestampToFloatIndex(ts: number): number;
  dataIndexToTimestamp(i: number): number | null;
  floatIndexToTimestamp(i: number): number | null;
}

interface PaneLike {
  getId(): string;
  getChart(): ChartLike;
  getYAxisComponentById(id?: string): YAxisLike;
}

interface ChartLike {
  getChartStore(): StoreLike;
  getDrawPaneById(id: string): (PaneLike & { getMainWidget(): { _overlayView?: object } }) | null;
}

interface OverlayLike {
  name: string;
  mode: string;
  paneId: string;
  points: Pt[];
  currentStep: number;
  isDrawing(): boolean;
  isContinuousDrawingMode(): boolean;
  _prevPressedPoint: Pt | null;
  _prevPressedPoints: Pt[];
}

interface OverlayViewLike {
  getWidget(): { getPane(): PaneLike };
  _coordinateToPoint(o: OverlayLike, c: { x: number; y: number }): Pt;
}

// ---------- 1. Net çizim ----------

type Coord = { x: number; y: number };

function patchFigure(name: string, snap: (a: unknown) => unknown): void {
  const cls = getFigureClass(name) as unknown as { prototype: { drawImp: (ctx: unknown, a: unknown, s: unknown) => void; __gtSnap?: boolean } } | null;
  if (!cls || cls.prototype.__gtSnap) return;
  const orig = cls.prototype.drawImp;
  cls.prototype.drawImp = function (ctx, attrs, styles) {
    orig.call(this, ctx, snap(attrs), styles);
  };
  cls.prototype.__gtSnap = true;
}

// ---------- 2 + 4. Mıknatıs ve Shift ----------

function magnetize(view: OverlayViewLike, o: OverlayLike, c: Coord, point: Pt): Pt {
  const pane = view.getWidget().getPane();
  if (pane.getId() !== 'candle_pane' || typeof point.value !== 'number' || typeof point.dataIndex !== 'number') return point;
  const store = pane.getChart().getChartStore();
  const pressed = store.getPressedOverlayInfo();
  // Fırça/vurgulayıcı (serbest çizim) ve yazılar mıknatısa takılmasın.
  if (o.isContinuousDrawingMode() || NO_MAGNET.has(o.name)) return point;
  const drawing = o.isDrawing();
  // Çizimin tamamı sürüklenirken (ya da tıklama anında) mıknatıs yok; yalnızca çizerken ve uç nokta taşınırken.
  if (!drawing && !(pressed.overlay === o && pressed.figureType === 'point')) return point;

  if (keys.shift && drawing && o.currentStep >= 2 && HORIZONTAL_LOCK.has(o.name)) {
    const first = o.points[0]?.value;
    if (typeof first === 'number') return { ...point, value: first };
  }

  let mode = o.mode;
  if (keys.ctrl) mode = mode === 'normal' ? 'strong_magnet' : 'normal';
  if (mode !== 'weak_magnet' && mode !== 'strong_magnet') return point;
  const k = store.getDataByDataIndex(Math.round(point.dataIndex));
  if (!k) return point;
  const yAxis = pane.getYAxisComponentById();
  const v = magnetValue(k, c.y, (x) => yAxis.convertToPixel(x), mode === 'strong_magnet');
  return v === null ? point : { ...point, value: v };
}

// ---------- 3. Bütün olarak taşıma (ekran pikseli kadar) ----------

function pressedOtherMove(this: OverlayLike, point: Pt, store: StoreLike): void {
  const prev = this._prevPressedPoint;
  if (prev === null) return;
  const dIndex = typeof point.dataIndex === 'number' && typeof prev.dataIndex === 'number' ? point.dataIndex - prev.dataIndex : null;
  const yAxis = store.getChart().getDrawPaneById(this.paneId)?.getYAxisComponentById();
  const dy =
    yAxis && typeof point.value === 'number' && typeof prev.value === 'number'
      ? yAxis.convertToPixel(point.value) - yAxis.convertToPixel(prev.value)
      : null;
  const continuous = this.isContinuousDrawingMode();
  this.points = this._prevPressedPoints.map((p) => {
    const np: Pt = { ...p };
    if (dIndex !== null && (typeof p.dataIndex === 'number' || typeof p.timestamp === 'number')) {
      const base =
        typeof p.timestamp === 'number'
          ? continuous
            ? store.timestampToFloatIndex(p.timestamp)
            : store.timestampToDataIndex(p.timestamp)
          : (p.dataIndex as number);
      np.dataIndex = base + dIndex;
      np.timestamp = (continuous ? store.floatIndexToTimestamp(np.dataIndex) : store.dataIndexToTimestamp(np.dataIndex)) ?? undefined;
    }
    if (dy !== null && yAxis && typeof p.value === 'number') {
      const v = yAxis.convertFromPixel(yAxis.convertToPixel(p.value) + dy);
      if (Number.isFinite(v)) np.value = v;
    }
    return np;
  });
}

// ---------- Kurulum ----------

let installed = false;

export function installEngine(chart: Chart): void {
  if (installed) return;
  installed = true;

  patchFigure('line', snapLines);
  patchFigure('rect', snapRects);
  patchFigure('polygon', snapPolygons);
  patchFigure('text', snapTexts);

  const c = chart as unknown as ChartLike;
  const view = c.getDrawPaneById('candle_pane')?.getMainWidget()._overlayView as OverlayViewLike | undefined;
  if (view) {
    const proto = Object.getPrototypeOf(view) as OverlayViewLike & { __gtMagnet?: boolean };
    if (!proto.__gtMagnet) {
      proto.__gtMagnet = true;
      const orig = proto._coordinateToPoint;
      proto._coordinateToPoint = function (this: OverlayViewLike, o: OverlayLike, coord: Coord) {
        const mode = o.mode;
        o.mode = 'normal';
        let p: Pt;
        try {
          p = orig.call(this, o, coord);
        } finally {
          o.mode = mode;
        }
        return magnetize(this, o, coord, p);
      };
    }
  }

  // Bütün olarak taşıma: OverlayImp sınıfı, kayıtlı herhangi bir çizim sınıfının üst sınıfıdır.
  const overlayProto = getOverlayImpProto();
  if (overlayProto) overlayProto.eventPressedOtherMove = pressedOtherMove;

  const sync = (e: KeyboardEvent | MouseEvent) => {
    keys.ctrl = e.ctrlKey || e.metaKey;
    keys.shift = e.shiftKey;
  };
  window.addEventListener('keydown', sync, true);
  window.addEventListener('keyup', sync, true);
  window.addEventListener('mousemove', sync, true);
  window.addEventListener('mousedown', sync, true);
  window.addEventListener('blur', () => {
    keys.ctrl = false;
    keys.shift = false;
  });
}

function getOverlayImpProto(): { eventPressedOtherMove: unknown } | null {
  const cls = getOverlayClass('segment') as unknown as { prototype: object } | null;
  if (!cls) return null;
  return Object.getPrototypeOf(cls.prototype) as { eventPressedOtherMove: unknown };
}

/** Mıknatıs için Ctrl/Shift durumu (cetvel Shift+tık için de kullanır). */
export function modifierKeys(): Readonly<typeof keys> {
  return keys;
}
