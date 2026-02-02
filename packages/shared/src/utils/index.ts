import { PRICING } from '../constants.js';

declare const crypto: { randomUUID(): string };

export function generateId(): string {
  return crypto.randomUUID();
}

export function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

export function calculateCost(input: {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}): number {
  const cost =
    (input.inputTokens / 1_000_000) * PRICING.inputPerMillion +
    (input.outputTokens / 1_000_000) * PRICING.outputPerMillion +
    ((input.cacheReadTokens ?? 0) / 1_000_000) * PRICING.cacheReadPerMillion +
    ((input.cacheWriteTokens ?? 0) / 1_000_000) * PRICING.cacheWritePerMillion;
  return Math.round(cost * 1_000_000) / 1_000_000;
}

export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}
