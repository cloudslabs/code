import { useTokenUsageStore } from '../../stores/token-usage-store.js';

export function UsageSummaryCards() {
  const { totals, dateRange } = useTokenUsageStore();

  if (!totals) return null;

  const daysInRange = dateRange === '7d' ? 7 : dateRange === '30d' ? 30 : dateRange === '90d' ? 90 : null;
  const avgTokensPerDay = daysInRange && daysInRange > 0
    ? Math.round(totals.totalTokens / daysInRange)
    : null;

  return (
    <div className="grid grid-cols-3 gap-3">
      <SummaryCard
        label="Total Tokens"
        value={totals.totalTokens.toLocaleString()}
      />
      <SummaryCard
        label="Total Cost"
        value={`$${totals.costUsd.toFixed(4)}`}
      />
      {avgTokensPerDay !== null ? (
        <SummaryCard
          label="Avg Tokens/Day"
          value={avgTokensPerDay.toLocaleString()}
        />
      ) : (
        <SummaryCard
          label="API Calls"
          value={totals.recordCount.toLocaleString()}
        />
      )}
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-zinc-800/50 rounded-lg px-3 py-2.5">
      <div className="text-zinc-500 text-xs mb-1">{label}</div>
      <div className="text-zinc-200 font-mono text-sm">{value}</div>
    </div>
  );
}
