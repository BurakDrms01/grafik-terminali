// Vite eklentisi: /api/* isteklerini hem geliştirme (vite) hem çalıştırma (vite preview) sunucusunda karşılar.
// Veri klasörü: GT_DATA_DIR (varsayılan ./data). Sunucuda Docker volume'üne bağlanır.
import { resolve } from 'node:path';
import type { Connect, Plugin } from 'vite';
import { createApi, type Api } from './api.ts';

interface ServerLike {
  middlewares: Connect.Server;
  httpServer: { once(event: 'close', fn: () => void): unknown } | null;
}

export function gtServer(): Plugin {
  let api: Api | null = null;
  const attach = (server: ServerLike) => {
    api ??= createApi({
      dataDir: resolve(process.env.GT_DATA_DIR || 'data'),
      requirePrimarySeed: process.env.GT_REQUIRE_PRIMARY_SEED === '1',
    });
    const current = api;
    server.middlewares.use('/api', (req, res) => current.handle(req, res));
    server.httpServer?.once('close', () => {
      current.stop();
      if (api === current) api = null;
    });
  };
  return { name: 'grafik-terminali-api', configureServer: attach, configurePreviewServer: attach };
}
