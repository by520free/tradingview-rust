// 脚本沙箱内的精简技术指标库（纯函数，数组进数组出）。
// 注意：侧栏内置的 10 个指标由 Rust 核心计算；这里的 JS 版本仅服务于用户自定义脚本，
// 让脚本能用任意参数自由组合（如 ta.sma(close, 7)）。两者定位不同。

export type Series = (number | null)[];
export const na = NaN;

const num = (x: unknown): number => (typeof x === "number" ? x : NaN);

/** 简单移动平均 */
export function sma(src: Series, period = 14): Series {
  const out: Series = new Array(src.length).fill(null);
  const p = Math.max(1, Math.floor(period));
  let sum = 0;
  for (let i = 0; i < src.length; i++) {
    const v = num(src[i]);
    sum += v;
    if (i >= p) sum -= num(src[i - p]);
    if (i + 1 >= p) out[i] = sum / p;
  }
  return out;
}

/** 指数移动平均 */
export function ema(src: Series, period = 14): Series {
  const out: Series = new Array(src.length).fill(null);
  const p = Math.max(1, Math.floor(period));
  const k = 2 / (p + 1);
  let seed = 0;
  let count = 0;
  for (let i = 0; i < p && i < src.length; i++) {
    const v = num(src[i]);
    if (!Number.isNaN(v)) { seed += v; count++; }
  }
  if (count === 0) return out;
  let prev = seed / count;
  out[p - 1] = prev;
  for (let i = p; i < src.length; i++) {
    const v = num(src[i]);
    prev = (Number.isNaN(v) ? prev : v) * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** 相对强弱指标 */
export function rsi(src: Series, period = 14): Series {
  const out: Series = new Array(src.length).fill(null);
  const p = Math.max(1, Math.floor(period));
  let gain = 0, loss = 0;
  for (let i = 1; i <= p && i < src.length; i++) {
    const d = num(src[i]) - num(src[i - 1]);
    if (d > 0) gain += d; else loss -= d;
  }
  let ag = gain / p, al = loss / p;
  out[p] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  for (let i = p + 1; i < src.length; i++) {
    const d = num(src[i]) - num(src[i - 1]);
    const g = d > 0 ? d : 0, l = d < 0 ? -d : 0;
    ag = (ag * (p - 1) + g) / p;
    al = (al * (p - 1) + l) / p;
    out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  }
  return out;
}

/** 布林带：返回 { upper, mid, lower } */
export function boll(src: Series, period = 20, mult = 2) {
  const mid = sma(src, period);
  const upper: Series = new Array(src.length).fill(null);
  const lower: Series = new Array(src.length).fill(null);
  const p = Math.max(1, Math.floor(period));
  for (let i = p - 1; i < src.length; i++) {
    const m = mid[i];
    if (m == null) continue;
    let variance = 0;
    for (let j = i + 1 - p; j <= i; j++) variance += (num(src[j]) - m) ** 2;
    const sd = Math.sqrt(variance / p);
    upper[i] = m + mult * sd;
    lower[i] = m - mult * sd;
  }
  return { upper, mid, lower };
}

/** MACD：返回 { dif, dea, hist } */
export function macd(src: Series, fast = 12, slow = 26, signal = 9) {
  const ef = ema(src, fast), es = ema(src, slow);
  const dif: Series = src.map((_, i) =>
    ef[i] != null && es[i] != null ? (ef[i] as number) - (es[i] as number) : null);
  const flat: Series = dif.map((v) => v ?? 0);
  const deaRaw = ema(flat, signal);
  const dea: Series = dif.map((v, i) => (v != null ? deaRaw[i] : null));
  const hist: Series = dif.map((v, i) =>
    v != null && dea[i] != null ? (v - (dea[i] as number)) * 2 : null);
  return { dif, dea, hist };
}

/** 真实波幅均值 */
export function atr(bars: { high: number; low: number; close: number }[], period = 14): Series {
  const out: Series = new Array(bars.length).fill(null);
  const p = Math.max(1, Math.floor(period));
  if (bars.length <= p) return out;
  const tr: number[] = new Array(bars.length).fill(0);
  for (let i = 1; i < bars.length; i++) {
    tr[i] = Math.max(
      bars[i].high - bars[i].low,
      Math.abs(bars[i].high - bars[i - 1].close),
      Math.abs(bars[i].low - bars[i - 1].close),
    );
  }
  let prev = 0;
  for (let i = 1; i <= p; i++) prev += tr[i];
  prev /= p;
  out[p] = prev;
  for (let i = p + 1; i < bars.length; i++) {
    prev = (prev * (p - 1) + tr[i]) / p;
    out[i] = prev;
  }
  return out;
}

/** 随机指标 KDJ：返回 { k, d, j } */
export function kdj(bars: { high: number; low: number; close: number }[], period = 9) {
  const n = bars.length;
  const kLine: Series = new Array(n).fill(null);
  const dLine: Series = new Array(n).fill(null);
  const jLine: Series = new Array(n).fill(null);
  const p = Math.max(1, Math.floor(period));
  let k = 50, d = 50;
  for (let i = p - 1; i < n; i++) {
    let highest = -Infinity, lowest = Infinity;
    for (let j = i + 1 - p; j <= i; j++) {
      highest = Math.max(highest, bars[j].high);
      lowest = Math.min(lowest, bars[j].low);
    }
    const rsv = highest === lowest ? 50 : ((bars[i].close - lowest) / (highest - lowest)) * 100;
    k = (2 / 3) * k + (1 / 3) * rsv;
    d = (2 / 3) * d + (1 / 3) * k;
    kLine[i] = k; dLine[i] = d; jLine[i] = 3 * k - 2 * d;
  }
  return { k: kLine, d: dLine, j: jLine };
}

/** 上穿：a 由下方穿越 b */
export function crossAbove(a: Series, b: Series): boolean[] {
  return a.map((_, i) => {
    if (i === 0) return false;
    const pa = a[i - 1], pb = b[i - 1], ca = a[i], cb = b[i];
    if (pa == null || pb == null || ca == null || cb == null) return false;
    return (pa as number) <= (pb as number) && (ca as number) > (cb as number);
  });
}

/** 下穿：a 由上方穿越 b */
export function crossBelow(a: Series, b: Series): boolean[] {
  return a.map((_, i) => {
    if (i === 0) return false;
    const pa = a[i - 1], pb = b[i - 1], ca = a[i], cb = b[i];
    if (pa == null || pb == null || ca == null || cb == null) return false;
    return (pa as number) >= (pb as number) && (ca as number) < (cb as number);
  });
}

/** 最高值 */
export function highest(src: Series, period: number): Series {
  const out: Series = new Array(src.length).fill(null);
  const p = Math.max(1, Math.floor(period));
  for (let i = p - 1; i < src.length; i++) {
    let m = -Infinity;
    for (let j = i + 1 - p; j <= i; j++) m = Math.max(m, num(src[j]));
    out[i] = m;
  }
  return out;
}

/** 最低值 */
export function lowest(src: Series, period: number): Series {
  const out: Series = new Array(src.length).fill(null);
  const p = Math.max(1, Math.floor(period));
  for (let i = p - 1; i < src.length; i++) {
    let m = Infinity;
    for (let j = i + 1 - p; j <= i; j++) m = Math.min(m, num(src[j]));
    out[i] = m;
  }
  return out;
}
