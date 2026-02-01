import { useState } from "react";
import {
  PhoneIcon,
  EnvelopeIcon,
  ChatBubbleLeftIcon,
  DocumentIcon,
  ArrowPathIcon,
  CalendarIcon,
  UserIcon,
  PlusIcon,
} from "@heroicons/react/24/outline";
import { useSession } from "../../context/SessionContext";

interface Interaction {
  id: string;
  interaction_type: string;
  subject: string | null;
  content: string | null;
  old_status: string | null;
  new_status: string | null;
  call_duration: number | null;
  call_outcome: string | null;
  follow_up_date: string | null;
  logged_by: string | null;
  logged_by_name?: string;
  created_at: string;
}

interface InteractionTimelineProps {
  interactions: Interaction[];
  onAddInteraction?: (data: {
    interaction_type: string;
    subject?: string;
    content: string;
    follow_up_date?: string;
  }) => Promise<void>;
  showAddForm?: boolean;
  isLoading?: boolean;
}

const INTERACTION_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  call: PhoneIcon,
  email: EnvelopeIcon,
  sms: ChatBubbleLeftIcon,
  note: ChatBubbleLeftIcon,
  document_uploaded: DocumentIcon,
  status_change: ArrowPathIcon,
  application_submitted: DocumentIcon,
  meeting: CalendarIcon,
  voicemail: PhoneIcon,
  follow_up_scheduled: CalendarIcon,
};

const INTERACTION_COLORS: Record<string, string> = {
  call: "bg-green-500",
  email: "bg-blue-500",
  sms: "bg-purple-500",
  note: "bg-gray-500",
  document_uploaded: "bg-orange-500",
  status_change: "bg-yellow-500",
  application_submitted: "bg-teal-500",
  meeting: "bg-pink-500",
  voicemail: "bg-green-400",
  follow_up_scheduled: "bg-indigo-500",
};

const INTERACTION_TYPES = [
  { value: "call", label: "Phone Call" },
  { value: "email", label: "Email" },
  { value: "sms", label: "SMS/Text" },
  { value: "note", label: "Note" },
  { value: "meeting", label: "Meeting" },
  { value: "voicemail", label: "Voicemail" },
];

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function formatTimeAgo(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString();
}

export default function InteractionTimeline({
  interactions,
  onAddInteraction,
  showAddForm = true,
  isLoading = false,
}: InteractionTimelineProps) {
  const { session: _session } = useSession();
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [formData, setFormData] = useState({
    interaction_type: "note",
    subject: "",
    content: "",
    follow_up_date: "",
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.content.trim() || !onAddInteraction) return;

    setIsSubmitting(true);
    try {
      await onAddInteraction({
        interaction_type: formData.interaction_type,
        subject: formData.subject || undefined,
        content: formData.content,
        follow_up_date: formData.follow_up_date || undefined,
      });
      setFormData({ interaction_type: "note", subject: "", content: "", follow_up_date: "" });
      setIsFormOpen(false);
    } catch (error) {
      console.error("Failed to add interaction:", error);
    }
    setIsSubmitting(false);
  };

  return (
    <div className="space-y-4">
      {/* Add Interaction Button/Form */}
      {showAddForm && onAddInteraction && (
        <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4">
          {!isFormOpen ? (
            <button
              onClick={() => setIsFormOpen(true)}
              className="flex items-center gap-2 text-ocean-blue hover:text-ocean-blue/80 font-medium text-sm"
            >
              <PlusIcon className="w-5 h-5" />
              Add Interaction
            </button>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="flex gap-3">
                <select
                  value={formData.interaction_type}
                  onChange={(e) => setFormData({ ...formData, interaction_type: e.target.value })}
                  className="input-field text-sm py-2 w-36"
                >
                  {INTERACTION_TYPES.map((type) => (
                    <option key={type.value} value={type.value}>
                      {type.label}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  placeholder="Subject (optional)"
                  value={formData.subject}
                  onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
                  className="input-field text-sm py-2 flex-1"
                />
              </div>

              <textarea
                placeholder="What happened? Add notes, details, or next steps..."
                value={formData.content}
                onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                className="input-field text-sm py-2 w-full"
                rows={3}
                required
              />

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <label className="text-sm text-gray-500">Follow-up:</label>
                  <input
                    type="date"
                    value={formData.follow_up_date}
                    onChange={(e) => setFormData({ ...formData, follow_up_date: e.target.value })}
                    className="input-field text-sm py-1 px-2"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setIsFormOpen(false)}
                    className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting || !formData.content.trim()}
                    className="btn-primary text-sm px-4 py-1.5 disabled:opacity-50"
                  >
                    {isSubmitting ? "Adding..." : "Add"}
                  </button>
                </div>
              </div>
            </form>
          )}
        </div>
      )}

      {/* Timeline */}
      {isLoading ? (
        <div className="flex justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-mint-green"></div>
        </div>
      ) : interactions.length === 0 ? (
        <div className="text-center py-8 text-gray-500 dark:text-gray-400">
          No interactions recorded yet
        </div>
      ) : (
        <div className="relative">
          {/* Timeline Line */}
          <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-gray-200 dark:bg-gray-700" />

          {/* Timeline Items */}
          <div className="space-y-4">
            {interactions.map((interaction) => {
              const Icon = INTERACTION_ICONS[interaction.interaction_type] || ChatBubbleLeftIcon;
              const iconColor = INTERACTION_COLORS[interaction.interaction_type] || "bg-gray-500";

              return (
                <div key={interaction.id} className="relative pl-10">
                  {/* Icon */}
                  <div
                    className={`absolute left-0 w-8 h-8 rounded-full ${iconColor} flex items-center justify-center`}
                  >
                    <Icon className="w-4 h-4 text-white" />
                  </div>

                  {/* Content */}
                  <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <span className="text-sm font-medium text-gray-900 dark:text-white capitalize">
                          {interaction.interaction_type.replace(/_/g, " ")}
                        </span>
                        {interaction.subject && (
                          <span className="text-sm text-gray-600 dark:text-gray-400 ml-2">
                            — {interaction.subject}
                          </span>
                        )}
                      </div>
                      <span className="text-xs text-gray-500">
                        {formatTimeAgo(interaction.created_at)}
                      </span>
                    </div>

                    {/* Status Change */}
                    {interaction.interaction_type === "status_change" && (
                      <div className="text-sm text-gray-600 dark:text-gray-400 mb-2">
                        Status changed from{" "}
                        <span className="font-medium">{interaction.old_status?.replace(/_/g, " ")}</span>
                        {" → "}
                        <span className="font-medium">{interaction.new_status?.replace(/_/g, " ")}</span>
                      </div>
                    )}

                    {/* Content */}
                    {interaction.content && (
                      <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                        {interaction.content}
                      </p>
                    )}

                    {/* Call Details */}
                    {interaction.call_duration && (
                      <div className="mt-2 text-xs text-gray-500">
                        Duration: {formatDuration(interaction.call_duration)}
                        {interaction.call_outcome && ` • ${interaction.call_outcome}`}
                      </div>
                    )}

                    {/* Follow-up */}
                    {interaction.follow_up_date && (
                      <div className="mt-2 flex items-center gap-1 text-xs text-orange-600 dark:text-orange-400">
                        <CalendarIcon className="w-4 h-4" />
                        Follow-up: {new Date(interaction.follow_up_date).toLocaleDateString()}
                      </div>
                    )}

                    {/* Logged By */}
                    {interaction.logged_by_name && (
                      <div className="mt-2 flex items-center gap-1 text-xs text-gray-400">
                        <UserIcon className="w-3 h-3" />
                        {interaction.logged_by_name}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
