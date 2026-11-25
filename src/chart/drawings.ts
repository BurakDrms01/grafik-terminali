import type { Chart, Overlay, OverlayCreate, OverlayEvent, OverlayMode } from 'klinecharts';
import { keys, load, remove, save } from '../store.ts';
import { clear, h, isModalOpen, isTyping, menuAt, menuList, modal, popover, promptDialog, toast } from '../ui/dom.ts';
import { cssVar, withAlpha } from '../ui/theme.ts';
import { defaultFibSettings, normalizeFibSettings, type FibSettings } from './fib.ts';
import { modifierKeys } from './engine.ts';
import {
  EMOJIS,
  findTool,
  POSITION_DEFAULTS,
  registerTools,
  RULER_TOOL,
  TOOL_GROUPS,
  type ChannelData,
  type RectData,
  type ToolDef,
  type ToolGroup,
} from './tools.ts';

const GROUP = 'drawings';
/** Cetvel ölçümleri ayrı grupta: kaydedilmez, nesne ağacında görünmez. */
const RULER_GROUP = 'ruler';
/** Renk seçilebilen çizimlerin varsayılan kalınlığı (TradingView gibi 2 px). Fibonacci/pozisyon gibi kendi renkleri olanlar 1 px. */
export const DEFAULT_WIDTH = 2;

/** Kenarlı alan çizimleri (kutu, bölge, daire, üçgen) varsayılan olarak 1 px kenarla çizilir. */
const AREA_TOOLS = new Set(['gtRect', 'gtZone', 'gtCircle', 'gtTriangle']);

function defaultWidth(name: string): number {
  return findTool(name)?.fixedColors || AREA_TOOLS.has(name) ? 1 : DEFAULT_WIDTH;
}
const FINISHED = -1;
const HISTORY_LIMIT = 100;

type Dash = 'solid' | 'dashed' | 'dotted';
type CursorMode = 'cross' | 'dot' | 'arrow' | 'eraser';
type Magnet = 'off' | 'weak' | 'strong';

interface SavedDrawing {
  name: string;
  points: { timestamp?: number; value?: number }[];
  extendData?: unknown;
  styles?: unknown;
  lock?: boolean;
  /** Tek tek gizlenmiş çizim (nesne ağacından ya da sağ tık menüsünden) */
  hidden?: boolean;
}

/** Nesne ağacında gösterilecek çizim bilgisi */
export interface DrawingItem {
  id: string;
  title: string;
  icon: string;
  hidden: boolean;
  locked: boolean;
  info: string;
}

interface ToolStyle {
  color: string;
  width: number;
  dash: Dash;
}

interface Prefs {
  magnet: Magnet;
  locked: boolean;
  hidden: boolean;
  stay: boolean;
  cursor: CursorMode;
  groupTool: Record<string, string>;
}

const DEFAULT_PREFS: Prefs = { magnet: 'off', locked: false, hidden: false, stay: false, cursor: 'cross', groupTool: {} };

const svg = (body: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

const CURSORS: { mode: CursorMode; title: string; icon: string }[] = [
  { mode: 'cross', title: 'Artı imleç', icon: svg('<path d="M12 3v18M3 12h18"/>') },
  { mode: 'dot', title: 'Nokta imleç', icon: svg('<circle cx="12" cy="12" r="2.5" fill="currentColor"/>') },
  { mode: 'arrow', title: 'Ok imleç (artı çizgileri gizli)', icon: svg('<path d="M6 3l12 9-5.5 1.2L15 20l-2.5 1-2.6-6.6L6 18z"/>') },
  { mode: 'eraser', title: 'Silgi: tıkladığın çizim silinir', icon: svg('<path d="M15 4l5 5-9 9H6l-3-3z"/><path d="M9 21h12"/>') },
];

const ICONS = {
  zoomIn: svg('<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21M10.5 7.5v6M7.5 10.5h6"/>'),
  zoomOut: svg('<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21M7.5 10.5h6"/>'),
  magnet: svg('<path d="M6 4v8a6 6 0 0 0 12 0V4"/><path d="M6 8h4M14 8h4"/>'),
  stay: svg('<path d="M4 20l4-1 11-11-3-3L5 16z"/><path d="M14 6l3 3"/><path d="M17 15v5M14.5 17.5h5"/>'),
  lock: svg('<rect x="5" y="11" width="14" height="9" rx="1.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'),
  eye: svg('<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="2.6"/>'),
  trash: svg('<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>'),
  trashLines: svg('<path d="M4 19L20 5"/><circle cx="4" cy="19" r="1.7"/><circle cx="20" cy="5" r="1.7"/><path d="M14 17l5 5M19 17l-5 5"/>'),
  trashFx: svg('<path d="M11 5.5c-1.6-.6-3 .2-3.3 2L6 18c-.3 1.8-1.7 2.6-3.3 2"/><path d="M4.5 10.5h7"/><path d="M14 13l6 7M20 13l-6 7"/>'),
  gear: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  edit: svg('<path d="M4 20h4L19 9l-4-4L4 16z"/>'),
  extend: svg('<path d="M3 12h15M15 8l4 4-4 4"/><path d="M21 5v14"/>'),
  extendLeft: svg('<path d="M21 12H6M9 8l-4 4 4 4"/><path d="M3 5v14"/>'),
  middle: svg('<path d="M3 6h18M3 18h18"/><path d="M3 12h18" stroke-dasharray="3 3"/>'),
  fill: svg('<path d="M3 6h18v12H3z" fill="currentColor" fill-opacity=".25"/>'),
  applyAll: svg('<rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/><path d="M11 7h4a2 2 0 0 1 2 2v2M15 9l2 2 2-2"/>'),
  clone: svg('<rect x="8" y="8" width="12" height="12" rx="1.5"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>'),
};

export const PALETTE = [
  '#d97757', '#e0614f', '#e58a3a', '#e9b44c', '#4cb38a', '#2fa59a', '#5ba4c9', '#5b7fd9',
  '#b48ade', '#d9579a', '#ece9e1', '#a8a397', '#6b675f', '#26a69a', '#ef5350', '#000000',
];

function dashOf(o: Overlay<unknown>): Dash {
  const l = o.styles?.line;
  if (l?.style !== 'dashed') return 'solid';
  const dv = l.dashedValue;
  return Array.isArray(dv) && dv[0] === 1 ? 'dotted' : 'dashed';
}

function styleFor(color: string, width: number, dash: Dash): OverlayCreate['styles'] {
  const style = dash === 'solid' ? 'solid' : 'dashed';
  const dashedValue = dash === 'dotted' ? [1, 3] : [6, 4];
  const fill = withAlpha(color, 0.18);
  const border = { borderColor: color, borderSize: width, borderStyle: style, borderDashedValue: dashedValue } as const;
  return {
    line: { color, size: width, style, dashedValue },
    rect: { color: fill, ...border },
    polygon: { color: fill, ...border },
    circle: { color: fill, ...border },
    point: {
      color: '#ffffff',
      borderColor: color,
      borderSize: 2,
      radius: 5,
      activeColor: color,
      activeBorderColor: withAlpha(color, 0.35),
      activeBorderSize: 4,
      activeRadius: 6,
    },
    text: { color: '#ffffff', backgroundColor: color, borderColor: color },
  };
}

function loadPrefs(): Prefs {
  const raw = load<Record<string, unknown>>('drawPrefs', {});
  const p = { ...DEFAULT_PREFS, groupTool: {}, ...raw } as Prefs;
  // Eski sürüm mıknatısı true/false olarak saklıyordu.
  if (typeof raw.magnet === 'boolean') p.magnet = raw.magnet ? 'weak' : 'off';
  if (!['off', 'weak', 'strong'].includes(p.magnet)) p.magnet = 'off';
  if (!CURSORS.some((c) => c.mode === p.cursor)) p.cursor = 'cross';
  if (!p.groupTool || typeof p.groupTool !== 'object') p.groupTool = {};
  if (p.groupTool.channels === 'parallelStraightLine') delete p.groupTool.channels;
  return p;
}

export class Drawings {
  private symbolId: string | null = null;
  private suspended = false;
  private selectedId: string | null = null;
  private drawingId: string | null = null;
  private drawingTool: ToolDef | null = null;
  private prefs: Prefs = loadPrefs();
  private groupButtons = new Map<string, { btn: HTMLButtonElement; group: ToolGroup }>();
  private cursorBtn!: HTMLButtonElement;
  private rulerBtn!: HTMLButtonElement;
  /** Ekrandaki cetvel ölçümü (geçici) */
  private rulerId: string | null = null;
  private magnetBtn!: HTMLButtonElement;
  private stayBtn!: HTMLButtonElement;
  private lockBtn!: HTMLButtonElement;
  private eyeBtn!: HTMLButtonElement;
  private readonly styleBar: HTMLElement;
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private lastSnapshot = '[]';
  /** Geri al/yinele düğmelerini güncellemek için. */
  onHistoryChange: (canUndo: boolean, canRedo: boolean) => void = () => {};
  /** Çöp kutusu menüsünün göstergeleri de silebilmesi için (main.ts bağlar). removeAll geri alma fonksiyonu döndürür. */
  indicatorOps: { count: () => number; removeAll: () => () => void } = { count: () => 0, removeAll: () => () => {} };
  private trashBtn!: HTMLButtonElement;
  /** Tek tek gizlenen çizimler (genel "tümünü gizle"den bağımsız) */
  private itemHidden = new Set<string>();
  private lastOverlayMenu = 0;
  /** Çizim listesi değişince (nesne ağacı için) */
  onListChange: () => void = () => {};
  /** Fiyatı biçimlendirmek için (nesne ağacı) */
  formatPrice: (v: number) => string = (v) => String(v);

  constructor(
    private readonly chart: Chart,
    bar: HTMLElement,
    private readonly chartWrap: HTMLElement,
  ) {
    registerTools();
    this.styleBar = h('div', { class: 'style-bar', hidden: true, role: 'toolbar', 'aria-label': 'Çizim ayarları' });
    chartWrap.append(this.styleBar);
    this.buildToolbar(bar);
    this.refreshCursor();
    document.addEventListener('keydown', (e) => this.onKey(e));
    // Cetvel: bitmiş ölçüm sonraki tıklamada kaybolur; Shift + tık yeni ölçüm başlatır (TradingView gibi).
    chartWrap.addEventListener('mousedown', (e) => this.onChartMouseDown(e), true);
  }

  // ---------- Araç çubuğu ----------

  private buildToolbar(bar: HTMLElement): void {
    // İmleç
    this.cursorBtn = h('button', { class: 'draw-btn' });
    this.cursorBtn.addEventListener('click', () => this.openCursorMenu());
    bar.append(this.groupWrap(this.cursorBtn, () => this.openCursorMenu(), 'İmleç türleri'));
    bar.append(h('div', { class: 'draw-sep' }));

    for (const group of TOOL_GROUPS) {
      const btn = h('button', { class: 'draw-btn' });
      btn.addEventListener('click', () => {
        const t = this.currentTool(group);
        if (this.drawingTool?.name === t.name) this.cancelDrawing();
        else void this.startTool(t);
      });
      this.groupButtons.set(group.id, { btn, group });
      bar.append(this.groupWrap(btn, () => this.openGroupMenu(group, btn), `${group.title}: tüm araçlar`));
      this.paintGroupButton(group.id);
    }

    this.rulerBtn = this.plainButton(RULER_TOOL.icon, `${RULER_TOOL.title}: fiyat farkı, yüzde, mum sayısı ve süre`, () => {
      if (this.rulerId) this.clearRuler();
      else this.startRuler();
    });
    bar.append(this.rulerBtn);
    bar.append(h('div', { class: 'draw-sep' }));
    bar.append(
      this.plainButton(ICONS.zoomIn, 'Yakınlaştır', () => this.zoom(1.25)),
      this.plainButton(ICONS.zoomOut, 'Uzaklaştır', () => this.zoom(0.8)),
    );
    bar.append(h('div', { class: 'draw-sep' }));
    this.magnetBtn = h('button', { class: 'draw-btn', html: ICONS.magnet });
    this.magnetBtn.addEventListener('click', () => this.openMagnetMenu());
    bar.append(this.groupWrap(this.magnetBtn, () => this.openMagnetMenu(), 'Mıknatıs seçenekleri'));
    this.stayBtn = this.plainButton(ICONS.stay, 'Çizim modunda kal (araç bitince tekrar başlar)', () => {
      this.prefs.stay = !this.prefs.stay;
      this.savePrefs();
    });
    this.lockBtn = this.plainButton(ICONS.lock, 'Tüm çizimleri kilitle', () => {
      this.prefs.locked = !this.prefs.locked;
      this.chart.overrideOverlay({ groupId: GROUP, lock: this.prefs.locked });
      this.savePrefs();
    });
    this.eyeBtn = this.plainButton(ICONS.eye, 'Tüm çizimleri gizle', () => {
      this.prefs.hidden = !this.prefs.hidden;
      this.applyVisibility();
      this.savePrefs();
      this.onListChange();
    });
    this.trashBtn = h('button', { class: 'draw-btn', html: ICONS.trash, title: 'Kaldır: çizimler / göstergeler', 'aria-label': 'Kaldır menüsü' });
    this.trashBtn.addEventListener('click', () => this.openTrashMenu());
    bar.append(this.stayBtn, this.lockBtn, this.eyeBtn, this.groupWrap(this.trashBtn, () => this.openTrashMenu(), 'Kaldır seçenekleri'));
    this.syncToggles();
  }

  private groupWrap(main: HTMLButtonElement, openMenu: () => void, caretLabel: string): HTMLElement {
    const caret = h('button', { class: 'group-caret', title: caretLabel, 'aria-label': caretLabel, html: '<svg viewBox="0 0 6 6"><path d="M1 5h4V1z" fill="currentColor"/></svg>' });
    caret.addEventListener('click', (e) => {
      e.stopPropagation();
      openMenu();
    });
    main.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      openMenu();
    });
    return h('div', { class: 'tool-group' }, main, caret);
  }

  private plainButton(icon: string, title: string, onClick: () => void): HTMLButtonElement {
    const b = h('button', { class: 'draw-btn', title, 'aria-label': title, html: icon });
    b.addEventListener('click', onClick);
    return b;
  }

  private currentTool(group: ToolGroup): ToolDef {
    const name = this.prefs.groupTool[group.id];
    return group.tools.find((t) => t.name === name) ?? group.tools[0];
  }

  private paintGroupButton(groupId: string): void {
    const entry = this.groupButtons.get(groupId);
    if (!entry) return;
    const t = this.currentTool(entry.group);
    entry.btn.innerHTML = t.icon;
    const tip = `${t.title}${t.hotkey ? ` (Alt+${t.hotkey})` : ''} — sağ tık / köşe: ${entry.group.title}`;
    entry.btn.title = tip;
    entry.btn.setAttribute('aria-label', t.title);
    entry.btn.classList.toggle('active', this.drawingTool?.name === t.name);
  }

  private paintAllGroups(): void {
    for (const id of this.groupButtons.keys()) this.paintGroupButton(id);
  }

  private menuRow(icon: string, title: string, hint: string, active: boolean, onClick: () => void): HTMLElement {
    const row = h(
      'button',
      { class: `menu-row${active ? ' active' : ''}` },
      h('span', { class: 'menu-icon', html: icon }),
      h('span', { class: 'menu-label', text: title }),
      hint ? h('span', { class: 'menu-hint', text: hint }) : null,
    );
    row.addEventListener('click', onClick);
    return row;
  }

  private openGroupMenu(group: ToolGroup, anchor: HTMLElement): void {
    let close = () => {};
    const box = h('div', null, h('div', { class: 'menu-title', text: group.title }));
    for (const t of group.tools) {
      box.append(
        this.menuRow(t.icon, t.title, t.hotkey ? `Alt+${t.hotkey}` : '', this.currentTool(group).name === t.name, () => {
          close();
          this.prefs.groupTool[group.id] = t.name;
          this.savePrefs();
          this.paintGroupButton(group.id);
          void this.startTool(t);
        }),
      );
    }
    close = popover(anchor, box, 'tool-menu', 'right');
  }

  private openCursorMenu(): void {
    let close = () => {};
    const box = h('div', null, h('div', { class: 'menu-title', text: 'İmleç' }));
    for (const c of CURSORS) {
      box.append(
        this.menuRow(c.icon, c.title, '', this.prefs.cursor === c.mode, () => {
          close();
          this.setCursor(c.mode);
        }),
      );
    }
    close = popover(this.cursorBtn, box, 'tool-menu', 'right');
  }

  private openMagnetMenu(): void {
    let close = () => {};
    const options: { m: Magnet; title: string }[] = [
      { m: 'off', title: 'Mıknatıs kapalı' },
      { m: 'weak', title: 'Zayıf mıknatıs (yakınsa mum fiyatına yapışır)' },
      { m: 'strong', title: 'Güçlü mıknatıs (her zaman OHLC fiyatına yapışır)' },
    ];
    const box = h('div', null, h('div', { class: 'menu-title', text: 'Mıknatıs' }));
    for (const o of options) {
      box.append(
        this.menuRow(ICONS.magnet, o.title, '', this.prefs.magnet === o.m, () => {
          close();
          this.setMagnet(o.m);
        }),
      );
    }
    close = popover(this.magnetBtn, box, 'tool-menu', 'right');
  }

  private setMagnet(m: Magnet): void {
    this.prefs.magnet = m;
    this.chart.overrideOverlay({ groupId: GROUP, mode: this.mode() });
    this.savePrefs();
  }

  private setCursor(mode: CursorMode): void {
    this.prefs.cursor = mode;
    this.savePrefs();
    this.refreshCursor();
  }

  /** İmleç türünü uygular (tema değişince artı çizgisi ayarı sıfırlandığı için yeniden çağrılır). */
  refreshCursor(): void {
    const c = CURSORS.find((x) => x.mode === this.prefs.cursor) ?? CURSORS[0];
    this.cursorBtn.innerHTML = c.icon;
    this.cursorBtn.title = `${c.title} — değiştirmek için köşeye tıklayın`;
    this.cursorBtn.setAttribute('aria-label', c.title);
    this.cursorBtn.classList.toggle('active', c.mode === 'eraser');
    for (const m of CURSORS) this.chartWrap.classList.toggle(`cursor-${m.mode}`, m.mode === c.mode);
    this.chart.setStyles({ crosshair: { show: c.mode !== 'arrow' && c.mode !== 'eraser' } });
  }

  private zoom(scale: number): void {
    const size = this.chart.getSize('candle_pane', 'main');
    this.chart.zoomAtCoordinate(scale, size ? { x: size.width / 2, y: size.height / 2 } : undefined, 150);
  }

  private savePrefs(): void {
    save('drawPrefs', this.prefs);
    this.syncToggles();
  }

  private syncToggles(): void {
    const set = (b: HTMLButtonElement, on: boolean, title?: string) => {
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
      if (title) {
        b.title = title;
        b.setAttribute('aria-label', title);
      }
    };
    const magnetTitle = { off: 'Mıknatıs kapalı', weak: 'Zayıf mıknatıs açık', strong: 'Güçlü mıknatıs açık' }[this.prefs.magnet];
    set(this.magnetBtn, this.prefs.magnet !== 'off', `${magnetTitle} — tıklayıp seçin: kapalı / zayıf / güçlü`);
    this.magnetBtn.dataset.badge = { off: '', weak: 'Z', strong: 'G' }[this.prefs.magnet];
    set(this.stayBtn, this.prefs.stay);
    set(this.lockBtn, this.prefs.locked);
    set(this.eyeBtn, this.prefs.hidden);
  }

  private mode(): OverlayMode {
    return this.prefs.magnet === 'strong' ? 'strong_magnet' : this.prefs.magnet === 'weak' ? 'weak_magnet' : 'normal';
  }

  // ---------- Çizim oluşturma ----------

  private callbacks(): Partial<OverlayCreate> {
    return {
      onDrawEnd: (e: OverlayEvent<unknown>) => {
        const tool = this.drawingTool;
        this.completePosition(e.overlay.id);
        if (this.drawingId === e.overlay.id) {
          this.drawingId = null;
          this.drawingTool = null;
        }
        this.paintAllGroups();
        this.persist();
        if (tool && this.prefs.stay) void this.startTool(tool);
      },
      onPressedMoveEnd: () => this.persist(),
      onRemoved: (e: OverlayEvent<unknown>) => {
        if (this.selectedId === e.overlay.id) this.select(null);
        if (this.drawingId === e.overlay.id) {
          this.drawingId = null;
          this.drawingTool = null;
          this.paintAllGroups();
        }
        this.persist(e.overlay.id);
      },
      onClick: (e: OverlayEvent<unknown>) => {
        if (this.prefs.cursor === 'eraser' && e.overlay.currentStep === FINISHED) this.chart.removeOverlay({ id: e.overlay.id });
      },
      onDoubleClick: (e: OverlayEvent<unknown>) => this.openSettings(e.overlay.id),
      onRightClick: (e: OverlayEvent<unknown>) => {
        // TradingView gibi: sağ tık çizimi silmez, çizim menüsünü açar.
        e.preventDefault?.();
        if (e.overlay.currentStep !== FINISHED) return;
        this.lastOverlayMenu = Date.now();
        this.openOverlayMenu(e.overlay.id, e.pageX ?? 0, e.pageY ?? 0);
      },
      onSelected: (e: OverlayEvent<unknown>) => this.select(e.overlay.id),
      onDeselected: (e: OverlayEvent<unknown>) => {
        if (this.selectedId === e.overlay.id) this.select(null);
      },
    };
  }

  /** Pozisyon aracı tek tıkla kurulur: hedef ve zarar-durdur, önizlemedeki yerlerine konur (sonra sürüklenir). */
  private completePosition(id: string): void {
    const o = this.chart.getOverlays({ id })[0];
    if (!o || (o.name !== 'gtLongPosition' && o.name !== 'gtShortPosition') || o.points.length >= 3) return;
    const p0 = o.points[0];
    if (typeof p0?.timestamp !== 'number' || typeof p0.value !== 'number') return;
    const at = this.chart.convertToPixel({ timestamp: p0.timestamp, value: p0.value }, { paneId: 'candle_pane' }) as { x?: number; y?: number };
    const height = this.chart.getSize('candle_pane', 'main')?.height ?? 400;
    if (typeof at?.x !== 'number' || typeof at.y !== 'number') return;
    const dir = o.name === 'gtLongPosition' ? -1 : 1;
    const x = at.x + POSITION_DEFAULTS.widthPx;
    const pts = this.chart.convertFromPixel(
      [
        { x, y: at.y + dir * height * POSITION_DEFAULTS.target },
        { x, y: at.y - dir * height * POSITION_DEFAULTS.stop },
      ],
      { paneId: 'candle_pane' },
    ) as { timestamp?: number; value?: number }[];
    if (!Array.isArray(pts) || pts.some((p) => typeof p.timestamp !== 'number' || typeof p.value !== 'number')) return;
    const prec = this.chart.getSymbol()?.pricePrecision ?? 2;
    const round = (v: number) => Number(v.toFixed(prec));
    this.chart.overrideOverlay({
      id,
      points: [
        { timestamp: p0.timestamp, value: p0.value },
        { timestamp: pts[0].timestamp, value: round(pts[0].value as number) },
        { timestamp: pts[0].timestamp, value: round(pts[1].value as number) },
      ],
    });
  }

  // ---------- Cetvel ----------

  private startRuler(): void {
    this.cancelDrawing();
    this.clearRuler();
    if (this.prefs.cursor === 'eraser') this.setCursor('cross');
    const id = this.chart.createOverlay({
      name: RULER_TOOL.name,
      groupId: RULER_GROUP,
      mode: this.mode(),
      onDrawEnd: () => this.paintRuler(),
      onRightClick: (e: OverlayEvent<unknown>) => {
        e.preventDefault?.();
        this.clearRuler();
      },
    });
    this.rulerId = typeof id === 'string' ? id : null;
    this.paintRuler();
  }

  private clearRuler(): void {
    if (this.rulerId) this.chart.removeOverlay({ id: this.rulerId });
    this.rulerId = null;
    this.paintRuler();
  }

  private rulerFinished(): boolean {
    const o = this.rulerId ? this.chart.getOverlays({ id: this.rulerId })[0] : null;
    return !!o && o.currentStep === FINISHED;
  }

  private paintRuler(): void {
    this.rulerBtn?.classList.toggle('active', !!this.rulerId && !this.rulerFinished());
  }

  private onChartMouseDown(e: MouseEvent): void {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement | null;
    if (!target || target.closest('.style-bar, .to-realtime, .scale-corner, #bottombar')) return;
    if (this.rulerId && this.rulerFinished()) {
      this.clearRuler();
      if (!e.shiftKey) return;
    }
    if (e.shiftKey && modifierKeys().shift && !this.drawingId && !this.rulerId && target.tagName === 'CANVAS') this.startRuler();
  }

  private initialExtendData(tool: ToolDef): unknown {
    if (tool.settings === 'fib-retracement') return load<FibSettings | null>('fibDefaults.retracement', null) ?? defaultFibSettings('retracement');
    if (tool.settings === 'fib-extension') return load<FibSettings | null>('fibDefaults.extension', null) ?? defaultFibSettings('extension');
    const remembered = load<Record<string, unknown> | null>(`toolData.${tool.name}`, null);
    if (tool.name === 'gtZone') return { extendRight: true, text: '', ...remembered } satisfies RectData;
    return remembered ?? undefined;
  }

  /** Çizimin diğer çizimlere aktarılabilecek seçenekleri (metin/etiket hariç). */
  private sharedData(o: Overlay<unknown>): Record<string, unknown> | null {
    const d = o.extendData;
    if (!d || typeof d !== 'object') return null;
    const { text: _text, size: _size, ...rest } = d as Record<string, unknown>;
    return Object.keys(rest).length > 0 ? rest : null;
  }

  /** Bu çizimin stilini ve seçeneklerini aynı türdeki tüm çizimlere uygular (açık grafik + kayıtlı tüm semboller). */
  private applyToAll(id: string): void {
    const o = this.chart.getOverlays({ id })[0];
    if (!o) return;
    const styles = o.styles ? structuredClone(o.styles) : null;
    const shared = this.sharedData(o);
    const merge = (prev: unknown) => (shared ? { ...(prev && typeof prev === 'object' ? prev : {}), ...structuredClone(shared) } : prev);
    let count = 0;
    for (const ov of this.chart.getOverlays({ groupId: GROUP })) {
      if (ov.name !== o.name || ov.id === o.id) continue;
      if (styles) this.chart.overrideOverlay({ id: ov.id, styles });
      if (shared) {
        const next = merge(ov.extendData);
        this.chart.overrideOverlay({ id: ov.id, extendData: null });
        this.chart.overrideOverlay({ id: ov.id, extendData: next });
      }
      count++;
    }
    for (const key of keys('drawings.')) {
      if (key === `drawings.${this.symbolId}`) continue;
      const list = load<SavedDrawing[]>(key, []);
      if (!Array.isArray(list)) continue;
      let changed = false;
      for (const d of list) {
        if (d.name !== o.name) continue;
        if (styles) d.styles = structuredClone(styles);
        if (shared) d.extendData = merge(d.extendData);
        changed = true;
        count++;
      }
      if (changed) save(key, list);
    }
    this.rememberTool(o);
    this.persist();
    toast('Uygulandı', count > 0 ? `${count} çizim bu ayarlara getirildi.` : 'Bu türde başka çizim yok; ayar yeni çizimler için kaydedildi.');
  }

  /** Aracın stilini ve seçeneklerini sonraki çizimler için hatırlar. */
  private rememberTool(o: Overlay<unknown>): void {
    const l = o.styles?.line;
    if (l && typeof l.color === 'string') {
      save(`toolStyle.${o.name}`, { color: l.color, width: typeof l.size === 'number' ? l.size : defaultWidth(o.name), dash: dashOf(o) } satisfies ToolStyle);
    }
    const shared = this.sharedData(o);
    const settings = findTool(o.name)?.settings;
    if (settings) save(`fibDefaults.${settings === 'fib-retracement' ? 'retracement' : 'extension'}`, o.extendData);
    else if (shared) save(`toolData.${o.name}`, shared);
  }

  async startTool(tool: ToolDef): Promise<void> {
    if (this.prefs.locked) {
      this.prefs.locked = false;
      this.chart.overrideOverlay({ groupId: GROUP, lock: false });
      this.savePrefs();
    }
    if (this.prefs.hidden) {
      this.prefs.hidden = false;
      this.applyVisibility();
      this.savePrefs();
    }
    if (this.prefs.cursor === 'eraser') this.setCursor('cross');
    this.cancelDrawing();
    this.clearRuler();

    let extendData = this.initialExtendData(tool);
    if (tool.input === 'text') {
      const t = await promptDialog('Metin ekle', 'Metni yazın, sonra grafikte yerini tıklayın');
      if (!t) return;
      extendData = { text: t, size: 16 };
    } else if (tool.input === 'note') {
      const t = await promptDialog('Not ekle', 'Notu yazın, sonra grafikte işaret edeceği yeri tıklayın');
      if (!t) return;
      extendData = t;
    } else if (tool.input === 'emoji') {
      const e = await this.pickEmoji();
      if (!e) return;
      extendData = { text: e, size: 30 };
    }

    const id = this.chart.createOverlay({
      name: tool.name,
      groupId: GROUP,
      mode: this.mode(),
      visible: true,
      extendData,
      styles: this.toolStyle(tool.name),
      ...this.callbacks(),
    });
    if (typeof id === 'string') {
      this.drawingId = id;
      this.drawingTool = tool;
      this.paintAllGroups();
    }
  }

  private pickEmoji(): Promise<string | null> {
    return new Promise((resolve) => {
      let result: string | null = null;
      const grid = h('div', { class: 'emoji-grid' });
      const m = modal('Simge seç', grid, { small: true, onClose: () => resolve(result) });
      for (const e of EMOJIS) {
        grid.append(
          h('button', {
            class: 'emoji-btn',
            text: e,
            'aria-label': e,
            onclick: () => {
              result = e;
              m.close();
            },
          }),
        );
      }
    });
  }

  /** Yarım kalan çizimi iptal eder (Esc). */
  cancelDrawing(): void {
    const id = this.drawingId;
    this.drawingId = null;
    this.drawingTool = null;
    this.paintAllGroups();
    if (!id) return;
    const ov = this.chart.getOverlays({ id })[0];
    if (ov && ov.currentStep !== FINISHED) this.chart.removeOverlay({ id });
  }

  // ---------- Klavye ----------

  private onKey(e: KeyboardEvent): void {
    if (isTyping(e) || isModalOpen()) return;
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && !e.shiftKey && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      this.undo();
    } else if (ctrl && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) {
      e.preventDefault();
      this.redo();
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && this.selectedId) {
      e.preventDefault();
      this.chart.removeOverlay({ id: this.selectedId });
    } else if (e.key === 'Escape') {
      this.cancelDrawing();
      this.clearRuler();
    } else if (e.altKey && !ctrl && e.code.startsWith('Key')) {
      const key = e.code.slice(3);
      for (const g of TOOL_GROUPS) {
        const t = g.tools.find((x) => x.hotkey === key);
        if (t) {
          e.preventDefault();
          this.prefs.groupTool[g.id] = t.name;
          this.savePrefs();
          void this.startTool(t);
          return;
        }
      }
    }
  }

  // ---------- Seçili çizim çubuğu ----------

  private select(id: string | null): void {
    this.selectedId = id;
    this.renderStyleBar();
  }

  private selected(): Overlay<unknown> | null {
    if (!this.selectedId) return null;
    return this.chart.getOverlays({ id: this.selectedId })[0] ?? null;
  }

  private renderStyleBar(): void {
    const o = this.selected();
    clear(this.styleBar);
    if (!o || o.groupId !== GROUP) {
      this.styleBar.hidden = true;
      return;
    }
    const tool = findTool(o.name);
    const color = typeof o.styles?.line?.color === 'string' ? o.styles.line.color : cssVar('--accent');
    const width = typeof o.styles?.line?.size === 'number' ? o.styles.line.size : defaultWidth(o.name);
    const dash = dashOf(o);

    const btn = (html: string, title: string, onClick: (b: HTMLButtonElement) => void, active = false) => {
      const b = h('button', { class: `sb-btn${active ? ' active' : ''}`, title, 'aria-label': title, html });
      b.addEventListener('click', () => onClick(b));
      return b;
    };

    this.styleBar.append(h('span', { class: 'sb-title', text: tool?.title ?? o.name }));
    if (!tool?.fixedColors) {
      this.styleBar.append(
        btn(`<span class="sb-swatch" style="background:${color}"></span>`, 'Renk', (b) => this.openPalette(b, o.id, color)),
      );
    }
    this.styleBar.append(
      btn(`<span class="sb-width"><i style="height:${width}px"></i></span><small>${width}px</small>`, 'Kalınlık', (b) => this.openWidthMenu(b, o.id)),
      btn(`<span class="sb-dash sb-dash-${dash}"></span>`, 'Çizgi stili', (b) => this.openDashMenu(b, o.id)),
    );
    if (tool?.settings) this.styleBar.append(btn(ICONS.gear, 'Ayarlar (seviyeler, log, uzatma)', () => this.openSettings(o.id)));
    if (tool?.input === 'text' || tool?.input === 'note' || tool?.input === 'zone' || tool?.input === 'emoji' || o.name === 'gtRect') {
      this.styleBar.append(btn(ICONS.edit, tool?.input === 'emoji' ? 'Simgeyi değiştir' : 'Metni / etiketi düzenle', () => void this.editText(o.id)));
    }
    if (o.name === 'gtRect' || o.name === 'gtZone') {
      const d = (o.extendData ?? {}) as RectData;
      const on = d.extendRight ?? o.name === 'gtZone';
      this.styleBar.append(
        btn(ICONS.extend, on ? 'Sağa uzatmayı kapat' : 'Sağa uzat', () => this.updateExtendData(o.id, { ...d, extendRight: !on }, true), on),
      );
    }
    if (o.name === 'gtParallelChannel') {
      const d = (o.extendData ?? {}) as ChannelData;
      const toggle = (key: keyof ChannelData, def: boolean) => () => this.updateExtendData(o.id, { ...d, [key]: !(d[key] ?? def) }, true);
      this.styleBar.append(
        btn(ICONS.middle, d.middle === false ? 'Orta çizgiyi göster' : 'Orta çizgiyi gizle', toggle('middle', true), d.middle !== false),
        btn(ICONS.fill, d.background === false ? 'Dolguyu göster' : 'Dolguyu gizle', toggle('background', true), d.background !== false),
        btn(ICONS.extendLeft, d.extendLeft ? 'Sola uzatmayı kapat' : 'Sola uzat', toggle('extendLeft', false), !!d.extendLeft),
        btn(ICONS.extend, d.extendRight ? 'Sağa uzatmayı kapat' : 'Sağa uzat', toggle('extendRight', false), !!d.extendRight),
      );
    }
    this.styleBar.append(
      h('span', { class: 'sb-sep' }),
      btn(ICONS.applyAll, `Bu ayarları tüm "${tool?.title ?? o.name}" çizimlerine uygula (tüm semboller)`, () => this.applyToAll(o.id)),
      btn(ICONS.clone, 'Kopyala', () => this.cloneOverlay(o.id)),
      btn(ICONS.lock, o.lock ? 'Kilidi aç' : 'Kilitle', () => {
        this.chart.overrideOverlay({ id: o.id, lock: !o.lock });
        this.persist();
        this.renderStyleBar();
      }, o.lock),
      btn(ICONS.trash, 'Sil (Delete)', () => this.chart.removeOverlay({ id: o.id })),
    );
    this.styleBar.hidden = false;
  }

  private applyStyle(id: string, patch: { color?: string; width?: number; dash?: Dash }): void {
    const o = this.chart.getOverlays({ id })[0];
    if (!o) return;
    const color = patch.color ?? (typeof o.styles?.line?.color === 'string' ? o.styles.line.color : cssVar('--accent'));
    const width = patch.width ?? (typeof o.styles?.line?.size === 'number' ? o.styles.line.size : defaultWidth(o.name));
    const dash = patch.dash ?? dashOf(o);
    this.chart.overrideOverlay({ id, styles: styleFor(color, width, dash) });
    // TradingView gibi: bu araçla çizilen sonraki çizimler aynı stille başlar.
    const updated = this.chart.getOverlays({ id })[0];
    if (updated) this.rememberTool(updated);
    this.persist();
    this.renderStyleBar();
  }

  private toolStyle(name: string): OverlayCreate['styles'] | undefined {
    const st = load<ToolStyle | null>(`toolStyle.${name}`, null);
    if (!st || typeof st.color !== 'string') return undefined;
    return styleFor(st.color, Number(st.width) || defaultWidth(name), st.dash === 'dashed' || st.dash === 'dotted' ? st.dash : 'solid');
  }

  private openPalette(anchor: HTMLElement, id: string, current: string): void {
    let close = () => {};
    const grid = h('div', { class: 'palette' });
    for (const c of PALETTE) {
      grid.append(
        h('button', {
          class: `swatch${c.toLowerCase() === current.toLowerCase() ? ' on' : ''}`,
          style: `background:${c}`,
          title: c,
          'aria-label': c,
          onclick: () => {
            close();
            this.applyStyle(id, { color: c });
          },
        }),
      );
    }
    const custom = h('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(current) ? current : '#d97757', 'aria-label': 'Özel renk' });
    custom.addEventListener('change', () => {
      close();
      this.applyStyle(id, { color: custom.value });
    });
    close = popover(anchor, h('div', null, grid, h('label', { class: 'palette-custom' }, 'Özel renk ', custom)), 'palette-pop');
  }

  private openWidthMenu(anchor: HTMLElement, id: string): void {
    let close = () => {};
    const box = h('div');
    for (const w of [1, 2, 3, 4, 5]) {
      box.append(
        this.menuRow(`<span class="sb-width"><i style="height:${w}px"></i></span>`, `${w} piksel`, '', false, () => {
          close();
          this.applyStyle(id, { width: w });
        }),
      );
    }
    close = popover(anchor, box, 'tool-menu');
  }

  private openDashMenu(anchor: HTMLElement, id: string): void {
    let close = () => {};
    const box = h('div');
    const opts: { d: Dash; t: string }[] = [
      { d: 'solid', t: 'Düz' },
      { d: 'dashed', t: 'Kesikli' },
      { d: 'dotted', t: 'Noktalı' },
    ];
    for (const o of opts) {
      box.append(
        this.menuRow(`<span class="sb-dash sb-dash-${o.d}"></span>`, o.t, '', false, () => {
          close();
          this.applyStyle(id, { dash: o.d });
        }),
      );
    }
    close = popover(anchor, box, 'tool-menu');
  }

  /** extendData'yı tamamen değiştirir (dizilerin indeks indeks birleşmesini önlemek için önce sıfırlar). */
  private updateExtendData(id: string, data: unknown, remember = false): void {
    this.chart.overrideOverlay({ id, extendData: null });
    this.chart.overrideOverlay({ id, extendData: data });
    if (remember) {
      const o = this.chart.getOverlays({ id })[0];
      if (o) this.rememberTool(o);
    }
    this.persist();
    this.renderStyleBar();
  }

  private async editText(id: string): Promise<void> {
    const o = this.chart.getOverlays({ id })[0];
    if (!o) return;
    if (o.name === 'gtEmoji') {
      const e = await this.pickEmoji();
      if (e) this.updateExtendData(id, { ...(o.extendData as object), text: e });
      return;
    }
    if (o.name === 'simpleAnnotation') {
      const t = await promptDialog('Notu düzenle', 'Not', String(o.extendData ?? ''));
      if (t) this.updateExtendData(id, t);
      return;
    }
    const d = (o.extendData ?? {}) as { text?: string };
    const label = o.name === 'gtZone' || o.name === 'gtRect' ? 'Bölge etiketi (ör. Talep, Arz, OB)' : 'Metin';
    const t = await promptDialog('Düzenle', label, d.text ?? '');
    if (t !== null) this.updateExtendData(id, { ...d, text: t });
  }

  private cloneOverlay(id: string): void {
    const o = this.chart.getOverlays({ id })[0];
    if (!o) return;
    this.chart.createOverlay({
      name: o.name,
      groupId: GROUP,
      points: o.points.map((p) => ({ timestamp: p.timestamp, value: p.value })),
      extendData: o.extendData === undefined ? undefined : JSON.parse(JSON.stringify(o.extendData)),
      styles: o.styles ?? undefined,
      mode: this.mode(),
      ...this.callbacks(),
    });
    this.persist();
  }

  // ---------- Fibonacci ayarları ----------

  private openSettings(id: string): void {
    const o = this.chart.getOverlays({ id })[0];
    if (!o) return;
    const tool = findTool(o.name);
    if (tool?.settings === 'fib-retracement' || tool?.settings === 'fib-extension') {
      this.openFibSettings(o, tool.settings === 'fib-retracement' ? 'retracement' : 'extension');
    } else if (tool?.input) {
      void this.editText(id);
    }
  }

  private openFibSettings(
    o: Overlay<unknown>,
    kind: 'retracement' | 'extension',
    initial?: FibSettings,
    originalArg?: FibSettings,
  ): void {
    const original = originalArg ?? normalizeFibSettings(o.extendData, kind);
    let s: FibSettings = structuredClone(initial ?? original);
    let committed = false;
    const apply = () => {
      this.chart.overrideOverlay({ id: o.id, extendData: null });
      this.chart.overrideOverlay({ id: o.id, extendData: structuredClone(s) });
    };
    if (initial) apply();

    const levelsBox = h('div', { class: 'fib-levels' });
    const renderLevels = () => {
      clear(levelsBox);
      s.levels
        .map((l, i) => ({ l, i }))
        .sort((a, b) => a.l.value - b.l.value)
        .forEach(({ l, i }) => {
          const show = h('input', { type: 'checkbox', checked: l.show, 'aria-label': `${l.value} seviyesini göster` });
          const val = h('input', { type: 'number', step: '0.001', value: String(l.value), 'aria-label': 'Seviye değeri' });
          const col = h('input', { type: 'color', value: l.color, 'aria-label': 'Seviye rengi' });
          const del = h('button', { class: 'icon-btn', text: '×', title: 'Seviyeyi sil', 'aria-label': 'Seviyeyi sil' });
          show.addEventListener('change', () => {
            s.levels[i].show = show.checked;
            apply();
          });
          val.addEventListener('change', () => {
            const v = Number(val.value);
            if (Number.isFinite(v)) {
              s.levels[i].value = v;
              apply();
            }
          });
          col.addEventListener('input', () => {
            s.levels[i].color = col.value;
            apply();
          });
          del.addEventListener('click', () => {
            s.levels.splice(i, 1);
            apply();
            renderLevels();
          });
          levelsBox.append(h('div', { class: 'fib-level' }, show, val, col, del));
        });
    };

    const check = (label: string, key: keyof FibSettings) => {
      const input = h('input', { type: 'checkbox', checked: Boolean(s[key]) });
      input.addEventListener('change', () => {
        (s as unknown as Record<string, unknown>)[key] = input.checked;
        apply();
      });
      return h('label', { class: 'check' }, input, label);
    };

    const side = h('select', { 'aria-label': 'Etiket konumu' }, h('option', { value: 'left', text: 'Solda' }), h('option', { value: 'right', text: 'Sağda' }));
    side.value = s.labelSide;
    side.addEventListener('change', () => {
      s.labelSide = side.value === 'right' ? 'right' : 'left';
      apply();
    });
    const opacity = h('input', { type: 'range', min: '0', max: '0.4', step: '0.02', value: String(s.backgroundOpacity), 'aria-label': 'Arka plan saydamlığı' });
    opacity.addEventListener('input', () => {
      s.backgroundOpacity = Number(opacity.value);
      apply();
    });

    const addLevel = h('button', { class: 'btn', text: '+ Seviye ekle', type: 'button' });
    addLevel.addEventListener('click', () => {
      const max = Math.max(0, ...s.levels.map((l) => l.value));
      s.levels.push({ value: Number((max + 0.5).toFixed(3)), color: '#5ba4c9', show: true });
      apply();
      renderLevels();
    });
    const reset = h('button', { class: 'btn', text: 'Varsayılana dön', type: 'button' });
    reset.addEventListener('click', () => {
      // Pencereyi fabrika ayarlarıyla yeniden aç; İptal yine ilk hâline döndürür.
      committed = true;
      m.close();
      this.openFibSettings(o, kind, defaultFibSettings(kind), original);
    });
    const applyAll = h('input', { type: 'checkbox', checked: true });
    const applyAllLabel = h('label', { class: 'check' }, applyAll, 'Tüm sembollerdeki diğer Fibonacci çizimlerine de uygula');
    const ok = h('button', { class: 'btn primary', text: 'Tamam', type: 'button' });
    const cancel = h('button', { class: 'btn', text: 'İptal', type: 'button' });

    const body = h(
      'div',
      { class: 'fib-settings' },
      h(
        'div',
        { class: 'fib-cols' },
        h('div', null, h('div', { class: 'section-title', text: 'Seviyeler' }), levelsBox, addLevel),
        h(
          'div',
          { class: 'fib-opts' },
          h('div', { class: 'section-title', text: 'Seçenekler' }),
          check('Logaritmik ölçeğe göre seviyeler', 'log'),
          check('Ters çevir (0 ↔ 1)', 'reverse'),
          check('Sola uzat', 'extendLeft'),
          check('Sağa uzat', 'extendRight'),
          check('Fiyatları göster', 'showPrices'),
          check('Seviyeleri göster', 'showLevels'),
          check('Seviyeleri yüzde olarak yaz', 'levelsAsPercent'),
          check('Trend çizgisi', 'trendLine'),
          check('Arka plan', 'background'),
          h('label', { class: 'field-inline' }, 'Saydamlık', opacity),
          h('label', { class: 'field-inline' }, 'Etiketler', side),
        ),
      ),
      h('p', { class: 'fib-note', text: 'Tamam dediğinde bu ayarlar kaydedilir; bundan sonra çizdiğin her Fibonacci bu ayarlarla başlar.' }),
      applyAllLabel,
      h('div', { class: 'modal-actions spread' }, h('div', null, reset), h('div', null, cancel, ok)),
    );

    const m = modal(kind === 'retracement' ? 'Fibonacci düzeltmesi — ayarlar' : 'Fibonacci uzantısı — ayarlar', body, {
      onClose: () => {
        if (!committed) {
          s = original;
          apply();
        }
      },
    });
    ok.addEventListener('click', () => {
      committed = true;
      save(`fibDefaults.${kind}`, s);
      if (applyAll.checked) this.applyFibEverywhere(o.name, s);
      this.persist();
      m.close();
    });
    cancel.addEventListener('click', () => m.close());
    renderLevels();
  }

  /** Aynı türdeki tüm Fibonacci çizimlerine (açık grafik + kayıtlı tüm semboller) ayarları uygular. */
  private applyFibEverywhere(name: string, settings: FibSettings): void {
    for (const ov of this.chart.getOverlays({ groupId: GROUP })) {
      if (ov.name !== name) continue;
      this.chart.overrideOverlay({ id: ov.id, extendData: null });
      this.chart.overrideOverlay({ id: ov.id, extendData: structuredClone(settings) });
    }
    for (const key of keys('drawings.')) {
      if (key === `drawings.${this.symbolId}`) continue;
      const list = load<SavedDrawing[]>(key, []);
      if (!Array.isArray(list)) continue;
      let changed = false;
      for (const d of list) {
        if (d.name === name) {
          d.extendData = structuredClone(settings);
          changed = true;
        }
      }
      if (changed) save(key, list);
    }
  }

  // ---------- Kayıt, geri al / yinele ----------

  private snapshot(excludeId?: string): SavedDrawing[] {
    return this.chart
      .getOverlays({ groupId: GROUP })
      .filter((o) => o.id !== excludeId && o.currentStep === FINISHED)
      .map((o) => ({
        name: o.name,
        points: o.points.map((p) => ({ timestamp: p.timestamp, value: p.value })),
        extendData: o.extendData ?? undefined,
        styles: o.styles ?? undefined,
        lock: o.lock || undefined,
        hidden: this.itemHidden.has(o.id) || undefined,
      }));
  }

  private persist(excludeId?: string): void {
    if (this.suspended || !this.symbolId) return;
    const list = this.snapshot(excludeId);
    const json = JSON.stringify(list);
    if (json !== this.lastSnapshot) {
      this.undoStack.push(this.lastSnapshot);
      if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
      this.redoStack = [];
      this.lastSnapshot = json;
      this.emitHistory();
    }
    if (list.length > 0) save(`drawings.${this.symbolId}`, list);
    else remove(`drawings.${this.symbolId}`);
    if (this.selectedId) this.renderStyleBar();
    this.onListChange();
  }

  private emitHistory(): void {
    this.onHistoryChange(this.undoStack.length > 0, this.redoStack.length > 0);
  }

  private restore(list: SavedDrawing[]): void {
    this.suspended = true;
    this.chart.removeOverlay({ groupId: GROUP });
    this.itemHidden.clear();
    for (const d of list) {
      const id = this.chart.createOverlay({
        name: d.name,
        groupId: GROUP,
        // Eski sürümde yatay ışın 2 tıkla çiziliyordu (ikinci tık yönü belirliyordu); artık tek nokta, hep sağa.
        points: d.name === 'horizontalRayLine' ? d.points.slice(0, 1) : d.points,
        extendData: d.extendData,
        styles: (d.styles ?? undefined) as OverlayCreate['styles'],
        lock: this.prefs.locked || !!d.lock,
        visible: !this.prefs.hidden && !d.hidden,
        mode: this.mode(),
        ...this.callbacks(),
      });
      if (d.hidden && typeof id === 'string') this.itemHidden.add(id);
    }
    this.suspended = false;
    this.select(null);
    this.onListChange();
  }

  /** Genel gizle/göster ayarını ve tek tek gizlenenleri uygular. */
  private applyVisibility(): void {
    this.chart.overrideOverlay({ groupId: GROUP, visible: !this.prefs.hidden });
    if (!this.prefs.hidden) for (const id of this.itemHidden) this.chart.overrideOverlay({ id, visible: false });
  }

  // ---------- Sağ tık menüsü ve nesne ağacı ----------

  /** Grafiğin kendi sağ tık menüsü, aynı tıklamada çizim menüsü açıldıysa açılmasın. */
  overlayMenuRecently(): boolean {
    return Date.now() - this.lastOverlayMenu < 300;
  }

  private openOverlayMenu(id: string, x: number, y: number): void {
    const o = this.chart.getOverlays({ id })[0];
    if (!o) return;
    const tool = findTool(o.name);
    let close = () => {};
    const items = [
      tool?.settings || tool?.input || o.name === 'gtRect'
        ? { label: 'Ayarlar…', icon: ICONS.gear, onClick: () => this.openSettings(id) }
        : null,
      { label: 'Klonla', icon: ICONS.clone, onClick: () => this.cloneOverlay(id) },
      { label: o.lock ? 'Kilidi aç' : 'Kilitle', icon: ICONS.lock, onClick: () => this.toggleItemLock(id) },
      { label: 'Gizle', icon: ICONS.eye, onClick: () => this.toggleItemHidden(id) },
      { label: `Ayarları tüm "${tool?.title ?? o.name}" çizimlerine uygula`, icon: ICONS.applyAll, onClick: () => this.applyToAll(id) },
      null,
      { label: 'Kaldır', icon: ICONS.trash, hint: 'Delete', danger: true, onClick: () => this.chart.removeOverlay({ id }) },
    ].filter((x, i) => x !== null || i === 5);
    close = menuAt(x, y, menuList(items, () => close(), tool?.title ?? o.name));
  }

  listDrawings(): DrawingItem[] {
    return this.chart
      .getOverlays({ groupId: GROUP })
      .filter((o) => o.currentStep === FINISHED)
      .map((o) => {
        const tool = findTool(o.name);
        const v = o.points.map((p) => p.value).filter((x): x is number => typeof x === 'number');
        const info =
          v.length === 1 ? this.formatPrice(v[0]) : v.length >= 2 ? `${this.formatPrice(v[0])} → ${this.formatPrice(v[v.length - 1])}` : '';
        return {
          id: o.id,
          title: tool?.title ?? o.name,
          icon: tool?.icon ?? ICONS.edit,
          hidden: this.itemHidden.has(o.id),
          locked: o.lock,
          info,
        };
      });
  }

  toggleItemHidden(id: string): void {
    if (this.itemHidden.has(id)) {
      this.itemHidden.delete(id);
      this.chart.overrideOverlay({ id, visible: !this.prefs.hidden });
    } else {
      this.itemHidden.add(id);
      this.chart.overrideOverlay({ id, visible: false });
      if (this.selectedId === id) this.select(null);
    }
    this.persist();
  }

  toggleItemLock(id: string): void {
    const o = this.chart.getOverlays({ id })[0];
    if (!o) return;
    this.chart.overrideOverlay({ id, lock: !o.lock });
    this.persist();
    if (this.selectedId === id) this.renderStyleBar();
  }

  removeItem(id: string): void {
    this.chart.removeOverlay({ id });
  }

  /** Çizimin olduğu yere kaydırır. */
  focusItem(id: string): void {
    const ts = this.chart.getOverlays({ id })[0]?.points.find((p) => typeof p.timestamp === 'number')?.timestamp;
    if (typeof ts === 'number') this.chart.scrollToTimestamp(ts, 300);
  }

  /** Grafikteki sağ tık menüsünden: bu fiyata yatay çizgi. */
  addHorizontalLine(price: number, timestamp: number): void {
    this.chart.createOverlay({
      name: 'horizontalStraightLine',
      groupId: GROUP,
      points: [{ timestamp, value: price }],
      styles: this.toolStyle('horizontalStraightLine'),
      mode: this.mode(),
      ...this.callbacks(),
    });
    this.persist();
  }

  undo(): void {
    const prev = this.undoStack.pop();
    if (prev === undefined || !this.symbolId) return;
    this.redoStack.push(this.lastSnapshot);
    this.lastSnapshot = prev;
    this.restore(JSON.parse(prev) as SavedDrawing[]);
    save(`drawings.${this.symbolId}`, JSON.parse(prev));
    this.emitHistory();
  }

  redo(): void {
    const next = this.redoStack.pop();
    if (next === undefined || !this.symbolId) return;
    this.undoStack.push(this.lastSnapshot);
    this.lastSnapshot = next;
    this.restore(JSON.parse(next) as SavedDrawing[]);
    save(`drawings.${this.symbolId}`, JSON.parse(next));
    this.emitHistory();
  }

  /** Sembol değişince önceki çizimleri kaldırıp yenisinin kayıtlı çizimlerini yükler. */
  switchSymbol(symbolId: string): void {
    if (this.symbolId === symbolId) return;
    this.cancelDrawing();
    this.symbolId = symbolId;
    const saved = load<SavedDrawing[]>(`drawings.${symbolId}`, []);
    this.restore(saved);
    this.lastSnapshot = JSON.stringify(this.snapshot());
    this.undoStack = [];
    this.redoStack = [];
    this.emitHistory();
  }

  drawingCount(): number {
    return this.chart.getOverlays({ groupId: GROUP }).filter((o) => o.currentStep === FINISHED).length;
  }

  /** TradingView'daki çöp kutusu menüsü: çizimleri, göstergeleri ya da ikisini birden kaldır. */
  private openTrashMenu(): void {
    let close = () => {};
    const nd = this.drawingCount();
    const ni = this.indicatorOps.count();
    const row = (icon: string, label: string, count: number, onClick: () => void) => {
      const b = h(
        'button',
        { class: 'menu-row', disabled: count === 0 },
        h('span', { class: 'menu-icon', html: icon }),
        h('span', { class: 'menu-label', text: label }),
        h('span', { class: 'menu-count', text: String(count) }),
      );
      b.addEventListener('click', () => {
        close();
        onClick();
      });
      return b;
    };
    const box = h(
      'div',
      null,
      h('div', { class: 'menu-title', text: 'Kaldır' }),
      row(ICONS.trashLines, 'Çizimleri kaldır', nd, () => this.removeDrawings()),
      row(ICONS.trashFx, 'Göstergeleri kaldır', ni, () => this.removeIndicators()),
      row(ICONS.trash, 'Çizimleri ve göstergeleri kaldır', nd + ni, () => this.removeEverything()),
      h('div', { class: 'menu-foot', text: 'Yalnızca açık sembol için geçerli. Silinenler bildirimdeki "Geri al" ile geri gelir (çizimler Ctrl+Z ile de).' }),
    );
    close = popover(this.trashBtn, box, 'tool-menu', 'right');
  }

  /** Açık sembolün tüm çizimlerini kaldırır (geri al yığınına eklenir). Kaldırılan sayıyı döndürür. */
  private clearDrawings(): number {
    const count = this.drawingCount();
    this.cancelDrawing();
    if (count === 0) return 0;
    this.suspended = true;
    this.chart.removeOverlay({ groupId: GROUP });
    this.suspended = false;
    this.select(null);
    this.paintAllGroups();
    this.persist();
    return count;
  }

  removeDrawings(): void {
    const n = this.clearDrawings();
    if (n > 0) toast('Çizimler kaldırıldı', `${n} çizim kaldırıldı.`, 'info', 8000, { label: 'Geri al', onClick: () => this.undo() });
  }

  removeIndicators(): void {
    const n = this.indicatorOps.count();
    if (n === 0) return;
    const restore = this.indicatorOps.removeAll();
    toast('Göstergeler kaldırıldı', `${n} gösterge kaldırıldı.`, 'info', 8000, { label: 'Geri al', onClick: restore });
  }

  private removeEverything(): void {
    const ni = this.indicatorOps.count();
    const restore = ni > 0 ? this.indicatorOps.removeAll() : null;
    const nd = this.clearDrawings();
    if (nd + ni === 0) return;
    toast('Kaldırıldı', `${nd} çizim ve ${ni} gösterge kaldırıldı.`, 'info', 8000, {
      label: 'Geri al',
      onClick: () => {
        if (nd > 0) this.undo();
        restore?.();
      },
    });
  }
}
