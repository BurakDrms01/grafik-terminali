// Bar replay (TradingView'daki "Tekrar oynat"): geçmişte bir mum seç, grafik oradan itibaren mum mum ilerlesin.
import type { Chart, Crosshair } from 'klinecharts';
import type { ChartFeed } from '../data/feed.ts';
import { h, isModalOpen, isTyping, toast } from '../ui/dom.ts';

const SPEEDS: { label: string; ms: number }[] = [
  { label: '0,5×', ms: 2000 },
  { label: '1×', ms: 1000 },
  { label: '2×', ms: 500 },
  { label: '3×', ms: 333 },
  { label: '5×', ms: 200 },
  { label: '10×', ms: 100 },
];

const svg = (body: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

const ICONS = {
  pick: svg('<path d="M12 3v18"/><path d="M8 7l-4 5 4 5M16 7l4 5-4 5"/>'),
  play: svg('<path d="M7 5l12 7-12 7z" fill="currentColor"/>'),
  pause: svg('<path d="M8 5v14M16 5v14" stroke-width="3"/>'),
  step: svg('<path d="M5 5l10 7-10 7z" fill="currentColor"/><path d="M19 5v14" stroke-width="2.4"/>'),
  exit: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
};

export interface ReplayDeps {
  chart: Chart;
  feed: ChartFeed;
  chartWrap: HTMLElement;
  chartEl: HTMLElement;
  button: HTMLButtonElement;
}

export class Replay {
  private selecting = false;
  private active = false;
  private timer: ReturnType<typeof setInterval> | undefined;
  private speed = 1;
  private cross: Crosshair | null = null;
  private readonly guide: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly playBtn: HTMLButtonElement;
  private readonly speedSel: HTMLSelectElement;
  private readonly posLabel: HTMLElement;

  constructor(private readonly deps: ReplayDeps) {
    const { chart, chartWrap, chartEl, button } = deps;
    this.guide = h('div', { class: 'replay-guide', hidden: true, 'aria-hidden': 'true' });
    this.hint = h('div', { class: 'replay-hint', hidden: true, text: 'Tekrar oynatmanın başlayacağı mumu tıklayın · Esc: vazgeç' });

    const btn = (icon: string, title: string, onClick: () => void) => {
      const b = h('button', { class: 'rp-btn', type: 'button', title, 'aria-label': title, html: icon });
      b.addEventListener('click', onClick);
      return b;
    };
    this.playBtn = btn(ICONS.play, 'Oynat (Shift+↓)', () => this.togglePlay());
    this.speedSel = h('select', { class: 'rp-speed', 'aria-label': 'Hız' });
    SPEEDS.forEach((s, i) => this.speedSel.append(h('option', { value: String(i), text: s.label })));
    this.speedSel.value = String(this.speed);
    this.speedSel.addEventListener('change', () => {
      this.speed = Number(this.speedSel.value);
      if (this.timer) this.play();
    });
    this.posLabel = h('span', { class: 'rp-pos' });
    this.bar = h(
      'div',
      { class: 'replay-bar', hidden: true, role: 'toolbar', 'aria-label': 'Tekrar oynatma' },
      h('span', { class: 'rp-title', text: 'Tekrar oynat' }),
      btn(ICONS.pick, 'Başka bir başlangıç mumu seç', () => this.beginSelect()),
      this.playBtn,
      btn(ICONS.step, 'Bir mum ileri (Shift+→)', () => this.step()),
      this.speedSel,
      this.posLabel,
      btn(ICONS.exit, 'Tekrar oynatmadan çık, canlı grafiğe dön', () => this.exit()),
    );
    chartWrap.append(this.guide, this.hint, this.bar);

    button.addEventListener('click', () => {
      if (this.selecting) this.cancelSelect();
      else if (this.active) this.exit();
      else this.beginSelect();
    });

    chart.subscribeAction('onCrosshairChange', (c) => {
      this.cross = (c as Crosshair) ?? null;
    });
    chartEl.addEventListener('mousemove', (e) => {
      if (!this.selecting) return;
      const r = chartWrap.getBoundingClientRect();
      this.guide.style.left = `${e.clientX - r.left}px`;
      this.guide.hidden = false;
    });
    chartEl.addEventListener('mouseleave', () => {
      this.guide.hidden = true;
    });
    // Seçim modunda tıklama grafiğe gitmesin, başlangıç mumu seçilsin.
    chartEl.addEventListener(
      'click',
      (e) => {
        if (!this.selecting) return;
        e.stopPropagation();
        e.preventDefault();
        this.pick();
      },
      true,
    );
    document.addEventListener('keydown', (e) => {
      if (isTyping(e) || isModalOpen()) return;
      if (this.selecting && e.key === 'Escape') {
        this.cancelSelect();
      } else if (this.active && e.shiftKey && e.key === 'ArrowRight') {
        e.preventDefault();
        this.step();
      } else if (this.active && e.shiftKey && e.key === 'ArrowDown') {
        e.preventDefault();
        this.togglePlay();
      }
    });
  }

  get isOn(): boolean {
    return this.active || this.selecting;
  }

  private paintButton(): void {
    const on = this.isOn;
    this.deps.button.classList.toggle('active', on);
    this.deps.button.setAttribute('aria-pressed', String(on));
  }

  private beginSelect(): void {
    if (this.deps.feed.currentBars().length < 3 && !this.active) {
      toast('Tekrar oynatılamıyor', 'Önce grafiğin yüklenmesini bekleyin.');
      return;
    }
    this.pause();
    this.selecting = true;
    this.hint.hidden = false;
    this.deps.chartWrap.classList.add('replay-selecting');
    this.paintButton();
  }

  private cancelSelect(): void {
    this.selecting = false;
    this.hint.hidden = true;
    this.guide.hidden = true;
    this.deps.chartWrap.classList.remove('replay-selecting');
    this.paintButton();
  }

  private pick(): void {
    // Artı imlecin x konumundan mumun zamanını bul (kütüphane bu olayda mum bilgisini göndermiyor).
    const c = this.cross;
    if (!c || c.x === undefined) return;
    const pt = this.deps.chart.convertFromPixel([{ x: c.x, y: c.y ?? 0 }], { paneId: c.paneId ?? 'candle_pane' });
    const ts = (Array.isArray(pt) ? pt[0] : pt)?.timestamp;
    if (ts === undefined) return;
    const bars = this.deps.feed.currentBars();
    let idx = -1;
    for (let i = 0; i < bars.length; i++) {
      if (bars[i].timestamp <= ts) idx = i;
      else break;
    }
    if (idx < 1) {
      toast('Daha ileri bir mum seçin', 'Başlangıçtan önce en az birkaç mum olmalı.');
      return;
    }
    if (idx >= bars.length - 1) {
      toast('Daha geride bir mum seçin', 'Seçtiğiniz mum zaten son mum.');
      return;
    }
    this.cancelSelect();
    this.deps.feed.startReplay(bars, idx);
    this.active = true;
    this.deps.chart.resetData();
    this.bar.hidden = false;
    this.paintButton();
    this.updatePos();
  }

  private step(): void {
    if (!this.active) return;
    if (!this.deps.feed.replayStep()) {
      this.pause();
      toast('Tekrar oynatma bitti', 'Son muma ulaşıldı. Çıkıp canlı grafiğe dönebilirsiniz.');
    }
    this.updatePos();
  }

  private play(): void {
    clearInterval(this.timer);
    this.timer = setInterval(() => this.step(), SPEEDS[this.speed].ms);
    this.playBtn.innerHTML = ICONS.pause;
    this.playBtn.title = 'Duraklat (Shift+↓)';
  }

  private pause(): void {
    clearInterval(this.timer);
    this.timer = undefined;
    this.playBtn.innerHTML = ICONS.play;
    this.playBtn.title = 'Oynat (Shift+↓)';
  }

  private togglePlay(): void {
    if (!this.active) return;
    if (this.timer) this.pause();
    else this.play();
  }

  private updatePos(): void {
    const p = this.deps.feed.replayPosition();
    if (!p) return;
    const fmt = new Intl.DateTimeFormat('tr-TR', {
      timeZone: this.deps.chart.getTimezone(),
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    this.posLabel.textContent = `${fmt.format(new Date(p.timestamp))} · ${p.total - 1 - p.index} mum kaldı`;
  }

  /** Tekrar oynatmadan çıkar. resetData=false: sembol/dilim zaten değişiyor, grafik kendisi yenilenecek. */
  exit(resetData = true): void {
    if (this.selecting) this.cancelSelect();
    if (!this.active) return;
    this.pause();
    this.active = false;
    this.deps.feed.stopReplay();
    this.bar.hidden = true;
    this.paintButton();
    if (resetData) this.deps.chart.resetData();
  }
}
