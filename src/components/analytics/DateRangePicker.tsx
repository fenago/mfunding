import { useState } from "react";
import type { DateRange } from "../../types/analytics";

interface DateRangePickerProps {
  value: DateRange;
  onChange: (range: DateRange) => void;
}

type Preset = "today" | "this_week" | "this_month" | "this_quarter" | "this_year" | "all_time";

const PRESETS: { value: Preset; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "this_week", label: "This Week" },
  { value: "this_month", label: "This Month" },
  { value: "this_quarter", label: "This Quarter" },
  { value: "this_year", label: "YTD" },
  { value: "all_time", label: "All Time" },
];

function getPresetRange(preset: Preset): { start: Date; end: Date } {
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

  switch (preset) {
    case "today": {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      return { start, end };
    }
    case "this_week": {
      const start = new Date(now);
      start.setDate(start.getDate() - start.getDay());
      start.setHours(0, 0, 0, 0);
      return { start, end };
    }
    case "this_month": {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      return { start, end };
    }
    case "this_quarter": {
      const quarterMonth = Math.floor(now.getMonth() / 3) * 3;
      const start = new Date(now.getFullYear(), quarterMonth, 1);
      return { start, end };
    }
    case "this_year": {
      const start = new Date(now.getFullYear(), 0, 1);
      return { start, end };
    }
    case "all_time":
    default: {
      const start = new Date(2020, 0, 1);
      return { start, end };
    }
  }
}

export function getDefaultDateRange(): DateRange {
  const { start, end } = getPresetRange("all_time");
  return { start, end, preset: "all_time" };
}

export default function DateRangePicker({ value, onChange }: DateRangePickerProps) {
  const [showCustom, setShowCustom] = useState(false);

  const handlePresetClick = (preset: Preset) => {
    setShowCustom(false);
    const { start, end } = getPresetRange(preset);
    onChange({ start, end, preset });
  };

  const handleCustomStart = (dateStr: string) => {
    const start = new Date(dateStr);
    onChange({ start, end: value.end, preset: "custom" });
  };

  const handleCustomEnd = (dateStr: string) => {
    const end = new Date(dateStr);
    end.setHours(23, 59, 59, 999);
    onChange({ start: value.start, end, preset: "custom" });
  };

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="flex bg-gray-100 dark:bg-gray-700 rounded-lg p-0.5">
        {PRESETS.map((preset) => (
          <button
            key={preset.value}
            onClick={() => handlePresetClick(preset.value)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              value.preset === preset.value
                ? "bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm"
                : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
            }`}
          >
            {preset.label}
          </button>
        ))}
        <button
          onClick={() => {
            setShowCustom(!showCustom);
            if (!showCustom) {
              onChange({ ...value, preset: "custom" });
            }
          }}
          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
            value.preset === "custom"
              ? "bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm"
              : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
          }`}
        >
          Custom
        </button>
      </div>

      {(showCustom || value.preset === "custom") && (
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={value.start.toISOString().split("T")[0]}
            onChange={(e) => handleCustomStart(e.target.value)}
            className="input-field text-xs py-1.5 px-2"
          />
          <span className="text-gray-400 text-xs">to</span>
          <input
            type="date"
            value={value.end.toISOString().split("T")[0]}
            onChange={(e) => handleCustomEnd(e.target.value)}
            className="input-field text-xs py-1.5 px-2"
          />
        </div>
      )}
    </div>
  );
}
