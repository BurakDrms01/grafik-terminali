import { readFileSync } from 'node:fs';
import { defineConfig, type ProxyOptions } from 'vite';
import { gtServer } from './server/plugin.ts';

// Yahoo Finance tarayıcıdan doğrudan çağrılamıyor (CORS). Vite'ın kendi sunucusu
// /yahoo/* isteklerini Yahoo'ya iletir. Tarayıcının localhost çerezleri, Origin ve
// Referer başlıkları dışarı gönderilmez.
const yahooProxy: ProxyOptions = {
  target: 'https://query1.finance.yahoo.com',
  changeOrigin: true,
  rewrite: (path) => path.replace(/^\/yahoo/, ''),
  headers: {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  },
  configure: (proxy) => {
    proxy.on('proxyReq', (proxyReq) => {
      proxyReq.removeHeader('cookie');
      proxyReq.removeHeader('origin');
      proxyReq.removeHeader('referer');
    });
  },
};

// Port sabit: değişirse tarayıcıda kayıtlı izleme listesi/çizimler/alarmlar görünmez olur
// (localStorage adres+porta bağlıdır). dev ve preview aynı portu kullanır.
// Telefondan erişim: Tailscale "serve" uygulamayı kendi özel ağında https://<bilgisayar>.<ağ>.ts.net
// adresinden sunar. Vite yalnızca bilinen adlara yanıt verdiği için .ts.net adlarına izin verilir.
// Sunucu yine yalnızca bu bilgisayarda (localhost) dinler; yerel ağa ya da internete açılmaz.
const allowedHosts = ['.ts.net'];

// Senkron ve Telegram alarmları için sunucu API'si (/api). İki çalışma biçimi:
// - Yerel: API bu sunucuda çalışır, veriler ./data klasöründe tutulur (sunucuda Docker volume'ü).
// - Uzak: gt.local.json'da {"syncUrl": "https://sunucu.ağ.ts.net"} varsa /api istekleri o sunucuya
//   iletilir. Bilgisayar "birincil" cihaz sayılır: boş sunucuya ilk kaydı o yapar.
//   gt.local.json git'e girmez; GT_SYNC_URL ortam değişkeni de kullanılabilir ("" ile kapatılır).
function localSettings(): { syncUrl?: string } {
  try {
    return JSON.parse(readFileSync('gt.local.json', 'utf8')) as { syncUrl?: string };
  } catch {
    return {};
  }
}
const syncUrl = (process.env.GT_SYNC_URL ?? localSettings().syncUrl ?? '').replace(/\/+$/, '');

const apiProxy: ProxyOptions = {
  target: syncUrl,
  changeOrigin: true,
  secure: true,
  configure: (proxy) => {
    proxy.on('proxyReq', (proxyReq) => {
      proxyReq.removeHeader('cookie');
      proxyReq.removeHeader('origin');
      proxyReq.removeHeader('referer');
      proxyReq.setHeader('x-gt-primary', '1');
    });
  },
};

const proxy: Record<string, ProxyOptions> = syncUrl ? { '/yahoo': yahooProxy, '/api': apiProxy } : { '/yahoo': yahooProxy };

export default defineConfig({
  plugins: syncUrl ? [] : [gtServer()],
  server: { port: 5173, strictPort: true, allowedHosts, proxy },
  preview: { port: 5173, strictPort: true, allowedHosts, proxy },
});
