// Sunucuda alarm takibi: dakikada bir bekleyen alarmların fiyatlarını kontrol eder, tetiklenince
// Telegram'a mesaj atar ve alarmı senkron deposunda "tetiklendi" olarak işaretler (cihazlar da görür).
// Uygulamada (tarayıcıda) tetiklenen alarmlar için de yakın zamanda olduysa Telegram'a mesaj gönderilir.
// Her alarm için en fazla bir mesaj gider.
import { join } from 'node:path';
import { alertMessage, isHit, type Alert } from '../src/ui/alertLogic.ts';
import { keepServerTriggers, type ServerTrigger } from '../src/data/syncLogic.ts';
import { symbolPrice } from './prices.ts';
import { readJsonFile, writeJsonFile, type SyncStore } from './store.ts';
import type { Telegram } from './telegram.ts';

const CHECK_MS = 60_000;
/** Tarayıcıda tetiklenen alarm bu süreden eskiyse (ör. Telegram sonradan bağlandıysa) mesaj atılmaz. */
const RECENT_MS = 15 * 60_000;
const KEEP_MS = 7 * 86400_000;

interface Notified {
  at: number;
  price: number | null;
  /** Alarmı sunucu mu tetikledi (fiyatı sunucu buldu) */
  byServer: boolean;
}

function parseAlerts(raw: string | null): Alert[] {
  if (!raw) return [];
  try {
    const list = JSON.parse(raw) as unknown;
    return Array.isArray(list) ? (list as Alert[]).filter((a) => a && typeof a.id === 'string') : [];
  } catch {
    return [];
  }
}

/** Alarm görevinin Telegram'dan kullandığı kısım (testte sahtesi verilebilir). */
export type Notifier = Pick<Telegram, 'linked' | 'appUrl' | 'send' | 'sanitize'>;
export type PriceSource = (symbolId: string, extended: boolean) => Promise<number | null>;

export class AlertWorker {
  private readonly store: SyncStore;
  private readonly telegram: Notifier;
  private readonly priceOf: PriceSource;
  private readonly file: string;
  private notified: Record<string, Notified>;
  private timer: ReturnType<typeof setInterval> | null = null;
  private kickTimer: ReturnType<typeof setTimeout> | null = null;
  private running = false;

  constructor(store: SyncStore, telegram: Notifier, dir: string, priceOf: PriceSource = symbolPrice) {
    this.store = store;
    this.telegram = telegram;
    this.priceOf = priceOf;
    this.file = join(dir, 'alerts-notified.json');
    this.notified = readJsonFile<Record<string, Notified>>(this.file, {});
  }

  start(): void {
    if (this.timer) return;
    this.kick(10_000);
    this.timer = setInterval(() => void this.check(), CHECK_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.kickTimer) clearTimeout(this.kickTimer);
    this.timer = null;
  }

  /** Alarm listesi değişince kısa bir beklemeyle hemen kontrol et. */
  kick(delay = 2000): void {
    if (this.kickTimer) clearTimeout(this.kickTimer);
    this.kickTimer = setTimeout(() => void this.check(), delay);
  }

  /** Sunucunun tetiklediği alarmlar (cihazlardan gelen eski listelerde korunmaları için). */
  serverTriggers(): Record<string, ServerTrigger> {
    const out: Record<string, ServerTrigger> = {};
    for (const [id, n] of Object.entries(this.notified)) {
      if (n.byServer && n.price !== null) out[id] = { at: n.at, price: n.price };
    }
    return out;
  }

  async check(): Promise<void> {
    if (this.running || !this.telegram.linked) return;
    this.running = true;
    try {
      const alerts = parseAlerts(this.store.get('alerts'));
      const now = Date.now();
      let dirty = false;

      // 1) Uygulamada tetiklenmiş, henüz bildirilmemiş alarmlar
      for (const a of alerts) {
        if (a.triggeredAt === null || this.notified[a.id]) continue;
        if (now - a.triggeredAt < RECENT_MS) await this.notify(a, a.triggerPrice ?? a.price, false);
        else this.notified[a.id] = { at: a.triggeredAt, price: a.triggerPrice, byServer: false };
        dirty = true;
      }

      // 2) Bekleyen alarmlar: fiyatları sembol başına bir kez çek
      const active = alerts.filter((a) => a.triggeredAt === null && !this.notified[a.id]);
      let serverHit = false;
      if (active.length > 0) {
        const extended = this.store.get('extendedHours') !== 'false';
        const prices = new Map<string, number | null>();
        for (const id of new Set(active.map((a) => a.symbolId))) {
          prices.set(id, await this.priceOf(id, extended).catch(() => null));
        }
        for (const a of active) {
          const price = prices.get(a.symbolId);
          if (price === null || price === undefined || !isHit(a, price)) continue;
          if (await this.notify(a, price, true)) serverHit = true;
          dirty = true;
        }
      }

      // Sunucunun tetiklediklerini depoya işle: cihazlar alarmı "tetiklendi" olarak görür.
      if (serverHit) {
        const latest = this.store.get('alerts');
        if (latest) this.store.apply({ alerts: keepServerTriggers(latest, this.serverTriggers()) });
      }

      // Artık listede olmayan eski kayıtları temizle
      const ids = new Set(alerts.map((a) => a.id));
      for (const [id, n] of Object.entries(this.notified)) {
        if (!ids.has(id) && now - n.at > KEEP_MS) {
          delete this.notified[id];
          dirty = true;
        }
      }
      if (dirty) writeJsonFile(this.file, this.notified);
    } finally {
      this.running = false;
    }
  }

  /** Mesajı gönderir; gönderilemezse işaretlemez (bir sonraki kontrolde tekrar denenir). */
  private async notify(a: Alert, price: number, byServer: boolean): Promise<boolean> {
    try {
      await this.telegram.send(alertMessage(a, price, this.telegram.appUrl));
      this.notified[a.id] = { at: Date.now(), price, byServer };
      return true;
    } catch (e) {
      console.warn('[alarm] Telegram mesajı gönderilemedi:', this.telegram.sanitize(e instanceof Error ? e.message : String(e)));
      return false;
    }
  }
}
