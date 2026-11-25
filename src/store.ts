// Tarayıcıda kalıcı ayarlar (localStorage). Okuma/yazma hataları sessizce yutulur:
// gizli pencere ya da dolu depolama uygulamayı bozmasın.
const PREFIX = 'gt.v1.';

type ChangeListener = (key: string) => void;
const listeners = new Set<ChangeListener>();

/** Uygulamanın yaptığı her kayıt/silme bildirilir (senkron, değişen kaydı sunucuya gönderir). */
export function onStoreChange(fn: ChangeListener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(key: string): void {
  listeners.forEach((fn) => {
    try {
      fn(key);
    } catch {
      /* dinleyici hatası kaydı bozmasın */
    }
  });
}

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
    return;
  }
  emit(key);
}

export function remove(key: string): void {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    /* yok say */
    return;
  }
  emit(key);
}

/** Kaydın ham JSON metni (yoksa null). */
export function readRaw(key: string): string | null {
  try {
    return localStorage.getItem(PREFIX + key);
  } catch {
    return null;
  }
}

/** Ham yazma/silme (null): başka cihazdan gelen değişiklikler için; değişiklik bildirimi yapmaz. */
export function writeRaw(key: string, raw: string | null): void {
  try {
    if (raw === null) localStorage.removeItem(PREFIX + key);
    else localStorage.setItem(PREFIX + key, raw);
  } catch {
    /* depolama dolu ya da kapalı */
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
