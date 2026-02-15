import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import type { LeadSourceData } from "../../types/analytics";

interface LeadSourcePieChartProps {
  data: LeadSourceData[];
  height?: number;
}

const COLORS = [
  "#007EA7", "#00A896", "#00D49D", "#0C516E",
  "#F59E0B", "#8B5CF6", "#EF4444", "#EC4899",
  "#6366F1",
];

export default function LeadSourcePieChart({
  data,
  height = 280,
}: LeadSourcePieChartProps) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center text-gray-400 text-sm" style={{ height }}>
        No data available
      </div>
    );
  }

  const chartData = data.map((d) => ({
    name: d.label,
    value: d.count,
  }));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie
          data={chartData}
          cx="50%"
          cy="50%"
          innerRadius={60}
          outerRadius={95}
          paddingAngle={2}
          dataKey="value"
          label={({ name, percent }: { name?: string; percent?: number }) =>
            `${name || ""} ${((percent || 0) * 100).toFixed(0)}%`
          }
          labelLine={{ stroke: "#8B949E", strokeWidth: 1 }}
        >
          {chartData.map((_, index) => (
            <Cell
              key={`cell-${index}`}
              fill={COLORS[index % COLORS.length]}
            />
          ))}
        </Pie>
        <Tooltip
          contentStyle={{
            backgroundColor: "#21262D",
            border: "1px solid #30363D",
            borderRadius: "8px",
            fontSize: "12px",
            color: "#F0F6FC",
          }}
          formatter={(value: number | undefined) => [(value ?? 0).toLocaleString(), "Leads"]}
        />
        <Legend
          wrapperStyle={{ fontSize: "12px", color: "#8B949E" }}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}
