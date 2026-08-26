// eval/e2e — 통계 유틸 (KPI 산식)
// 의존성 없이 순수 함수. 작은 N에 맞는 robust 통계.

/** 오름차순 정렬 후 분위수 (선형 보간). 빈 배열이면 NaN. */
export function quantile(values: number[], q: number): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const next = sorted[base + 1];
  return next === undefined ? sorted[base] : sorted[base] + rest * (next - sorted[base]);
}

export function median(values: number[]): number {
  return quantile(values, 0.5);
}

export function mean(values: number[]): number {
  if (values.length === 0) return Number.NaN;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** 표본 표준편차 (n-1). N<2면 0. */
export function stdev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  const variance = values.reduce((a, x) => a + (x - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/** 변동계수 σ/μ. μ=0이면 NaN. run-to-run 분산 KPI. */
export function coefficientOfVariation(values: number[]): number {
  const m = mean(values);
  if (m === 0) return Number.NaN;
  return stdev(values) / m;
}

export interface WilsonInterval {
  rate: number;
  low: number;
  high: number;
}

/**
 * Wilson score 이항 신뢰구간 (기본 95%, z=1.96).
 * 작은 N의 완주율(binary)은 정규근사보다 Wilson이 정직하다.
 */
export function wilsonInterval(successes: number, n: number, z = 1.96): WilsonInterval {
  if (n === 0) return { rate: Number.NaN, low: Number.NaN, high: Number.NaN };
  const phat = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (phat + z2 / (2 * n)) / denom;
  const margin = (z * Math.sqrt((phat * (1 - phat)) / n + z2 / (4 * n * n))) / denom;
  return { rate: phat, low: Math.max(0, center - margin), high: Math.min(1, center + margin) };
}
