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
