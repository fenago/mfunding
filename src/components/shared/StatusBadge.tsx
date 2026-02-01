import { cn } from "../../lib/utils";

type StatusVariant = "default" | "dot" | "pill";
type StatusSize = "sm" | "md" | "lg";

interface StatusConfig {
  label: string;
  color: string;
  bg: string;
  dotColor?: string;
}

// Lender statuses
const LENDER_STATUS: Record<string, StatusConfig> = {
  potential: { label: "Potential", color: "text-gray-700 dark:text-gray-300", bg: "bg-gray-100 dark:bg-gray-700", dotColor: "bg-gray-400" },
  application_submitted: { label: "Applied", color: "text-blue-700 dark:text-blue-300", bg: "bg-blue-100 dark:bg-blue-900", dotColor: "bg-blue-500" },
  processing: { label: "Processing", color: "text-yellow-700 dark:text-yellow-300", bg: "bg-yellow-100 dark:bg-yellow-900", dotColor: "bg-yellow-500" },
  approved: { label: "Approved", color: "text-green-700 dark:text-green-300", bg: "bg-green-100 dark:bg-green-900", dotColor: "bg-green-500" },
  live_vendor: { label: "Live Vendor", color: "text-teal-700 dark:text-teal-300", bg: "bg-teal-100 dark:bg-teal-900", dotColor: "bg-teal-500" },
  rejected: { label: "Rejected", color: "text-red-700 dark:text-red-300", bg: "bg-red-100 dark:bg-red-900", dotColor: "bg-red-500" },
  inactive: { label: "Inactive", color: "text-gray-500", bg: "bg-gray-100 dark:bg-gray-800", dotColor: "bg-gray-400" },
};

// Customer statuses
const CUSTOMER_STATUS: Record<string, StatusConfig> = {
  lead: { label: "Lead", color: "text-gray-700 dark:text-gray-300", bg: "bg-gray-100 dark:bg-gray-700", dotColor: "bg-gray-400" },
  contacted: { label: "Contacted", color: "text-blue-700 dark:text-blue-300", bg: "bg-blue-100 dark:bg-blue-900", dotColor: "bg-blue-500" },
  application_submitted: { label: "Applied", color: "text-purple-700 dark:text-purple-300", bg: "bg-purple-100 dark:bg-purple-900", dotColor: "bg-purple-500" },
  in_review: { label: "In Review", color: "text-yellow-700 dark:text-yellow-300", bg: "bg-yellow-100 dark:bg-yellow-900", dotColor: "bg-yellow-500" },
  approved: { label: "Approved", color: "text-green-700 dark:text-green-300", bg: "bg-green-100 dark:bg-green-900", dotColor: "bg-green-500" },
  funded: { label: "Funded", color: "text-teal-700 dark:text-teal-300", bg: "bg-teal-100 dark:bg-teal-900", dotColor: "bg-teal-500" },
  declined: { label: "Declined", color: "text-red-700 dark:text-red-300", bg: "bg-red-100 dark:bg-red-900", dotColor: "bg-red-500" },
  follow_up: { label: "Follow Up", color: "text-orange-700 dark:text-orange-300", bg: "bg-orange-100 dark:bg-orange-900", dotColor: "bg-orange-500" },
};

// Marketing vendor statuses
const VENDOR_STATUS: Record<string, StatusConfig> = {
  researching: { label: "Researching", color: "text-gray-700 dark:text-gray-300", bg: "bg-gray-100 dark:bg-gray-700", dotColor: "bg-gray-400" },
  testing: { label: "Testing", color: "text-blue-700 dark:text-blue-300", bg: "bg-blue-100 dark:bg-blue-900", dotColor: "bg-blue-500" },
  active: { label: "Active", color: "text-green-700 dark:text-green-300", bg: "bg-green-100 dark:bg-green-900", dotColor: "bg-green-500" },
  paused: { label: "Paused", color: "text-yellow-700 dark:text-yellow-300", bg: "bg-yellow-100 dark:bg-yellow-900", dotColor: "bg-yellow-500" },
  discontinued: { label: "Discontinued", color: "text-red-700 dark:text-red-300", bg: "bg-red-100 dark:bg-red-900", dotColor: "bg-red-500" },
};

// Document statuses
const DOCUMENT_STATUS: Record<string, StatusConfig> = {
  pending: { label: "Pending", color: "text-yellow-700 dark:text-yellow-300", bg: "bg-yellow-100 dark:bg-yellow-900", dotColor: "bg-yellow-500" },
  reviewed: { label: "Reviewed", color: "text-blue-700 dark:text-blue-300", bg: "bg-blue-100 dark:bg-blue-900", dotColor: "bg-blue-500" },
  approved: { label: "Approved", color: "text-green-700 dark:text-green-300", bg: "bg-green-100 dark:bg-green-900", dotColor: "bg-green-500" },
  rejected: { label: "Rejected", color: "text-red-700 dark:text-red-300", bg: "bg-red-100 dark:bg-red-900", dotColor: "bg-red-500" },
};

// Combined status map
const ALL_STATUSES: Record<string, StatusConfig> = {
  ...LENDER_STATUS,
  ...CUSTOMER_STATUS,
  ...VENDOR_STATUS,
  ...DOCUMENT_STATUS,
};

interface StatusBadgeProps {
  status: string;
  type?: "lender" | "customer" | "vendor" | "document" | "auto";
  variant?: StatusVariant;
  size?: StatusSize;
  className?: string;
}

export default function StatusBadge({
  status,
  type = "auto",
  variant = "default",
  size = "md",
  className,
}: StatusBadgeProps) {
  // Get the appropriate status map
  let statusMap: Record<string, StatusConfig>;
  switch (type) {
    case "lender":
      statusMap = LENDER_STATUS;
      break;
    case "customer":
      statusMap = CUSTOMER_STATUS;
      break;
    case "vendor":
      statusMap = VENDOR_STATUS;
      break;
    case "document":
      statusMap = DOCUMENT_STATUS;
      break;
    default:
      statusMap = ALL_STATUSES;
  }

  const config = statusMap[status] || {
    label: status.replace(/_/g, " "),
    color: "text-gray-700 dark:text-gray-300",
    bg: "bg-gray-100 dark:bg-gray-700",
    dotColor: "bg-gray-400",
  };

  const sizeClasses = {
    sm: "text-xs px-1.5 py-0.5",
    md: "text-xs px-2 py-1",
    lg: "text-sm px-2.5 py-1",
  };

  const dotSizeClasses = {
    sm: "w-1.5 h-1.5",
    md: "w-2 h-2",
    lg: "w-2.5 h-2.5",
  };

  if (variant === "dot") {
    return (
      <span className={cn("inline-flex items-center gap-1.5", className)}>
        <span className={cn("rounded-full", config.dotColor, dotSizeClasses[size])} />
        <span className={cn("font-medium capitalize", config.color, size === "sm" ? "text-xs" : "text-sm")}>
          {config.label}
        </span>
      </span>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex items-center font-medium rounded-full",
        config.bg,
        config.color,
        sizeClasses[size],
        className
      )}
    >
      {config.label}
    </span>
  );
}

// Export status configurations for use elsewhere
export { LENDER_STATUS, CUSTOMER_STATUS, VENDOR_STATUS, DOCUMENT_STATUS };
