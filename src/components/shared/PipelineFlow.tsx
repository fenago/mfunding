import { motion } from "framer-motion";
import { CheckIcon } from "@heroicons/react/24/solid";
import { PIPELINES, type PipelineDef } from "../../data/pipelines";

interface PipelineFlowProps {
  /** "mca" | "vcf" or a full pipeline definition. */
  pipeline: "mca" | "vcf" | PipelineDef;
  /** Current stage key (e.g. a deal's status). */
  currentKey: string;
  /** If set, nodes are clickable (employees advancing the deal). */
  onStageClick?: (key: string) => void;
  /** Deal is in a terminal/off-pipeline state (declined/dead) — dim everything. */
  terminal?: boolean;
}

/**
 * Animated pipeline visual. Progress line fills left→right, completed stages get
 * a checkmark, and the current stage pulses. Read-only by default; pass
 * onStageClick to make it interactive. Works for any pipeline definition.
 */
export default function PipelineFlow({ pipeline, currentKey, onStageClick, terminal }: PipelineFlowProps) {
  const def = typeof pipeline === "string" ? PIPELINES[pipeline] : pipeline;
  const currentIndex = def.stages.findIndex((s) => s.key === currentKey);
  const interactive = !!onStageClick;

  return (
    <div className="overflow-x-auto pb-2">
      <div className="flex items-start min-w-max gap-0">
        {def.stages.map((stage, i) => {
          const isCompleted = !terminal && currentIndex >= 0 && i < currentIndex;
          const isCurrent = !terminal && i === currentIndex;
          const isLast = i === def.stages.length - 1;

          return (
            <div key={stage.key} className="flex items-start">
              <div className="flex flex-col items-center w-24">
                <motion.button
                  type="button"
                  disabled={!interactive}
                  onClick={() => onStageClick?.(stage.key)}
                  title={interactive ? `Move to: ${stage.label}` : `${stage.label} — ${stage.blurb}`}
                  initial={false}
                  animate={
                    isCurrent
                      ? { scale: [1, 1.12, 1], boxShadow: ["0 0 0 0 rgba(37,99,235,0.45)", "0 0 0 10px rgba(37,99,235,0)", "0 0 0 0 rgba(37,99,235,0)"] }
                      : { scale: 1 }
                  }
                  transition={isCurrent ? { duration: 1.8, repeat: Infinity } : { duration: 0.3 }}
                  className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold ${interactive ? "cursor-pointer" : "cursor-default"} ${
                    isCurrent
                      ? "bg-ocean-blue text-white"
                      : isCompleted
                        ? "bg-emerald-500 text-white"
                        : "bg-gray-200 dark:bg-gray-600 text-gray-500 dark:text-gray-300"
                  }`}
                >
                  {isCompleted ? (
                    <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 400, damping: 18 }}>
                      <CheckIcon className="w-5 h-5" />
                    </motion.span>
                  ) : (
                    i + 1
                  )}
                </motion.button>
                <span className={`mt-2 text-[11px] leading-tight text-center ${
                  isCurrent ? "font-semibold text-ocean-blue" : isCompleted ? "text-emerald-600" : "text-gray-400"
                }`}>
                  {stage.label}
                </span>
                {isCurrent && (
                  <motion.span
                    initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
                    className="mt-1 text-[10px] text-center text-gray-500 dark:text-gray-400"
                  >
                    {stage.blurb}
                  </motion.span>
                )}
              </div>

              {/* connector */}
              {!isLast && (
                <div className="relative h-0.5 w-8 mt-[18px] bg-gray-200 dark:bg-gray-600 rounded-full overflow-hidden">
                  <motion.div
                    className="absolute inset-y-0 left-0 bg-emerald-500"
                    initial={{ width: 0 }}
                    animate={{ width: isCompleted ? "100%" : "0%" }}
                    transition={{ duration: 0.5, delay: i * 0.08 }}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
