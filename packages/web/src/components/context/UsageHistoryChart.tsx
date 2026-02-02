import { useEffect } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import type { UsageGranularity } from '@cloudscode/shared';
import { useTokenUsageStore } from '../../stores/token-usage-store.js';
import { useProjectStore } from '../../stores/project-store.js';

type DateRangePreset = '7d' | '30d' | '90d' | 'all';

const granularityOptions: { value: UsageGranularity; label: string }[] = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
];

const dateRangeOptions: { value: DateRangePreset; label: string }[] = [
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
  { value: 'all', label: 'All time' },
];

function formatDate(timestamp: number, granularity: UsageGranularity): string {
  const date = new Date(timestamp * 1000);
  if (granularity === 'monthly') {
    return date.toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
  }
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

export function UsageHistoryChart() {
  const activeProject = useProjectStore((s) => s.activeProject);
  const { history, granularity, dateRange, isLoading, setGranularity, setDateRange, fetchHistory } = useTokenUsageStore();

  useEffect(() => {
    if (activeProject?.id) {
      fetchHistory(activeProject.id);
    }
  }, [activeProject?.id, granularity, dateRange, fetchHistory]);

  const chartData = (history?.buckets ?? []).map((b) => ({
    date: formatDate(b.periodStart, granularity),
    timestamp: b.periodStart,
    Input: b.inputTokens,
    Output: b.outputTokens,
    'Cache Read': b.cacheReadTokens,
    'Cache Write': b.cacheWriteTokens,
  }));

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-500">Period:</span>
          <div className="flex rounded-md overflow-hidden border border-zinc-700">
            {granularityOptions.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setGranularity(opt.value)}
                className={`px-2.5 py-1 text-xs transition-colors ${
                  granularity === opt.value
                    ? 'bg-zinc-700 text-zinc-100'
                    : 'bg-zinc-800/50 text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-500">Range:</span>
          <div className="flex rounded-md overflow-hidden border border-zinc-700">
            {dateRangeOptions.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setDateRange(opt.value)}
                className={`px-2.5 py-1 text-xs transition-colors ${
                  dateRange === opt.value
                    ? 'bg-zinc-700 text-zinc-100'
                    : 'bg-zinc-800/50 text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Chart */}
      {isLoading ? (
        <div className="flex items-center justify-center h-64 text-zinc-500 text-sm">Loading...</div>
      ) : chartData.length === 0 ? (
        <div className="flex items-center justify-center h-64 text-zinc-500 text-sm">
          No usage data yet. Send messages to start tracking.
        </div>
      ) : (
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 5, right: 5, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#3f3f46" />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#a1a1aa' }} />
              <YAxis tickFormatter={formatTokens} tick={{ fontSize: 11, fill: '#a1a1aa' }} width={50} />
              <Tooltip
                contentStyle={{ backgroundColor: '#18181b', border: '1px solid #3f3f46', borderRadius: '8px', fontSize: '12px' }}
                labelStyle={{ color: '#e4e4e7' }}
                formatter={(value: number | undefined) => value != null ? [value.toLocaleString(), undefined] : ['0', undefined]}
              />
              <Legend wrapperStyle={{ fontSize: '11px' }} />
              <Area type="monotone" dataKey="Input" stackId="1" stroke="#60a5fa" fill="#60a5fa" fillOpacity={0.4} />
              <Area type="monotone" dataKey="Output" stackId="1" stroke="#4ade80" fill="#4ade80" fillOpacity={0.4} />
              <Area type="monotone" dataKey="Cache Read" stackId="1" stroke="#fbbf24" fill="#fbbf24" fillOpacity={0.4} />
              <Area type="monotone" dataKey="Cache Write" stackId="1" stroke="#c084fc" fill="#c084fc" fillOpacity={0.4} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
