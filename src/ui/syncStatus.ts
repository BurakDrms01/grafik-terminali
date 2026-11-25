// Üst çubukta senkron durumu (bulut simgesi). Tıklayınca durumu açıklar ve hemen eşitler.
import { sync, type SyncState } from '../sync.ts';
import { h, isModalOpen, toast } from './dom.ts';

const TEXT: Record<SyncState, string> = {
  off: '',
  ok: 'Senkron açık: çizimler, liste, alarmlar ve ayarlar tüm cihazlarda aynı.',
  busy: 'Senkron: değişiklikler gönderiliyor…',
  offline: 'Senkron: sunucuya ulaşılamadı. Değişiklikler bu cihazda saklanıyor, bağlantı gelince gönderilecek.',
  waiting: 'Senkron: sunucu ilk kaydı bekliyor. Önce bilgisayardaki uygulamayı açın.',
};

const ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 18h10.5a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.4 8.6 4.75 4.75 0 0 0 7 18z"/></svg>';

export function installSyncStatus(): void {
  const btn = h('button', { class: 'sync-status', 'aria-label': 'Senkron durumu', html: ICON });
  btn.hidden = true;
  btn.addEventListener('click', () => {
    toast('Senkron', TEXT[sync.state]);
    void sync.syncNow(false);
  });
  document.getElementById('feed-status')?.before(btn);
  sync.onState((s) => {
    btn.hidden = s === 'off';
    btn.dataset.state = s;
    btn.title = TEXT[s];
  });

  let prompted = false;
  sync.onRemoteChange = (_count, resumed) => {
    // Sayfaya yeni dönüldüyse doğrudan yenile; kullanıcı çalışırken ise sor.
    if (resumed && !isModalOpen()) {
      location.reload();
      return;
    }
    if (prompted) return;
    prompted = true;
    toast('Başka cihazda değişiklik var', 'Güncel hâli görmek için sayfayı yenileyin.', 'info', 120000, {
      label: 'Yenile',
      onClick: () => location.reload(),
    });
  };
}
