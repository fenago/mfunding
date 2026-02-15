import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { TrendDataPoint } from "../../types/analytics";

interface TrendLineChartProps {
  data: TrendDataPoint[];
  color?: string;
  height?: number;
  formatValue?: (value: number) => string;
  label?: string;
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

export default function TrendLineChart({
  data,
  color = "#007EA7",
  height = 250,
  formatValue,
  label = "Value",
}: TrendLineChartProps) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center text-gray-400 text-sm" style={{ height }}>
        No data available
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.2} />
        <XAxis
          dataKey="date"
          tickFormatter={formatDate}
          tick={{ fontSize: 11, fill: "#9CA3AF" }}
          axisLine={{ stroke: "#374151", opacity: 0.3 }}
        />
        <YAxis
          tick={{ fontSize: 11, fill: "#9CA3AF" }}
          axisLine={{ stroke: "#374151", opacity: 0.3 }}
          tickFormatter={(v) => (formatValue ? formatValue(v) : v.toLocaleString())}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: "#21262D",
            border: "1px solid #30363D",
            borderRadius: "8px",
            fontSize: "12px",
            color: "#F0F6FC",
          }}
          labelFormatter={(l) => `Date: ${l}`}
          formatter={(value: number | undefined) => [
            formatValue ? formatValue(value ?? 0) : (value ?? 0).toLocaleString(),
            label,
          ]}
        />
        <Line
          type="monotone"
          dataKey="value"
          stroke={color}
          strokeWidth={2}
          dot={{ r: 3, fill: color }}
          activeDot={{ r: 5 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
