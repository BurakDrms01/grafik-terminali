// Telegram bildirimleri penceresi: bot anahtarını kaydetme, sohbeti bağlama, deneme mesajı.
// Anahtar yalnızca sunucuya gönderilir; sunucu onu hiçbir yanıtta geri vermez.
import { clear, h, modal, toast } from './dom.ts';

interface TgStatus {
  configured: boolean;
  linked: boolean;
  botName?: string;
  botUsername?: string;
  chatName?: string;
  linkUrl?: string;
}

const HEADERS = { 'Content-Type': 'application/json', 'X-GT-Client': '1' };

async function api<T>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, { method, headers: HEADERS, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' });
  } catch {
    throw new Error('Sunucuya ulaşılamadı.');
  }
  if (res.status === 404) throw new Error('Bu kurulumda sunucu yok. Telegram bildirimleri sunucuda çalışan sürümde kullanılabilir.');
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || `Sunucu hatası (${res.status})`);
  return data;
}

const step = (n: number, text: string) => h('p', { class: 'tg-step' }, h('b', { text: `${n}. ` }), text);

export function openTelegramDialog(): void {
  const body = h('div', { class: 'tg-dialog' });
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  modal('Telegram bildirimleri', body, {
    small: true,
    onClose: () => {
      closed = true;
      clearTimeout(pollTimer);
    },
  });

  const show = (...nodes: (Node | string | false)[]) => {
    clear(body);
    body.append(...nodes.filter((n): n is Node | string => n !== false));
  };
  const intro = h('p', {
    class: 'muted',
    text: 'Alarmların tetiklenince telefonuna Telegram mesajı gelir. Kontrolü sunucu dakikada bir yapar; uygulama kapalıyken de çalışır.',
  });

  const render = async () => {
    clearTimeout(pollTimer);
    let st: TgStatus;
    try {
      st = await api<TgStatus>('GET', '/telegram');
    } catch (e) {
      show(h('p', { text: e instanceof Error ? e.message : String(e) }));
      return;
    }
    if (!st.configured) renderSetup();
    else if (!st.linked) renderLink(st);
    else renderLinked(st);
  };

  const renderSetup = () => {
    const input = h('input', {
      type: 'password',
      autocomplete: 'off',
      spellcheck: 'false',
      placeholder: '123456789:AA…',
      'aria-label': 'Bot anahtarı',
    });
    const save = h('button', { class: 'btn primary', type: 'submit', text: 'Kaydet' });
    const error = h('p', { class: 'tg-error', role: 'alert' });
    const form = h(
      'form',
      null,
      h('div', { class: 'field' }, h('label', { text: 'Bot anahtarı (token)' }), input),
      error,
      h('div', { class: 'modal-actions' }, save),
    );
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      save.disabled = true;
      error.textContent = '';
      try {
        const st = await api<TgStatus>('POST', '/telegram', { token: input.value.trim() });
        input.value = '';
        renderLink(st);
      } catch (err) {
        error.textContent = err instanceof Error ? err.message : String(err);
        save.disabled = false;
      }
    });
    show(
      intro,
      step(1, 'Telegram’da @BotFather’ı aç ve /newbot yaz.'),
      step(2, 'Botuna bir ad ve “_bot” ile biten bir kullanıcı adı ver.'),
      step(3, 'BotFather’ın verdiği anahtarı aşağıya yapıştır. Anahtarı kimseyle paylaşma.'),
      form,
    );
    input.focus();
  };

  const renderLink = (st: TgStatus) => {
    const open = h('a', {
      class: 'btn primary tg-open',
      href: st.linkUrl ?? '#',
      target: '_blank',
      rel: 'noopener',
      text: `Telegram’da aç (@${st.botUsername ?? ''})`,
    });
    show(
      h('p', { text: `Bot hazır: ${st.botName ?? ''}. Şimdi sohbeti bağla:` }),
      step(4, 'Aşağıdaki düğmeye bas, açılan sohbette “Başlat”a (Start) dokun.'),
      open,
      h('p', { class: 'muted tg-wait', text: 'Bağlantı bekleniyor…' }),
      h('div', { class: 'modal-actions' }, h('button', { class: 'btn', type: 'button', text: 'Vazgeç ve anahtarı sil', onclick: () => void removeConfig() })),
    );
    // Bağlanınca pencere kendiliğinden güncellenir (yalnızca durum değişince yeniden çizilir).
    const poll = async () => {
      if (closed) return;
      try {
        const next = await api<TgStatus>('GET', '/telegram');
        if (closed) return;
        if (next.linked || !next.configured) return void render();
      } catch {
        /* geçici hata: beklemeye devam */
      }
      pollTimer = setTimeout(() => void poll(), 3000);
    };
    pollTimer = setTimeout(() => void poll(), 3000);
  };

  const renderLinked = (st: TgStatus) => {
    const test = h('button', { class: 'btn primary', type: 'button', text: 'Deneme mesajı gönder' });
    test.addEventListener('click', async () => {
      test.disabled = true;
      try {
        await api('POST', '/telegram/test');
        toast('Telegram', 'Deneme mesajı gönderildi.');
      } catch (e) {
        toast('Telegram', e instanceof Error ? e.message : String(e), 'error');
      } finally {
        test.disabled = false;
      }
    });
    show(
      h('p', { class: 'tg-ok', text: `✓ Bağlı: alarmlar @${st.botUsername ?? ''} üzerinden ${st.chatName || 'Telegram hesabına'} gidiyor.` }),
      intro,
      h(
        'div',
        { class: 'modal-actions' },
        h('button', { class: 'btn', type: 'button', text: 'Bağlantıyı kaldır', onclick: () => void removeConfig() }),
        test,
      ),
    );
  };

  const removeConfig = async () => {
    try {
      await api('DELETE', '/telegram');
      toast('Telegram', 'Bağlantı kaldırıldı, anahtar sunucudan silindi.');
      renderSetup();
    } catch (e) {
      toast('Telegram', e instanceof Error ? e.message : String(e), 'error');
    }
  };

  show(h('p', { class: 'muted', text: 'Yükleniyor…' }));
  void render();
}
