// Telegram botu: alarm bildirimlerini gönderir.
// Bot anahtarı (token) yalnızca sunucudaki veri klasöründe durur; API yanıtlarında ve loglarda asla yer almaz.
// Bağlama: uygulama tek seferlik bir kodla t.me/<bot>?start=<kod> bağlantısı verir; yalnızca bu kodla
// "Başlat"a basan sohbet kaydedilir (botun adını bilen başkası bağlanamaz).
import { randomBytes } from 'node:crypto';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { readJsonFile, writeJsonFile } from './store.ts';

interface TelegramConfig {
  token: string;
  botName: string;
  botUsername: string;
  chatId: number | null;
  chatName: string;
  linkCode: string;
  /** Mesajlardaki "uygulamayı aç" bağlantısı */
  appUrl: string;
}

export interface TelegramStatus {
  configured: boolean;
  linked: boolean;
  botName?: string;
  botUsername?: string;
  chatName?: string;
  /** Henüz bağlanmadıysa: Telegram'da açılacak bağlantı */
  linkUrl?: string;
}

interface TgUpdate {
  update_id: number;
  message?: { text?: string; chat: { id: number; first_name?: string }; from?: { first_name?: string } };
}

const LINK_WAIT_MS = 30 * 60_000;
const TOKEN_RE = /^\d{5,}:[A-Za-z0-9_-]{30,}$/;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class Telegram {
  private readonly file: string;
  private cfg: TelegramConfig | null;
  private polling = false;
  private offset = 0;
  private stopped = false;

  constructor(dir: string) {
    this.file = join(dir, 'telegram.json');
    this.cfg = readJsonFile<TelegramConfig | null>(this.file, null);
    this.resumeLink();
  }

  get linked(): boolean {
    return !!this.cfg && this.cfg.chatId !== null;
  }

  get appUrl(): string {
    return this.cfg?.appUrl ?? '';
  }

  status(): TelegramStatus {
    const c = this.cfg;
    if (!c) return { configured: false, linked: false };
    return {
      configured: true,
      linked: c.chatId !== null,
      botName: c.botName,
      botUsername: c.botUsername,
      chatName: c.chatId !== null ? c.chatName : undefined,
      linkUrl: c.chatId === null ? `https://t.me/${c.botUsername}?start=${c.linkCode}` : undefined,
    };
  }

  /** Hata metinlerinde anahtar geçerse gizler. */
  sanitize(text: string): string {
    const t = this.cfg?.token;
    return t ? text.split(t).join('***') : text;
  }

  private async call(method: string, params: Record<string, unknown>, token = this.cfg?.token): Promise<unknown> {
    if (!token) throw new Error('Telegram ayarlı değil');
    let res: Response;
    try {
      res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
        signal: AbortSignal.timeout(method === 'getUpdates' ? 40000 : 15000),
      });
    } catch {
      throw new Error('Telegram’a ulaşılamadı');
    }
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: unknown; description?: string };
    if (!body.ok) throw new Error(body.description ? `Telegram: ${body.description}` : `Telegram hatası (${res.status})`);
    return body.result;
  }

  /** Yeni bot anahtarı: doğrular, kaydeder ve bağlantı kodunu dinlemeye başlar. */
  async configure(token: string, appUrl: string): Promise<TelegramStatus> {
    if (!TOKEN_RE.test(token)) {
      throw new Error('Anahtar biçimi tanınmadı. BotFather’ın verdiği “123456789:AA…” biçimindeki anahtarı yapıştır.');
    }
    const me = (await this.call('getMe', {}, token)) as { first_name?: string; username?: string };
    if (!me.username) throw new Error('Bot bilgisi alınamadı');
    this.cfg = {
      token,
      botName: me.first_name ?? me.username,
      botUsername: me.username,
      chatId: null,
      chatName: '',
      linkCode: randomBytes(12).toString('base64url'),
      appUrl,
    };
    this.save();
    this.offset = 0;
    this.resumeLink();
    return this.status();
  }

  async send(text: string): Promise<void> {
    const c = this.cfg;
    if (!c || c.chatId === null) throw new Error('Telegram bağlı değil');
    await this.call('sendMessage', { chat_id: c.chatId, text, disable_web_page_preview: true });
  }

  remove(): void {
    this.cfg = null;
    rmSync(this.file, { force: true });
  }

  stop(): void {
    this.stopped = true;
  }

  /** Bağlantı bekleniyorsa (ör. sunucu yeniden başladıysa) "Başlat" mesajını dinlemeye (yeniden) başlar. */
  resumeLink(): void {
    if (this.cfg && this.cfg.chatId === null) void this.pollLink();
  }

  private save(): void {
    if (this.cfg) writeJsonFile(this.file, this.cfg);
  }

  private async pollLink(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    const deadline = Date.now() + LINK_WAIT_MS;
    try {
      while (!this.stopped && this.cfg && this.cfg.chatId === null && Date.now() < deadline) {
        const cfg = this.cfg;
        let updates: TgUpdate[];
        try {
          updates = (await this.call('getUpdates', { offset: this.offset, timeout: 25, allowed_updates: ['message'] })) as TgUpdate[];
        } catch {
          await sleep(5000);
          continue;
        }
        for (const u of updates) {
          this.offset = u.update_id + 1;
          const msg = u.message;
          const text = msg?.text?.trim() ?? '';
          if (!msg || this.cfg !== cfg) continue;
          if (text === `/start ${cfg.linkCode}`) {
            cfg.chatId = msg.chat.id;
            cfg.chatName = msg.from?.first_name ?? msg.chat.first_name ?? '';
            this.save();
            await this.send('✅ Grafik Terminali bağlandı. Fiyat alarmların bundan sonra buraya gelecek.').catch(() => {});
            break;
          }
          if (text.startsWith('/start')) {
            await this.call('sendMessage', {
              chat_id: msg.chat.id,
              text: 'Bağlanmak için Grafik Terminali’ndeki “Telegram’da aç” bağlantısını kullan.',
            }).catch(() => {});
          }
        }
      }
    } finally {
      this.polling = false;
    }
  }
}
