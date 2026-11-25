// Giriş noktası: önce başka cihazlardaki değişiklikleri çeker, sonra uygulamayı başlatır.
// Sunucu yavaşsa ya da yoksa en fazla birkaç saniye bekler; uygulama senkronsuz da çalışır.
import { sync } from './sync.ts';

const INIT_WAIT_MS = 3000;

/** Tema senkronla değişmiş olabilir: index.html'deki erken tema ayarını tekrarla. */
function applyStoredTheme(): void {
  try {
    const t = JSON.parse(localStorage.getItem('gt.v1.theme') ?? 'null') as unknown;
    const a = JSON.parse(localStorage.getItem('gt.v1.accent') ?? 'null') as unknown;
    document.documentElement.setAttribute('data-theme', t === 'dark' ? 'dark' : 'light');
    document.documentElement.setAttribute('data-accent', a === 'blue' ? 'blue' : 'coral');
  } catch {
    /* bozuk kayıt: index.html'in seçtiği tema kalır */
  }
}

async function boot(): Promise<void> {
  let initDone = false;
  const init = sync.init().then((changed) => {
    initDone = true;
    return changed;
  });
  await Promise.race([init, new Promise((r) => setTimeout(r, INIT_WAIT_MS))]);
  applyStoredTheme();
  await import('./main.ts');
  const { installSyncStatus } = await import('./ui/syncStatus.ts');
  installSyncStatus();
  sync.start();
  // İlk çekme zaman aşımına uğradıysa ve sonradan değişiklik getirdiyse kullanıcıya bildir.
  if (!initDone) {
    void init.then((changed) => {
      if (changed > 0) sync.onRemoteChange?.(changed, false);
    });
  }
}

void boot();
