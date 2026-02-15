interface FunnelStage {
  name: string;
  value: number;
  color: string;
}

interface FunnelChartProps {
  data: FunnelStage[];
}

export default function FunnelChart({ data }: FunnelChartProps) {
  const maxValue = Math.max(...data.map((d) => d.value), 1);

  return (
    <div className="space-y-3">
      {data.map((stage, index) => {
        const widthPercent = Math.max((stage.value / maxValue) * 100, 8);
        const previousValue = index > 0 ? data[index - 1].value : null;
        const dropOff =
          previousValue && previousValue > 0
            ? (((previousValue - stage.value) / previousValue) * 100).toFixed(1)
            : null;

        return (
          <div key={stage.name}>
            {/* Drop-off indicator */}
            {dropOff && Number(dropOff) > 0 && (
              <div className="flex items-center gap-2 mb-1 ml-4">
                <svg className="w-3 h-3 text-gray-400" viewBox="0 0 12 12" fill="none">
                  <path d="M6 2v8M3 7l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span className="text-xs text-gray-400 dark:text-gray-400">
                  -{dropOff}% drop-off
                </span>
              </div>
            )}
            <div className="flex items-center gap-4">
              <div className="w-28 text-right flex-shrink-0">
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  {stage.name}
                </span>
              </div>
              <div className="flex-1 relative">
                <div
                  className="h-10 rounded-lg flex items-center px-4 transition-all duration-500"
                  style={{
                    width: `${widthPercent}%`,
                    backgroundColor: stage.color,
                    minWidth: "60px",
                  }}
                >
                  <span className="text-sm font-bold text-white">
                    {stage.value.toLocaleString()}
                  </span>
                </div>
              </div>
              {previousValue && previousValue > 0 && (
                <div className="w-16 text-right flex-shrink-0">
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    {((stage.value / previousValue) * 100).toFixed(0)}%
                  </span>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
