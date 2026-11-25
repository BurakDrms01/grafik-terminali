// Logaritmik fiyat ekseni için TradingView'daki gibi "yuvarlak" çizgi değerleri (1, 2, 5, 10, 20, 50, 100…).
// Saf hesap: ekranda birbirine minGap pikselden yakın iki etiket olmaz, önce en yuvarlak değerler seçilir.

/** realFrom/realTo: log10(fiyat) cinsinden görünen aralık; height: eksen yüksekliği (px). */
export function logTicks(realFrom: number, realTo: number, height: number, minGap: number, edge = 0): number[] {
  const realRange = realTo - realFrom;
  if (!(realRange > 0) || !(height > 0) || !Number.isFinite(realFrom) || !Number.isFinite(realTo)) return [];
  const pxPerReal = height / realRange;
  const yOf = (v: number) => (realTo - Math.log10(v)) * pxPerReal;
  const vMin = 10 ** realFrom;
  const vMax = 10 ** realTo;
  // Dar aralıkta (fiyat 4 katından az değişiyorsa) log ölçek neredeyse düzdür: eşit adımlı çizgiler.
  if (realRange < Math.log10(4)) return uniformTicks(vMin, vMax, pxPerReal, minGap, (v) => yOf(v) >= edge && yOf(v) <= height - edge);
  const ys: number[] = [];
  const out: number[] = [];
  const fits = (y: number) => y >= edge && y <= height - edge && ys.every((t) => Math.abs(t - y) >= minGap);

  // Adımlar büyükten küçüğe: 10^k, 5·10^(k-1), 2·10^(k-1), 10^(k-1)…
  let exp = Math.ceil(realTo);
  const mults = [1, 0.5, 0.2];
  for (let guard = 0; guard < 60; guard++) {
    for (const m of mults) {
      const step = m * 10 ** exp;
      // Bu adımın etiketleri ancak fiyatın şu değerin altındaki bölgede minGap kadar ayrık durur.
      const vUpper = Math.min(vMax, (step * pxPerReal) / (Math.LN10 * minGap));
      if (vUpper < vMin) {
        if (out.length > 0 || step < vMin * 1e-9) return out.sort((a, b) => a - b);
        continue;
      }
      const first = Math.ceil(vMin / step - 1e-9);
      const last = Math.floor(vUpper / step + 1e-9);
      for (let i = first; i <= last && i - first < 500; i++) {
        const v = round(i * step);
        if (v <= 0 || out.includes(v)) continue;
        const y = yOf(v);
        if (fits(y)) {
          ys.push(y);
          out.push(v);
        }
      }
    }
    exp--;
  }
  return out.sort((a, b) => a - b);
}

/** En sık eşit adım: en yukarıdaki (en sıkışık) iki etiket bile minGap kadar ayrık olmalı. */
function uniformTicks(vMin: number, vMax: number, pxPerReal: number, minGap: number, inside: (v: number) => boolean): number[] {
  let exp = Math.floor(Math.log10(vMax - vMin)) - 3;
  for (let guard = 0; guard < 40; guard++, exp++) {
    for (const m of [1, 2, 2.5, 5]) {
      const step = m * 10 ** exp;
      const below = vMax - step;
      const px = below > 0 ? (Math.log10(vMax) - Math.log10(below)) * pxPerReal : Infinity;
      if (px < minGap) continue;
      const out: number[] = [];
      for (let i = Math.ceil(vMin / step - 1e-9); i * step <= vMax * (1 + 1e-12) && out.length < 200; i++) {
        const v = round(i * step);
        if (v > 0 && inside(v)) out.push(v);
      }
      return out;
    }
  }
  return [];
}

/** Kayan nokta artıklarını temizler (0.30000000000000004 → 0.3). */
function round(v: number): number {
  return Number(v.toPrecision(12));
}

/** Etiket için ondalık basamak: fiyatın kendi hassasiyeti, ama 0,0005 gibi değerler kaybolmasın. */
export function tickDecimals(v: number, pricePrecision: number): number {
  let d = 0;
  while (d < 10 && Math.abs(v - Number(v.toFixed(d))) > 1e-12 * Math.max(1, Math.abs(v))) d++;
  return Math.max(pricePrecision, d);
}
