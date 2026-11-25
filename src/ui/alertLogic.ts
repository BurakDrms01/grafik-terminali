/** Fiyat alarmı. Yön kurulduğu andaki fiyata göre belirlenir: seviye üstteyse "up". */
export type AlertDir = 'up' | 'down';

export interface Alert {
  id: string;
  symbolId: string;
  symbolName: string;
  price: number;
  dir: AlertDir;
  createdAt: number;
  triggeredAt: number | null;
  triggerPrice: number | null;
}

export function directionFor(currentPrice: number, level: number): AlertDir {
  return level >= currentPrice ? 'up' : 'down';
}

/**
 * Yukarı alarm fiyat seviyeye ulaşınca ya da geçince, aşağı alarm seviyeye inince ya da altına
 * düşünce tetiklenir. Arada kaçan fiyat güncellemeleri (boşluklu hareket) de yakalanır.
 */
export function isHit(alert: Pick<Alert, 'dir' | 'price'>, price: number): boolean {
  return alert.dir === 'up' ? price >= alert.price : price <= alert.price;
}

/** Bu sembolün henüz tetiklenmemiş ve bu fiyatla tetiklenen alarmları. */
export function collectHits(alerts: Alert[], symbolId: string, price: number): Alert[] {
  return alerts.filter((a) => a.symbolId === symbolId && a.triggeredAt === null && isHit(a, price));
}

/** Fiyatı alarm seviyesinin ondalık sayısıyla (en az 2) Türkçe biçimde yazar: 1.234,50 */
function fmtLike(value: number, reference: number): string {
  const decimals = Math.min(8, Math.max(2, (String(reference).split('.')[1] ?? '').length));
  return new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: decimals }).format(value);
}

/** Telegram'a gönderilen alarm mesajı. appUrl verilirse uygulamayı açan bağlantı da eklenir. */
export function alertMessage(alert: Pick<Alert, 'symbolName' | 'price' | 'dir'>, price: number, appUrl = ''): string {
  const up = alert.dir === 'up';
  const lines = [
    `🔔 ${alert.symbolName}: ${up ? '↑' : '↓'} ${fmtLike(alert.price, alert.price)}`,
    `${up ? 'Fiyat seviyeye çıktı' : 'Fiyat seviyeye indi'} · son fiyat ${fmtLike(price, alert.price)}`,
  ];
  if (appUrl) lines.push(appUrl);
  return lines.join('\n');
}
