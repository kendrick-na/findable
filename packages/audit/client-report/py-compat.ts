// biome-ignore-all lint/suspicious/noBitwiseOperators: 부동소수점 비트를 직접 풀어야 정확한 반올림이 된다
// Python 과 **같은 숫자·같은 순서**를 내기 위한 도우미.
//
// 🔴 왜 따로 두나: 원본 build.py 의 `round()` 는 **은행가 반올림**(동률이면 짝수)이고
//   JS `Math.round` 는 동률이면 올림이다. 예: Python round(2.5)=2 / JS Math.round(2.5)=3.
//   리포트의 비율(정확 인식률 등)이 1%p 라도 달라지면 PDF 와 웹이 서로 다른 숫자를 말한다.
//   → 부동소수점 값을 **정확한 유리수**로 풀어서 Python 과 똑같이 반올림한다.

/** Python 3 `round(x, ndigits)` 와 같은 결과. ndigits=0 이면 정수. */
export function pyRound(x: number, ndigits = 0): number {
  if (!Number.isFinite(x) || x === 0) {
    return x;
  }
  const negative = x < 0;
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, Math.abs(x));
  const hi = view.getUint32(0);
  const lo = view.getUint32(4);
  const expBits = (hi >>> 20) & 0x7_ff;
  let mantissa = (BigInt(hi & 0xf_ff_ff) << 32n) | BigInt(lo);
  let exponent: number;
  if (expBits === 0) {
    exponent = -1074;
  } else {
    mantissa |= 1n << 52n;
    exponent = expBits - 1075;
  }
  // |x| = mantissa * 2^exponent (정확한 값)
  let numerator = mantissa * 10n ** BigInt(ndigits);
  let denominator = 1n;
  if (exponent >= 0) {
    numerator <<= BigInt(exponent);
  } else {
    denominator <<= BigInt(-exponent);
  }
  let quotient = numerator / denominator;
  const twiceRemainder = 2n * (numerator - quotient * denominator);
  if (
    twiceRemainder > denominator ||
    (twiceRemainder === denominator && (quotient & 1n) === 1n)
  ) {
    quotient += 1n;
  }
  const out = Number(ndigits > 0 ? `${quotient}e-${ndigits}` : `${quotient}`);
  return negative ? -out : out;
}

/** Python `str(float)` — 정수값 실수는 `10.0` 처럼 소수점을 붙인다. */
export function pyFloatStr(x: number): string {
  return Number.isInteger(x) ? x.toFixed(1) : String(x);
}

/** Python `sorted()` 의 문자열 비교(코드포인트 순). */
export function pyCompareStrings(a: string, b: string): number {
  const ac = Array.from(a);
  const bc = Array.from(b);
  const len = Math.min(ac.length, bc.length);
  for (let i = 0; i < len; i++) {
    const d = (ac[i].codePointAt(0) ?? 0) - (bc[i].codePointAt(0) ?? 0);
    if (d !== 0) {
      return d;
    }
  }
  return ac.length - bc.length;
}
