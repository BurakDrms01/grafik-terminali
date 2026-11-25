import { defineConfig, type ProxyOptions } from 'vite';

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

export default defineConfig({
  server: { port: 5173, strictPort: true, allowedHosts, proxy: { '/yahoo': yahooProxy } },
  preview: { port: 5173, strictPort: true, allowedHosts, proxy: { '/yahoo': yahooProxy } },
});
