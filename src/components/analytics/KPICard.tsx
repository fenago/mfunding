import { ArrowTrendingUpIcon, ArrowTrendingDownIcon } from "@heroicons/react/24/outline";

interface KPICardProps {
  label: string;
  value: string | number;
  subValue?: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  trend?: { direction: "up" | "down" | "flat"; percentage: number };
  format?: "number" | "currency" | "percent" | "days";
}

const COLOR_RGB: Record<string, string> = {
  "bg-blue-500": "59, 130, 246",
  "bg-purple-500": "168, 85, 247",
  "bg-orange-500": "249, 115, 22",
  "bg-green-500": "34, 197, 94",
  "bg-emerald-500": "16, 185, 129",
  "bg-teal-500": "20, 184, 166",
  "bg-indigo-500": "99, 102, 241",
  "bg-cyan-500": "6, 182, 212",
  "bg-red-500": "239, 68, 68",
};

function formatValue(value: string | number, format?: string): string {
  if (typeof value === "string") return value;

  switch (format) {
    case "currency":
      return value >= 1000000
        ? `$${(value / 1000000).toFixed(1)}M`
        : value >= 1000
        ? `$${(value / 1000).toFixed(1)}K`
        : `$${value.toLocaleString()}`;
    case "percent":
      return `${value.toFixed(1)}%`;
    case "days":
      return `${value.toFixed(1)}d`;
    default:
      return value >= 1000 ? `${(value / 1000).toFixed(1)}K` : value.toLocaleString();
  }
}

export default function KPICard({
  label,
  value,
  subValue,
  icon: Icon,
  color,
  trend,
  format,
}: KPICardProps) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-200 dark:border-gray-700">
      <div className="flex items-center justify-between mb-3">
        <div
          className="p-2.5 rounded-lg"
          style={{ backgroundColor: `rgba(${COLOR_RGB[color] || "59, 130, 246"}, 0.15)` }}
        >
          <Icon className={`w-5 h-5 ${color.replace("bg-", "text-")}`} />
        </div>
        {trend && trend.percentage > 0 && (
          <div
            className={`flex items-center gap-1 text-xs font-medium ${
              trend.direction === "up" ? "text-green-600" : trend.direction === "down" ? "text-red-600" : "text-gray-500"
            }`}
          >
            {trend.direction === "up" ? (
              <ArrowTrendingUpIcon className="w-3.5 h-3.5" />
            ) : trend.direction === "down" ? (
              <ArrowTrendingDownIcon className="w-3.5 h-3.5" />
            ) : null}
            {trend.percentage.toFixed(1)}%
          </div>
        )}
      </div>
      <h3 className="text-2xl font-bold text-gray-900 dark:text-white">
        {formatValue(value, format)}
      </h3>
      <p className="text-sm text-gray-500 dark:text-gray-300 mt-1">{label}</p>
      {subValue && (
        <p className="text-xs text-gray-400 dark:text-gray-400 mt-0.5">{subValue}</p>
      )}
    </div>
  );
}
