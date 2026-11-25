// OANDA bağlantı penceresi: API anahtarını kaydetme ve kaldırma.
// Anahtar yalnızca sunucuya gönderilir; sunucu onu hiçbir yanıtta geri vermez.
import { oandaApi, resetOanda } from '../data/oanda.ts';
import { clear, h, modal, toast } from './dom.ts';

interface OandaStatus {
  configured: boolean;
  env?: 'practice' | 'live';
}

const step = (n: number, ...parts: (Node | string)[]) => h('p', { class: 'tg-step' }, h('b', { text: `${n}. ` }), ...parts);

/** onChange: bağlantı kurulunca ya da kaldırılınca (ör. aramayı yenilemek için). */
export function openOandaDialog(onChange?: () => void): void {
  const body = h('div', { class: 'tg-dialog' });
  const m = modal('OANDA fiyatları', body, { small: true });

  const show = (...nodes: (Node | string)[]) => {
    clear(body);
    body.append(...nodes);
  };
  const intro = h('p', {
    class: 'muted',
    text: 'TradingView’daki XAUUSD, XAGUSD, EURUSD, US30, NAS100, GER40, USOIL gibi spot ve CFD fiyatları OANDA’dan gelir. Ücretsiz demo hesabın anahtarıyla aynı fiyatlar burada da görünür.',
  });

  const render = async () => {
    try {
      const st = await oandaApi<OandaStatus>('GET', '');
      if (st.configured) renderLinked(st);
      else renderSetup();
    } catch (e) {
      show(h('p', { text: e instanceof Error ? e.message : String(e) }));
    }
  };

  const renderSetup = () => {
    const input = h('input', {
      type: 'password',
      autocomplete: 'off',
      spellcheck: 'false',
      placeholder: 'a1b2c3…-d4e5f6…',
      'aria-label': 'OANDA API anahtarı',
    });
    const save = h('button', { class: 'btn primary', type: 'submit', text: 'Kaydet' });
    const error = h('p', { class: 'tg-error', role: 'alert' });
    const form = h(
      'form',
      null,
      h('div', { class: 'field' }, h('label', { text: 'OANDA API anahtarı' }), input),
      error,
      h('div', { class: 'modal-actions' }, save),
    );
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      save.disabled = true;
      save.textContent = 'Kontrol ediliyor…';
      error.textContent = '';
      try {
        const st = await oandaApi<OandaStatus>('POST', '', { token: input.value.trim() });
        input.value = '';
        resetOanda();
        onChange?.();
        toast('OANDA', 'Bağlandı: spot fiyatlar aramada çıkacak.');
        renderLinked(st);
      } catch (err) {
        error.textContent = err instanceof Error ? err.message : String(err);
        save.disabled = false;
        save.textContent = 'Kaydet';
      }
    });
    const link = h('a', { href: 'https://www.oanda.com/', target: '_blank', rel: 'noopener', text: 'oanda.com' });
    show(
      intro,
      step(1, link, ' adresinde ücretsiz demo hesap aç (para yatırmak gerekmez).'),
      step(2, 'Hesabına gir, menüden “Manage API Access” (API erişimi) sayfasına geç ve “Generate” ile anahtar oluştur.'),
      step(3, 'Anahtarı aşağıya yapıştırıp Kaydet’e bas. Anahtarı kimseyle paylaşma.'),
      form,
    );
    input.focus();
  };

  const renderLinked = (st: OandaStatus) => {
    const remove = h('button', { class: 'btn', type: 'button', text: 'Bağlantıyı kaldır' });
    remove.addEventListener('click', async () => {
      try {
        await oandaApi('DELETE', '');
        resetOanda();
        onChange?.();
        toast('OANDA', 'Bağlantı kaldırıldı, anahtar sunucudan silindi.');
        renderSetup();
      } catch (e) {
        toast('OANDA', e instanceof Error ? e.message : String(e), 'error');
      }
    });
    show(
      h('p', { class: 'tg-ok', text: `✓ Bağlı (${st.env === 'live' ? 'gerçek hesap' : 'demo hesap'}): OANDA fiyatları aramada en üstte çıkar.` }),
      intro,
      h('p', { class: 'muted', text: 'Örnek: XAUUSD, XAGUSD, EURUSD, US30, NAS100, GER40, USOIL yazıp dene.' }),
      h('div', { class: 'modal-actions' }, remove, h('button', { class: 'btn primary', type: 'button', text: 'Tamam', onclick: () => m.close() })),
    );
  };

  show(h('p', { class: 'muted', text: 'Yükleniyor…' }));
  void render();
}
