// Cihazlar arası senkronun saf kuralları. Hem tarayıcı (src/sync.ts) hem sunucu (server/) kullanır.

/** Sunucudaki bir kaydın durumu. v: kaydın JSON metni, null: silindi. rev: kaydın son değiştiği sürüm. */
export interface SyncEntry {
  v: string | null;
  rev: number;
}

/**
 * Cihaza özel ayarlar: eşitlenmez (açık panel, son açılan sembol…). "gramAltinAdded" gibi tek seferlik
 * işaretler eşitlenir: yoksa her yeni cihaz, kullanıcının sildiği öğeyi ortak listeye yeniden eklerdi.
 */
const LOCAL_ONLY = new Set(['last', 'sidePanel', 'settingsTab', 'replay-selecting', 'themeVersion']);

export function isSyncedKey(key: string): boolean {
  return key.length > 0 && key.length <= 200 && !LOCAL_ONLY.has(key);
}

/** İlk eşitlemede iki taraf birleştirilen kayıtlar: yalnızca bir cihazda olan çizim ve alarm kaybolmasın. */
export function isUnionKey(key: string): boolean {
  return key === 'alerts' || key.startsWith('drawings.');
}

/** Liste öğesinin kimliği: id alanı varsa o (alarmlar), yoksa içeriğin kendisi (çizimler). */
function identity(item: unknown): string {
  const id = item && typeof item === 'object' ? (item as { id?: unknown }).id : undefined;
  return typeof id === 'string' ? `id:${id}` : `json:${JSON.stringify(item)}`;
}

/** İki JSON dizisini birleştirir: önce sunucudakiler, sonra yalnızca yerelde olanlar. Dizi değilse null. */
export function unionJson(serverJson: string, localJson: string): string | null {
  let server: unknown;
  let local: unknown;
  try {
    server = JSON.parse(serverJson);
    local = JSON.parse(localJson);
  } catch {
    return null;
  }
  if (!Array.isArray(server) || !Array.isArray(local)) return null;
  const seen = new Set(server.map(identity));
  const extra = local.filter((item) => !seen.has(identity(item)));
  return extra.length === 0 ? serverJson : JSON.stringify([...server, ...extra]);
}

export interface FirstSyncPlan {
  /** Cihaza yazılacak kayıtlar */
  writes: Record<string, string>;
  /** Sunucuya gönderilecek kayıtlar */
  dirty: string[];
}

/**
 * Bir cihazın ilk eşitlemesi: sunucuda olan ayarlar cihaza yazılır (sunucu kazanır), çizim ve alarm
 * listeleri birleştirilir, yalnızca cihazda olan kayıtlar sunucuya gönderilmek üzere işaretlenir.
 */
export function planFirstSync(server: Record<string, SyncEntry>, local: Record<string, string>): FirstSyncPlan {
  const writes: Record<string, string> = {};
  const dirty: string[] = [];
  for (const [key, entry] of Object.entries(server)) {
    if (!isSyncedKey(key) || entry.v === null) continue;
    const mine = local[key];
    if (mine !== undefined && isUnionKey(key)) {
      const merged = unionJson(entry.v, mine);
      if (merged !== null) {
        writes[key] = merged;
        if (merged !== entry.v) dirty.push(key);
        continue;
      }
    }
    writes[key] = entry.v;
  }
  for (const key of Object.keys(local)) {
    if (!isSyncedKey(key)) continue;
    const entry = server[key];
    if (!entry || entry.v === null) dirty.push(key);
  }
  return { writes, dirty };
}

/** Sunucunun tetikleyip Telegram'a bildirdiği alarm. */
export interface ServerTrigger {
  at: number;
  price: number;
}

/**
 * Sunucunun tetiklediği alarmlar, eski listeyle gelen bir güncellemede (ör. o sırada başka bir alarm
 * eklenen telefon) tekrar "bekliyor" durumuna dönmesin. Değişiklik yoksa metin aynen döner.
 */
export function keepServerTriggers(alertsJson: string, triggers: Record<string, ServerTrigger>): string {
  let list: unknown;
  try {
    list = JSON.parse(alertsJson);
  } catch {
    return alertsJson;
  }
  if (!Array.isArray(list)) return alertsJson;
  let touched = false;
  const out = list.map((a: unknown) => {
    if (!a || typeof a !== 'object') return a;
    const alert = a as { id?: unknown; triggeredAt?: unknown };
    const t = typeof alert.id === 'string' ? triggers[alert.id] : undefined;
    if (!t || alert.triggeredAt !== null) return a;
    touched = true;
    return { ...alert, triggeredAt: t.at, triggerPrice: t.price };
  });
  return touched ? JSON.stringify(out) : alertsJson;
}
