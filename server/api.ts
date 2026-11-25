// Uygulamanın sunucu API'si (/api/*): cihazlar arası senkron ve Telegram alarm ayarları.
//
// Güvenlik:
// - Her istekte "X-GT-Client: 1" başlığı gerekir. Tarayıcılar başka bir sitenin bu başlıkla istek
//   atmasına ancak CORS izniyle olanak verir; Vite yalnızca localhost kaynaklarına izin verdiği için
//   açık olan başka bir web sayfası bu API'yi kullanamaz.
// - Sunucu yalnızca localhost'ta dinler; dışarıdan erişim Tailscale ağıyla sınırlıdır.
// - Telegram anahtarı hiçbir yanıtta yer almaz.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { isSyncedKey, keepServerTriggers } from '../src/data/syncLogic.ts';
import { AlertWorker } from './alerts.ts';
import { SyncStore } from './store.ts';
import { Telegram } from './telegram.ts';

export interface ApiOptions {
  dataDir: string;
  /**
   * true: depo boşken ilk kaydı yalnızca "birincil" cihaz (X-GT-Primary başlığıyla gelen, yani
   * bilgisayardaki uygulama) yapabilir. Telefon önce açılırsa boş varsayılanları asıl verinin üstüne yazmaz.
   */
  requirePrimarySeed: boolean;
}

export interface Api {
  handle(req: IncomingMessage, res: ServerResponse): void;
  stop(): void;
}

const MAX_BODY = 20 * 1024 * 1024;

function send(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('İstek çok büyük'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length === 0 ? {} : JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('Geçersiz JSON'));
      }
    });
    req.on('error', reject);
  });
}

/** Mesajlardaki "uygulamayı aç" bağlantısı: isteğin geldiği adres (Tailscale adı). Yerel adreste boş. */
function appUrlFrom(req: IncomingMessage): string {
  const host = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? '').split(',')[0].trim();
  if (!host || /^(localhost|127\.|\[::1\])/.test(host)) return '';
  return `https://${host}`;
}

export function createApi(o: ApiOptions): Api {
  const store = new SyncStore(o.dataDir);
  const telegram = new Telegram(o.dataDir);
  const worker = new AlertWorker(store, telegram, o.dataDir);
  worker.start();
  store.onChange((keys) => {
    if (keys.includes('alerts')) worker.kick();
  });
  const transform = (key: string, value: string) => (key === 'alerts' ? keepServerTriggers(value, worker.serverTriggers()) : value);

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.headers['x-gt-client'] !== '1') return send(res, 403, { error: 'İzin yok' });
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname.replace(/\/+$/, '');
    const method = req.method ?? 'GET';
    const waiting = store.rev === 0 && o.requirePrimarySeed && req.headers['x-gt-primary'] !== '1';

    if (path === '/sync') {
      if (waiting) return send(res, 200, { rev: 0, waiting: true, entries: {} });
      if (method === 'GET') {
        const since = Math.max(0, Number(url.searchParams.get('since')) || 0);
        return send(res, 200, { rev: store.rev, entries: store.since(since) });
      }
      if (method === 'POST') {
        const body = (await readBody(req)) as { base?: unknown; changes?: unknown };
        const base = typeof body.base === 'number' && body.base >= 0 ? body.base : 0;
        const changes: Record<string, string | null> = {};
        if (body.changes && typeof body.changes === 'object') {
          for (const [k, v] of Object.entries(body.changes as Record<string, unknown>)) {
            if (isSyncedKey(k) && (v === null || typeof v === 'string')) changes[k] = v;
          }
        }
        store.apply(changes, transform);
        return send(res, 200, { rev: store.rev, entries: store.since(base) });
      }
    }

    if (path === '/telegram') {
      if (method === 'GET') {
        telegram.resumeLink();
        return send(res, 200, telegram.status());
      }
      if (method === 'POST') {
        const body = (await readBody(req)) as { token?: unknown };
        const status = await telegram.configure(String(body.token ?? '').trim(), appUrlFrom(req));
        return send(res, 200, status);
      }
      if (method === 'DELETE') {
        telegram.remove();
        return send(res, 200, telegram.status());
      }
    }

    if (path === '/telegram/test' && method === 'POST') {
      await telegram.send('🔔 Deneme mesajı: Grafik Terminali alarmları bu sohbete gelecek.');
      return send(res, 200, { ok: true });
    }

    return send(res, 404, { error: 'Bulunamadı' });
  }

  return {
    handle(req, res) {
      route(req, res).catch((e: unknown) => {
        if (!res.headersSent) send(res, 400, { error: telegram.sanitize(e instanceof Error ? e.message : String(e)) });
      });
    },
    stop() {
      worker.stop();
      telegram.stop();
    },
  };
}
