import type { Chart, OverlayEvent } from 'klinecharts';
import type { QuoteHub } from '../data/quotes.ts';
import { parseId, type SymbolDef } from '../data/types.ts';
import { load, save } from '../store.ts';
import { collectHits, directionFor, type Alert } from './alertLogic.ts';
import { clear, h, modal, toast } from './dom.ts';
import { fmtPrice, fmtTime, parsePriceInput } from './format.ts';
import { openTelegramDialog } from './telegram.ts';
import { cssVar } from './theme.ts';

const GROUP = 'alerts';

export interface AlertsDeps {
  open(def: SymbolDef): void;
  current(): SymbolDef;
  currentPrice(): number | null;
  onChange(): void;
}

// ---------- Ses ve masaüstü bildirimi ----------
let audio: AudioContext | null = null;

/** Tarayıcılar sesi ancak bir kullanıcı etkileşiminden sonra açar. */
export function unlockAudio(): void {
  try {
    audio ??= new AudioContext();
    void audio.resume();
  } catch {
    /* ses desteklenmiyor */
  }
}

function beep(): void {
  if (!audio) return;
  const t0 = audio.currentTime;
  for (let i = 0; i < 3; i++) {
    const t = t0 + i * 0.28;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.frequency.value = i === 2 ? 1175 : 880;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.3, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    osc.connect(gain).connect(audio.destination);
    osc.start(t);
    osc.stop(t + 0.22);
  }
}

function askNotificationPermission(): void {
  if ('Notification' in window && Notification.permission === 'default') {
    void Notification.requestPermission();
  }
}

function defFromAlert(a: Alert): SymbolDef | null {
  const p = parseId(a.symbolId);
  if (!p) return null;
  return { id: a.symbolId, source: p.source, ticker: p.ticker, name: a.symbolName, exchange: '', type: '' };
}

export class Alerts {
  private list: Alert[] = load<Alert[]>('alerts', []);
  private shownFor: string | null = null;
  private suspended = false;
  private baseTitle = '';

  constructor(
    private readonly el: HTMLElement,
    private readonly chart: Chart,
    private readonly quotes: QuoteHub,
    private readonly deps: AlertsDeps,
  ) {
    quotes.on((q) => this.check(q.id, q.price));
    window.addEventListener('focus', () => this.restoreTitle());
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) this.restoreTitle();
    });
    this.render();
  }

  /** Fiyatı takip edilmesi gereken semboller (tetiklenmemiş alarmlar). */
  /** Henüz tetiklenmemiş alarm sayısı (sağ çubuktaki rozet için). */
  activeCount(): number {
    return this.list.filter((a) => a.triggeredAt === null).length;
  }

  symbolIds(): string[] {
    return [...new Set(this.list.filter((a) => a.triggeredAt === null).map((a) => a.symbolId))];
  }

  private persist(): void {
    save('alerts', this.list);
    this.render();
    this.drawLines(true);
    this.deps.onChange();
  }

  /** preset: grafikte sağ tıklanan fiyat gibi önceden doldurulacak seviye. */
  openCreateDialog(preset?: number): void {
    const def = this.deps.current();
    const current = this.quotes.get(def.id)?.price ?? this.deps.currentPrice();
    const initial = preset ?? current;
    const input = h('input', {
      type: 'text',
      inputmode: 'decimal',
      value: initial !== null ? String(initial) : '',
      'aria-label': 'Alarm fiyatı',
    });
    const hint = h('small', { class: 'muted' });
    const updateHint = () => {
      const v = parsePriceInput(input.value, current ?? undefined);
      if (v === null || current === null) hint.textContent = '';
      else hint.textContent = directionFor(current, v) === 'up' ? `↑ Fiyat ${fmtPrice(v, def.id)} ve üstüne çıkınca` : `↓ Fiyat ${fmtPrice(v, def.id)} ve altına inince`;
    };
    input.addEventListener('input', updateHint);
    updateHint();
    const ok = h('button', { class: 'btn primary', text: 'Alarmı kur', type: 'submit' });
    const cancel = h('button', { class: 'btn', text: 'Vazgeç', type: 'button' });
    const form = h(
      'form',
      null,
      h('p', { class: 'muted', text: `${def.name} — şu an: ${current !== null ? fmtPrice(current, def.id) : 'bilinmiyor'}` }),
      h('div', { class: 'field' }, h('label', { text: 'Fiyat seviyesi' }), input, hint),
      h('p', {
        class: 'muted',
        style: 'font-size:12px',
        text: 'Alarm, uygulama açıkken çalışır. Grafikteki turuncu çizgiyi sürükleyerek seviyeyi değiştirebilir, sağ tıklayarak silebilirsiniz.',
      }),
      h('div', { class: 'modal-actions' }, cancel, ok),
    );
    const m = modal('Fiyat alarmı', form, { small: true });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const level = parsePriceInput(input.value, current ?? undefined);
      if (level === null) {
        toast('Geçersiz fiyat', 'Örnek: 62000 ya da 62.000,50', 'error');
        return;
      }
      unlockAudio();
      askNotificationPermission();
      this.add(def, level, current ?? level);
      m.close();
    });
    cancel.addEventListener('click', () => m.close());
    input.focus();
    input.select();
  }

  private add(def: SymbolDef, level: number, current: number): void {
    const a: Alert = {
      id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
      symbolId: def.id,
      symbolName: def.name,
      price: level,
      dir: directionFor(current, level),
      createdAt: Date.now(),
      triggeredAt: null,
      triggerPrice: null,
    };
    this.list.push(a);
    this.persist();
    toast('Alarm kuruldu', `${def.name}: ${a.dir === 'up' ? '↑' : '↓'} ${fmtPrice(level, def.id)}`);
    const q = this.quotes.get(def.id);
    if (q) this.check(def.id, q.price);
  }

  private removeAlert(id: string): void {
    this.list = this.list.filter((a) => a.id !== id);
    this.persist();
  }

  check(symbolId: string, price: number): void {
    const hits = collectHits(this.list, symbolId, price);
    if (hits.length === 0) return;
    const now = Date.now();
    for (const a of hits) {
      a.triggeredAt = now;
      a.triggerPrice = price;
      this.notify(a, price);
    }
    this.persist();
  }

  private notify(a: Alert, price: number): void {
    const title = `Fiyat alarmı: ${a.symbolName}`;
    const body = `${a.dir === 'up' ? '↑' : '↓'} ${fmtPrice(a.price, a.symbolId)} seviyesine ulaştı (şu an ${fmtPrice(price, a.symbolId)})`;
    toast(title, body, 'alert', 15000);
    beep();
    if (!this.baseTitle) this.baseTitle = document.title;
    document.title = `🔔 ${a.symbolName} ${fmtPrice(price, a.symbolId)}`;
    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        const n = new Notification(title, { body, tag: a.id });
        n.onclick = () => {
          window.focus();
          const def = defFromAlert(a);
          if (def) this.deps.open(def);
          n.close();
        };
      } catch {
        /* bildirim gösterilemedi */
      }
    }
  }

  private restoreTitle(): void {
    if (this.baseTitle) {
      document.title = this.baseTitle;
      this.baseTitle = '';
    }
  }

  /** Açık grafiğin sembolüne ait alarmları turuncu kesikli çizgi olarak gösterir. */
  drawLines(force = false): void {
    const symbolId = this.deps.current().id;
    if (!force && this.shownFor === symbolId) return;
    this.shownFor = symbolId;
    this.suspended = true;
    this.chart.removeOverlay({ groupId: GROUP });
    this.suspended = false;
    for (const a of this.list) {
      if (a.symbolId !== symbolId || a.triggeredAt !== null) continue;
      this.chart.createOverlay({
        name: 'horizontalStraightLine',
        groupId: GROUP,
        points: [{ timestamp: a.createdAt, value: a.price }],
        extendData: a.id,
        styles: { line: { color: cssVar('--warn'), style: 'dashed', dashedValue: [6, 4], size: 1 } },
        onPressedMoveEnd: (e: OverlayEvent<unknown>) => this.onLineMoved(a.id, e),
        onRemoved: () => {
          if (this.suspended) return;
          this.list = this.list.filter((x) => x.id !== a.id);
          toast('Alarm silindi', `${a.symbolName}: ${fmtPrice(a.price, a.symbolId)}`);
          save('alerts', this.list);
          this.render();
          this.deps.onChange();
        },
      });
    }
  }

  private onLineMoved(id: string, e: OverlayEvent<unknown>): void {
    const a = this.list.find((x) => x.id === id);
    const value = e.overlay.points[0]?.value;
    if (!a || value === undefined) return;
    const precision = this.chart.getSymbol()?.pricePrecision ?? 2;
    const level = Number(value.toFixed(precision));
    const current = this.quotes.get(a.symbolId)?.price ?? this.deps.currentPrice() ?? level;
    a.price = level;
    a.dir = directionFor(current, level);
    save('alerts', this.list);
    this.render();
    toast('Alarm güncellendi', `${a.symbolName}: ${a.dir === 'up' ? '↑' : '↓'} ${fmtPrice(level, a.symbolId)}`);
    this.check(a.symbolId, current);
  }

  render(): void {
    clear(this.el);
    const hasDone = this.list.some((a) => a.triggeredAt !== null);
    const head = h(
      'div',
      { class: 'panel-head' },
      h('span', { class: 'title', text: 'Alarmlar' }),
      hasDone &&
        h('button', {
          class: 'tb-btn',
          style: 'height:24px;font-size:12px',
          title: 'Tetiklenmiş alarmları listeden kaldır',
          text: 'Temizle',
          onclick: () => {
            this.list = this.list.filter((a) => a.triggeredAt === null);
            this.persist();
          },
        }),
      h('button', {
        class: 'icon-btn tg-btn',
        title: 'Telegram bildirimleri: alarmlar telefonuna mesaj olarak gelsin',
        'aria-label': 'Telegram bildirimleri',
        html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M21 4L3 11l6 2.2M21 4l-3.2 16-7.3-5.3M21 4L9 13.2m0 0v5.6l2.9-3.4"/></svg>',
        onclick: () => openTelegramDialog(),
      }),
      h('button', {
        class: 'icon-btn',
        title: 'Açık grafik için alarm kur',
        'aria-label': 'Alarm kur',
        text: '+',
        onclick: () => this.openCreateDialog(),
      }),
    );
    const body = h('div', { class: 'panel-body' });
    if (this.list.length === 0) {
      body.append(h('div', { class: 'empty', text: 'Henüz alarm yok. Üstteki 🔔 Alarm düğmesiyle kurabilirsiniz.' }));
    }
    const sorted = [...this.list].sort(
      (a, b) => Number(a.triggeredAt !== null) - Number(b.triggeredAt !== null) || b.createdAt - a.createdAt,
    );
    for (const a of sorted) {
      const done = a.triggeredAt !== null;
      body.append(
        h(
          'div',
          {
            class: `al-row${done ? ' done' : ''}`,
            role: 'button',
            tabindex: '0',
            title: 'Grafiği aç',
            onclick: () => {
              const def = defFromAlert(a);
              if (def) this.deps.open(def);
            },
          },
          h('span', { class: `al-dir ${a.dir === 'up' ? 'up' : 'down'}`, text: a.dir === 'up' ? '↑' : '↓' }),
          h(
            'span',
            { class: 'al-main' },
            h('span', { class: 't', text: `${a.symbolName}  ${fmtPrice(a.price, a.symbolId)}` }),
            h('small', {
              text: done
                ? `Tetiklendi ${fmtTime(a.triggeredAt!)} · ${fmtPrice(a.triggerPrice ?? a.price, a.symbolId)}`
                : `Kuruldu ${fmtTime(a.createdAt)}`,
            }),
          ),
          h('button', {
            class: 'icon-btn',
            title: 'Alarmı sil',
            'aria-label': 'Alarmı sil',
            text: '×',
            onclick: (e: Event) => {
              e.stopPropagation();
              this.removeAlert(a.id);
            },
          }),
        ),
      );
    }
    this.el.append(head, body);
  }
}
