// Gerçek logaritmik fiyat ekseni (TradingView gibi log10(fiyat)).
// KLineChart'ın hazır "logarithm" ekseni log(1 + fiyat) kullanıyor, çizgileri düz aralıklarla (0, 500, 1000…)
// koyuyor ve ekseni fareyle sürükleyince ölçeği düz fiyat üzerinden büyütüyor (alt sınır eksiye düşüp ölçek fırlıyor).
//
// Çözüm: bu eksenin aralığı (from/to) doğrudan log10(fiyat) biriminde tutulur. Kütüphane yakınlaştırma ve
// kaydırmayı aralık üzerinden yaptığı için ikisi de kendiliğinden logaritmik olur. Fiyat → piksel dönüşümü
// eksen nesnesinin convertToPixel / convertFromPixel yöntemlerinde log'a çevrilir.
import { registerYAxis, type AxisRange, type AxisTick, type YAxis } from 'klinecharts';
import { toTurkishNumber } from './chart.ts';
import { logTicks, tickDecimals } from './logTicks.ts';

export const LOG_AXIS = 'gtLog';

/** Sıfır ve eksi değerler log'da tanımsız: en küçük pozitif değere sabitlenir. */
const FLOOR = 1e-12;
const lg = (v: number) => Math.log10(Math.max(v, FLOOR));

let precisionOf: () => number = () => 2;
let tickTextSize = 12;
let registered = false;

const PATCHED = Symbol('gtLogPatched');
type PatchableAxis = YAxis & { [PATCHED]?: boolean };

/** Eksen nesnesinde fiyat ↔ piksel dönüşümünü log10 üzerinden yapar (bir kez). */
function patchAxis(axis: PatchableAxis): void {
  if (axis[PATCHED]) return;
  axis[PATCHED] = true;
  const proto = Object.getPrototypeOf(axis) as YAxis;
  axis.convertToPixel = (value: number) => proto.convertToPixel.call(axis, lg(value));
  axis.convertFromPixel = (px: number) => 10 ** proto.convertFromPixel.call(axis, px);
}

/** getPrecision: açık sembolün ondalık sayısı; textSize: eksen yazı boyutu (etiket aralığı için). */
export function registerLogAxis(getPrecision: () => number, textSize = 12): void {
  precisionOf = getPrecision;
  tickTextSize = textSize;
  if (registered) return;
  registered = true;
  const id = (v: number) => v;
  registerYAxis({
    name: LOG_AXIS,
    // Neredeyse düz veride aralık en az %0,05 olsun (log biriminde).
    minSpan: () => 0.0002,
    // Aralık zaten log biriminde: kütüphanenin iç dönüşümleri birebir.
    valueToRealValue: id,
    realValueToValue: id,
    realValueToDisplayValue: id,
    displayValueToRealValue: id,
    createRange: function (this: unknown, { defaultRange }): AxisRange {
      patchAxis(this as PatchableAxis);
      // Kütüphane görünen mumların en düşük / en yüksek fiyatını verir.
      let { from, to } = defaultRange;
      if (!(to > 0)) to = 1;
      // Veride 0 ya da eksi değer varsa (bozuk veri) ölçek sonsuza kaymasın.
      if (!(from > 0)) from = to / 1000;
      const a = lg(from);
      const b = lg(to);
      return { from: a, to: b, range: b - a, realFrom: a, realTo: b, realRange: b - a, displayFrom: a, displayTo: b, displayRange: b - a };
    },
    createTicks: function (this: unknown, { range, bounding }): AxisTick[] {
      const axis = this as PatchableAxis;
      patchAxis(axis);
      const minGap = Math.max(34, tickTextSize * 2.8);
      const values = logTicks(range.realFrom, range.realTo, bounding.height, minGap, tickTextSize);
      const prec = precisionOf();
      return values.map((v) => ({ value: v, text: toTurkishNumber(v.toFixed(tickDecimals(v, prec))), coord: axis.convertToPixel(v) }));
    },
  });
}
