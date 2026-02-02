import { create } from 'zustand';
import type { TokenUsageHistoryResponse, UsageGranularity } from '@cloudscode/shared';
import { api } from '../lib/api-client.js';

type DateRangePreset = '7d' | '30d' | '90d' | 'all';

interface TokenUsageState {
  history: TokenUsageHistoryResponse | null;
  totals: TokenUsageHistoryResponse['totals'] | null;
  granularity: UsageGranularity;
  dateRange: DateRangePreset;
  isLoading: boolean;

  setGranularity: (granularity: UsageGranularity) => void;
  setDateRange: (range: DateRangePreset) => void;
  fetchHistory: (projectId: string) => Promise<void>;
}

function getFromTimestamp(range: DateRangePreset): number | undefined {
  if (range === 'all') return undefined;
  const now = Math.floor(Date.now() / 1000);
  const days = range === '7d' ? 7 : range === '30d' ? 30 : 90;
  return now - days * 86400;
}

export const useTokenUsageStore = create<TokenUsageState>((set, get) => ({
  history: null,
  totals: null,
  granularity: 'daily',
  dateRange: '30d',
  isLoading: false,

  setGranularity: (granularity) => set({ granularity }),
  setDateRange: (dateRange) => set({ dateRange }),

  fetchHistory: async (projectId: string) => {
    const { granularity, dateRange } = get();
    set({ isLoading: true });
    try {
      const from = getFromTimestamp(dateRange);
      const [history, summaryRes] = await Promise.all([
        api.getTokenUsageHistory(projectId, granularity, from),
        api.getTokenUsageSummary(projectId, from),
      ]);
      set({ history, totals: summaryRes.totals, isLoading: false });
    } catch {
      set({ isLoading: false });
    }
  },
}));
