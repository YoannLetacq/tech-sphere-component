/**
 * React hook returning a memoized Float32Array of anchor positions
 * produced by the Fibonacci sphere sampler.
 */

import { useMemo } from 'react';
import { fibonacciSphere } from './math.js';

export function useFibonacciSphere(count, radius) {
  return useMemo(() => fibonacciSphere(count, radius), [count, radius]);
}
