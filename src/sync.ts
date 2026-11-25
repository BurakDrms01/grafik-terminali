// Cihazlar arası senkron: tarayıcıdaki kayıtlar (çizimler, izleme listesi, alarmlar, ayarlar) sunucudaki
// depoyla eşitlenir. Sunucu API'si yoksa (ör. dosyalar statik sunuluyorsa) sessizce kapalı kalır.
//
// - İlk eşitleme: sunucudaki ayarlar cihaza yazılır, çizim ve alarm listeleri birleştirilir.
// - Sonra: değişen kayıtlar kısa bir beklemeyle gönderilir, düzenli aralıklarla yenileri çekilir.
// - Çakışmada son yazan kazanır (kayıt başına). Gönderilmemiş yerel değişiklik, gelen değişiklikle ezilmez.
import { isSyncedKey, planFirstSync, type SyncEntry } from './data/syncLogic.ts';
import { keys, onStoreChange, readRaw, writeRaw } from './store.ts';

const API = '/api/sync';
const HEADERS = { 'Content-Type': 'application/json', 'X-GT-Client': '1' };
/** Senkronun kendi kayıtları (gt.v1. dışında: eşitlenmez) */
const REV_KEY = 'gt.sync.rev';
const DIRTY_KEY = 'gt.sync.dirty';
const PUSH_DELAY_MS = 1500;
const POLL_MS = 20000;
/** Sayfa kapanırken keepalive isteğinin tarayıcı sınırı */
const KEEPALIVE_LIMIT = 60000;

/**
 * off: sunucu yok · ok: eşit · busy: gönderiliyor · offline: sunucuya ulaşılamadı ·
 * waiting: sunucu ilk kaydı bilgisayardan bekliyor
 */
export type SyncState = 'off' | 'ok' | 'busy' | 'offline' | 'waiting';

interface SyncResponse {
  rev: number;
  entries: Record<string, SyncEntry>;
  waiting?: boolean;
}

function readMeta(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeMeta(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* depolama kapalı */
  }
}

class NoApiError extends Error {}

class SyncClient {
  private rev = Number(readMeta(REV_KEY)) || 0;
  private readonly dirty = new Set<string>(SyncClient.readDirty());
  private available = true;
  private started = false;
  private queue: Promise<unknown> = Promise.resolve();
  private pushTimer: ReturnType<typeof setTimeout> | undefined;
  private stateValue: SyncState = 'off';
  private readonly stateListeners = new Set<(s: SyncState) => void>();
  /** Uygulama açıkken başka cihazdan değişiklik gelince. resumed: kullanıcı sayfaya yeni döndü. */
  onRemoteChange: ((count: number, resumed: boolean) => void) | null = null;

  private static readDirty(): string[] {
    try {
      const list = JSON.parse(readMeta(DIRTY_KEY) ?? '[]') as unknown;
      return Array.isArray(list) ? list.filter((k): k is string => typeof k === 'string') : [];
    } catch {
      return [];
    }
  }

  get state(): SyncState {
    return this.stateValue;
  }

  onState(fn: (s: SyncState) => void): void {
    this.stateListeners.add(fn);
    fn(this.stateValue);
  }

  /** Uygulama açılmadan önce: sunucudaki güncel kayıtları cihaza yazar. Uygulanan değişiklik sayısı. */
  init(): Promise<number> {
    return this.enqueue(() => this.syncOnce());
  }

  /** Uygulama açıldıktan sonra: yerel değişiklikleri izler, düzenli olarak eşitler. */
  start(): void {
    if (this.started) return;
    this.started = true;
    onStoreChange((key) => {
      if (!isSyncedKey(key) || !this.available) return;
      this.dirty.add(key);
      this.saveDirty();
      this.schedulePush();
    });
    setInterval(() => {
      if (!document.hidden) void this.syncNow(false);
    }, POLL_MS);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) void this.syncNow(true);
    });
    window.addEventListener('online', () => void this.syncNow(false));
    window.addEventListener('pagehide', () => this.flushOnExit());
    if (this.dirty.size > 0) this.schedulePush();
  }

  /** Hemen eşitle (durum göstergesine tıklanınca da). */
  async syncNow(resumed = false): Promise<void> {
    const changed = await this.enqueue(() => this.syncOnce());
    if (changed > 0) this.onRemoteChange?.(changed, resumed);
  }

  private enqueue(fn: () => Promise<number>): Promise<number> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => 0);
    return run;
  }

  private setState(s: SyncState): void {
    if (s === this.stateValue) return;
    this.stateValue = s;
    this.stateListeners.forEach((fn) => fn(s));
  }

  private setRev(rev: number): void {
    this.rev = rev;
    writeMeta(REV_KEY, String(rev));
  }

  private saveDirty(): void {
    writeMeta(DIRTY_KEY, JSON.stringify([...this.dirty]));
  }

  private schedulePush(): void {
    clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => void this.syncNow(false), PUSH_DELAY_MS);
  }

  private async request(method: 'GET' | 'POST', url: string, body?: unknown): Promise<SyncResponse> {
    const res = await fetch(url, {
      method,
      headers: HEADERS,
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
    });
    if (res.status === 404) throw new NoApiError();
    if (!res.ok) throw new Error(`Senkron hatası (${res.status})`);
    // API'siz sunucular bilinmeyen adreslere sayfanın kendisini (HTML) döndürür.
    if (!(res.headers.get('content-type') ?? '').includes('application/json')) throw new NoApiError();
    const data = (await res.json()) as SyncResponse;
    if (typeof data?.rev !== 'number' || !data.entries || typeof data.entries !== 'object') throw new Error('Beklenmeyen yanıt');
    return data;
  }

  /** Bir eşitleme turu: uygulanan uzak değişiklik sayısını döndürür. */
  private async syncOnce(): Promise<number> {
    if (!this.available) return 0;
    try {
      if (this.rev === 0) return await this.firstSync();
      return this.dirty.size > 0 ? await this.push() : await this.pull();
    } catch (e) {
      if (e instanceof NoApiError) {
        this.available = false;
        this.setState('off');
      } else {
        this.setState('offline');
      }
      return 0;
    }
  }

  private localValues(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const k of keys('')) {
      if (!isSyncedKey(k)) continue;
      const v = readRaw(k);
      if (v !== null) out[k] = v;
    }
    return out;
  }

  private async firstSync(): Promise<number> {
    const r = await this.request('GET', `${API}?since=0`);
    if (r.waiting) {
      this.setState('waiting');
      return 0;
    }
    const plan = planFirstSync(r.entries, this.localValues());
    let changed = 0;
    for (const [k, v] of Object.entries(plan.writes)) {
      if (readRaw(k) !== v) {
        writeRaw(k, v);
        changed++;
      }
    }
    plan.dirty.forEach((k) => this.dirty.add(k));
    this.saveDirty();
    this.setRev(r.rev);
    if (this.dirty.size > 0) return changed + (await this.push());
    this.setState('ok');
    return changed;
  }

  /** Sunucudan gelen kayıtları uygular; gönderilmemiş yerel değişiklikler ezilmez. */
  private applyEntries(entries: Record<string, SyncEntry>): number {
    let changed = 0;
    for (const [k, e] of Object.entries(entries)) {
      if (!isSyncedKey(k) || this.dirty.has(k)) continue;
      if (readRaw(k) === e.v) continue;
      writeRaw(k, e.v);
      changed++;
    }
    return changed;
  }

  private async pull(): Promise<number> {
    const r = await this.request('GET', `${API}?since=${this.rev}`);
    if (r.waiting || r.rev < this.rev) {
      // Sunucu deposu sıfırlanmış: bu cihaz baştan eşitlensin.
      this.setRev(0);
      if (!r.waiting) return this.firstSync();
      this.setState('waiting');
      return 0;
    }
    const changed = this.applyEntries(r.entries);
    this.setRev(r.rev);
    this.setState('ok');
    return changed;
  }

  private async push(): Promise<number> {
    this.setState('busy');
    const sent = [...this.dirty];
    const changes: Record<string, string | null> = {};
    for (const k of sent) changes[k] = readRaw(k);
    const r = await this.request('POST', API, { base: this.rev, changes });
    if (r.waiting) {
      this.setState('waiting');
      return 0;
    }
    // Gönderimden sonra yeniden değişmeyenler artık eşit.
    for (const k of sent) if (readRaw(k) === changes[k]) this.dirty.delete(k);
    this.saveDirty();
    // Yanıtta başka cihazların değişiklikleri ve sunucunun düzelttikleri (ör. tetiklenmiş alarm) var.
    const changed = this.applyEntries(r.entries);
    this.setRev(r.rev);
    if (this.dirty.size > 0) this.schedulePush();
    else this.setState('ok');
    return changed;
  }

  /** Sayfa kapanırken gönderilmemiş değişiklikleri son bir kez dene (sonuç beklenmez; açılışta tekrar gönderilir). */
  private flushOnExit(): void {
    if (!this.available || this.dirty.size === 0 || this.rev === 0) return;
    const changes: Record<string, string | null> = {};
    for (const k of this.dirty) changes[k] = readRaw(k);
    const body = JSON.stringify({ base: this.rev, changes });
    if (body.length > KEEPALIVE_LIMIT) return;
    void fetch(API, { method: 'POST', headers: HEADERS, body, keepalive: true }).catch(() => {});
  }
}

export const sync = new SyncClient();
