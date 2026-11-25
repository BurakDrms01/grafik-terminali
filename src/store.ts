// Tarayıcıda kalıcı ayarlar (localStorage). Okuma/yazma hataları sessizce yutulur:
// gizli pencere ya da dolu depolama uygulamayı bozmasın.
const PREFIX = 'gt.v1.';

export function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* depolama dolu ya da kapalı */
  }
}

export function remove(key: string): void {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    /* yok say */
  }
}

/** Verilen önekle başlayan kayıtların anahtarları (önek "gt.v1." olmadan). */
export function keys(prefix: string): string[] {
  const out: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PREFIX + prefix)) out.push(k.slice(PREFIX.length));
    }
  } catch {
    /* yok say */
  }
  return out;
}
