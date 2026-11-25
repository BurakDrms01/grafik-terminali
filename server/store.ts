// Senkron deposu: tüm kayıtlar tek bir JSON dosyasında, her değişiklikte sürüm (rev) artar.
// Kişisel kullanım için yeterli ve yedeklemesi kolay (tek dosya).
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SyncEntry } from '../src/data/syncLogic.ts';

interface StoreFile {
  rev: number;
  entries: Record<string, SyncEntry>;
}

export function readJsonFile<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

/** Yarım yazılmış dosya kalmasın: önce geçici dosyaya yazıp sonra yerine taşır. */
export function writeJsonFile(file: string, value: unknown): void {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(value), { mode: 0o600 });
  renameSync(tmp, file);
}

export class SyncStore {
  private readonly file: string;
  private data: StoreFile;
  private readonly listeners = new Set<(keys: string[]) => void>();

  constructor(dir: string) {
    mkdirSync(dir, { recursive: true });
    this.file = join(dir, 'sync.json');
    const loaded = readJsonFile<StoreFile | null>(this.file, null);
    this.data = loaded && typeof loaded.rev === 'number' && loaded.entries ? loaded : { rev: 0, entries: {} };
  }

  get rev(): number {
    return this.data.rev;
  }

  get(key: string): string | null {
    return this.data.entries[key]?.v ?? null;
  }

  /** Verilen sürümden sonra değişen kayıtlar. */
  since(rev: number): Record<string, SyncEntry> {
    const out: Record<string, SyncEntry> = {};
    for (const [key, entry] of Object.entries(this.data.entries)) {
      if (entry.rev > rev) out[key] = entry;
    }
    return out;
  }

  /**
   * Değişiklikleri uygular (null: sil). Aynı değer tekrar gelirse sürüm artmaz.
   * transform: kaydedilmeden önce değeri düzeltir (ör. sunucunun tetiklediği alarmları korur).
   * Değişen anahtarları döndürür ve dinleyicilere bildirir.
   */
  apply(changes: Record<string, string | null>, transform?: (key: string, value: string) => string): string[] {
    const changed: string[] = [];
    for (const [key, raw] of Object.entries(changes)) {
      const v = raw === null ? null : transform ? transform(key, raw) : raw;
      const cur = this.data.entries[key];
      if (cur ? cur.v === v : v === null) continue;
      this.data.rev += 1;
      this.data.entries[key] = { v, rev: this.data.rev };
      changed.push(key);
    }
    if (changed.length > 0) {
      writeJsonFile(this.file, this.data);
      this.listeners.forEach((fn) => fn(changed));
    }
    return changed;
  }

  onChange(fn: (keys: string[]) => void): void {
    this.listeners.add(fn);
  }
}
