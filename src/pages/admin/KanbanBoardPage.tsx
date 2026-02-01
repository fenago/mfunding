import { useState, useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import {
  DndContext,
  DragOverlay,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragStartEvent,
  DragEndEvent,
  DragOverEvent,
  useDroppable,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useSession } from "../../context/SessionContext";
import { useUserProfile } from "../../context/UserProfileContext";
import supabase from "../../supabase";
import {
  PlusIcon,
  XMarkIcon,
  PencilIcon,
  TrashIcon,
  FunnelIcon,
  MagnifyingGlassIcon,
  ArrowPathIcon,
  LinkIcon,
  ChatBubbleLeftIcon,
  ClockIcon,
  CalendarIcon,
  ArrowTopRightOnSquareIcon,
  DocumentTextIcon,
  Cog6ToothIcon,
} from "@heroicons/react/24/outline";

type TaskStatus = "backlog" | "todo" | "in_progress" | "review" | "done";
type TaskPriority = "low" | "medium" | "high" | "urgent";

interface Task {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  category: string | null;
  phase: string | null;
  link: string | null;
  notes: string | null;
  estimated_hours: number | null;
  actual_hours: number | null;
  tags: string[] | null;
  position: number;
  created_by: string | null;
  assigned_to: string | null;
  due_date: string | null;
  created_at: string;
  updated_at: string;
}

interface TaskComment {
  id: string;
  task_id: string;
  user_id: string | null;
  content: string;
  created_at: string;
  updated_at: string;
}

interface TaskActivity {
  id: string;
  task_id: string;
  user_id: string | null;
  action: string;
  old_value: string | null;
  new_value: string | null;
  field_name: string | null;
  created_at: string;
}

interface Phase {
  id: string;
  name: string;
  position: number;
}

interface Category {
  id: string;
  name: string;
  position: number;
}

const COLUMNS: { id: TaskStatus; title: string; color: string }[] = [
  { id: "backlog", title: "Backlog", color: "bg-gray-500" },
  { id: "todo", title: "To Do", color: "bg-blue-500" },
  { id: "in_progress", title: "In Progress", color: "bg-yellow-500" },
  { id: "review", title: "Review", color: "bg-purple-500" },
  { id: "done", title: "Done", color: "bg-green-500" },
];

const PRIORITIES: { value: TaskPriority; label: string; color: string }[] = [
  { value: "low", label: "Low", color: "bg-gray-400" },
  { value: "medium", label: "Medium", color: "bg-blue-400" },
  { value: "high", label: "High", color: "bg-orange-400" },
  { value: "urgent", label: "Urgent", color: "bg-red-500" },
];

// Droppable Column Component
function DroppableColumn({
  column,
  tasks,
  onEdit,
  onDelete,
  onViewDetails,
  isMobileSelected = false,
}: {
  column: { id: TaskStatus; title: string; color: string };
  tasks: Task[];
  onEdit: (task: Task) => void;
  onDelete: (id: string) => void;
  onViewDetails: (task: Task) => void;
  isMobileSelected?: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: column.id,
  });

  return (
    <div
      ref={setNodeRef}
      className={`flex flex-col rounded-xl flex-shrink-0 w-full md:w-72 ${
        isMobileSelected ? "flex" : "hidden md:flex"
      } ${
        isOver
          ? "bg-mint-green/20 ring-2 ring-mint-green"
          : "bg-gray-100 dark:bg-gray-900"
      }`}
    >
      <div className="flex items-center gap-2 p-3 border-b border-gray-200 dark:border-gray-700">
        <span className={`w-3 h-3 rounded-full ${column.color}`} />
        <h3 className="font-semibold text-gray-700 dark:text-gray-200 text-sm">
          {column.title}
        </h3>
        <span className="text-xs text-gray-500 bg-gray-200 dark:bg-gray-700 px-2 py-0.5 rounded-full ml-auto">
          {tasks.length}
        </span>
      </div>
      <div className="flex-1 p-2 space-y-2 overflow-y-auto min-h-[200px]" style={{ maxHeight: 'calc(100vh - 350px)' }}>
        <SortableContext
          items={tasks.map((t) => t.id)}
          strategy={verticalListSortingStrategy}
        >
          {tasks.map((task) => (
            <SortableTaskCard
              key={task.id}
              task={task}
              onEdit={onEdit}
              onDelete={onDelete}
              onViewDetails={onViewDetails}
            />
          ))}
        </SortableContext>
        {tasks.length === 0 && (
          <div
            className={`text-center py-8 text-gray-400 text-sm border-2 border-dashed rounded-lg ${
              isOver ? "border-mint-green bg-mint-green/10" : "border-gray-300 dark:border-gray-600"
            }`}
          >
            {isOver ? "Drop here" : "No tasks"}
          </div>
        )}
      </div>
    </div>
  );
}

// Sortable Task Card Component
function SortableTaskCard({
  task,
  onEdit,
  onDelete,
  onViewDetails,
}: {
  task: Task;
  onEdit: (task: Task) => void;
  onDelete: (id: string) => void;
  onViewDetails: (task: Task) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const priorityConfig = PRIORITIES.find((p) => p.value === task.priority);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`bg-white dark:bg-gray-800 rounded-lg p-2.5 shadow-sm border border-gray-200 dark:border-gray-700 transition-all ${
        isDragging ? "opacity-50 shadow-lg scale-105 z-50" : "hover:shadow-md"
      }`}
    >
      {/* Drag Handle */}
      <div
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing mb-1.5 pb-1.5 border-b border-gray-100 dark:border-gray-700"
      >
        <div className="flex items-center gap-1.5">
          <span
            className={`w-2 h-2 rounded-full flex-shrink-0 ${
              priorityConfig?.color || "bg-gray-400"
            }`}
          />
          <h4 className="text-xs font-medium text-gray-900 dark:text-gray-100 line-clamp-2">
            {task.title}
          </h4>
        </div>
      </div>

      {/* Card Content */}
      <div onClick={() => onViewDetails(task)} className="cursor-pointer">
        {task.description && (
          <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2 mb-1.5">
            {task.description}
          </p>
        )}

        <div className="flex flex-wrap gap-1 mb-1.5">
          {task.phase && (
            <span className="inline-flex items-center px-1 py-0.5 rounded text-[10px] font-medium bg-ocean-blue/10 text-ocean-blue">
              {task.phase.replace("Phase ", "P").split(":")[0]}
            </span>
          )}
          {task.category && (
            <span className="inline-flex items-center px-1 py-0.5 rounded text-[10px] font-medium bg-mint-green/10 text-teal truncate max-w-[80px]">
              {task.category}
            </span>
          )}
        </div>

        {/* Link */}
        {task.link && (
          <a
            href={task.link}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="flex items-center gap-1 text-[10px] text-ocean-blue hover:underline mb-1.5 truncate"
          >
            <ArrowTopRightOnSquareIcon className="w-3 h-3 flex-shrink-0" />
            <span className="truncate">{new URL(task.link).hostname}</span>
          </a>
        )}

        {/* Meta */}
        <div className="flex items-center gap-1.5 text-[10px] text-gray-400">
          {task.notes && <DocumentTextIcon className="w-3 h-3" title="Has notes" />}
          {task.estimated_hours && (
            <span className="flex items-center gap-0.5">
              <ClockIcon className="w-3 h-3" />
              {task.estimated_hours}h
            </span>
          )}
          {task.due_date && (
            <span className="flex items-center gap-0.5">
              <CalendarIcon className="w-3 h-3" />
              {new Date(task.due_date).toLocaleDateString()}
            </span>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-0.5 mt-1.5 pt-1.5 border-t border-gray-100 dark:border-gray-700">
        <button
          onClick={(e) => { e.stopPropagation(); onViewDetails(task); }}
          className="p-1 text-gray-400 hover:text-ocean-blue hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
          title="View Details"
        >
          <ChatBubbleLeftIcon className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onEdit(task); }}
          className="p-1 text-gray-400 hover:text-ocean-blue hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
          title="Edit"
        >
          <PencilIcon className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(task.id); }}
          className="p-1 text-gray-400 hover:text-red-500 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
          title="Delete"
        >
          <TrashIcon className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

// Task Card for Drag Overlay
function TaskCard({ task }: { task: Task }) {
  const priorityConfig = PRIORITIES.find((p) => p.value === task.priority);

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg p-2.5 shadow-xl border-2 border-mint-green cursor-grabbing w-72">
      <div className="flex items-center gap-1.5">
        <span className={`w-2 h-2 rounded-full ${priorityConfig?.color || "bg-gray-400"}`} />
        <h4 className="text-xs font-medium text-gray-900 dark:text-gray-100 truncate">
          {task.title}
        </h4>
      </div>
    </div>
  );
}

// Settings Modal
function SettingsModal({
  isOpen,
  onClose,
  phases,
  categories,
  onPhasesChange,
  onCategoriesChange,
}: {
  isOpen: boolean;
  onClose: () => void;
  phases: Phase[];
  categories: Category[];
  onPhasesChange: () => void;
  onCategoriesChange: () => void;
}) {
  const [activeTab, setActiveTab] = useState<"phases" | "categories">("phases");
  const [newPhaseName, setNewPhaseName] = useState("");
  const [newCategoryName, setNewCategoryName] = useState("");
  const [editingPhase, setEditingPhase] = useState<Phase | null>(null);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);

  if (!isOpen) return null;

  const handleAddPhase = async () => {
    if (!newPhaseName.trim()) return;
    const maxPosition = Math.max(0, ...phases.map(p => p.position));
    await supabase.from("kanban_phases").insert({
      name: newPhaseName.trim(),
      position: maxPosition + 1,
    });
    setNewPhaseName("");
    onPhasesChange();
  };

  const handleAddCategory = async () => {
    if (!newCategoryName.trim()) return;
    const maxPosition = Math.max(0, ...categories.map(c => c.position));
    await supabase.from("kanban_categories").insert({
      name: newCategoryName.trim(),
      position: maxPosition + 1,
    });
    setNewCategoryName("");
    onCategoriesChange();
  };

  const handleUpdatePhase = async (phase: Phase) => {
    await supabase.from("kanban_phases").update({ name: phase.name }).eq("id", phase.id);
    setEditingPhase(null);
    onPhasesChange();
  };

  const handleUpdateCategory = async (category: Category) => {
    await supabase.from("kanban_categories").update({ name: category.name }).eq("id", category.id);
    setEditingCategory(null);
    onCategoriesChange();
  };

  const handleDeletePhase = async (id: string) => {
    if (!confirm("Delete this phase?")) return;
    await supabase.from("kanban_phases").delete().eq("id", id);
    onPhasesChange();
  };

  const handleDeleteCategory = async (id: string) => {
    if (!confirm("Delete this category?")) return;
    await supabase.from("kanban_categories").delete().eq("id", id);
    onCategoriesChange();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-lg max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Settings</h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded">
            <XMarkIcon className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200 dark:border-gray-700">
          <button
            onClick={() => setActiveTab("phases")}
            className={`flex-1 px-4 py-3 text-sm font-medium ${
              activeTab === "phases" ? "text-ocean-blue border-b-2 border-ocean-blue" : "text-gray-500"
            }`}
          >
            Phases ({phases.length})
          </button>
          <button
            onClick={() => setActiveTab("categories")}
            className={`flex-1 px-4 py-3 text-sm font-medium ${
              activeTab === "categories" ? "text-ocean-blue border-b-2 border-ocean-blue" : "text-gray-500"
            }`}
          >
            Categories ({categories.length})
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {activeTab === "phases" && (
            <div className="space-y-3">
              {/* Add new */}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newPhaseName}
                  onChange={(e) => setNewPhaseName(e.target.value)}
                  placeholder="New phase name..."
                  className="input-field flex-1"
                  onKeyDown={(e) => e.key === "Enter" && handleAddPhase()}
                />
                <button onClick={handleAddPhase} className="btn-primary px-3">
                  <PlusIcon className="w-5 h-5" />
                </button>
              </div>
              {/* List */}
              <div className="space-y-2">
                {phases.map((phase) => (
                  <div key={phase.id} className="flex items-center gap-2 p-2 bg-gray-50 dark:bg-gray-900 rounded-lg">
                    {editingPhase?.id === phase.id ? (
                      <input
                        type="text"
                        value={editingPhase.name}
                        onChange={(e) => setEditingPhase({ ...editingPhase, name: e.target.value })}
                        className="input-field flex-1 text-sm"
                        onKeyDown={(e) => e.key === "Enter" && handleUpdatePhase(editingPhase)}
                        autoFocus
                      />
                    ) : (
                      <span className="flex-1 text-sm text-gray-700 dark:text-gray-300">{phase.name}</span>
                    )}
                    {editingPhase?.id === phase.id ? (
                      <>
                        <button onClick={() => handleUpdatePhase(editingPhase)} className="p-1 text-green-500 hover:bg-gray-200 rounded">
                          Save
                        </button>
                        <button onClick={() => setEditingPhase(null)} className="p-1 text-gray-500 hover:bg-gray-200 rounded">
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <button onClick={() => setEditingPhase(phase)} className="p-1 text-gray-400 hover:text-ocean-blue rounded">
                          <PencilIcon className="w-4 h-4" />
                        </button>
                        <button onClick={() => handleDeletePhase(phase.id)} className="p-1 text-gray-400 hover:text-red-500 rounded">
                          <TrashIcon className="w-4 h-4" />
                        </button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === "categories" && (
            <div className="space-y-3">
              {/* Add new */}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  placeholder="New category name..."
                  className="input-field flex-1"
                  onKeyDown={(e) => e.key === "Enter" && handleAddCategory()}
                />
                <button onClick={handleAddCategory} className="btn-primary px-3">
                  <PlusIcon className="w-5 h-5" />
                </button>
              </div>
              {/* List */}
              <div className="space-y-2">
                {categories.map((category) => (
                  <div key={category.id} className="flex items-center gap-2 p-2 bg-gray-50 dark:bg-gray-900 rounded-lg">
                    {editingCategory?.id === category.id ? (
                      <input
                        type="text"
                        value={editingCategory.name}
                        onChange={(e) => setEditingCategory({ ...editingCategory, name: e.target.value })}
                        className="input-field flex-1 text-sm"
                        onKeyDown={(e) => e.key === "Enter" && handleUpdateCategory(editingCategory)}
                        autoFocus
                      />
                    ) : (
                      <span className="flex-1 text-sm text-gray-700 dark:text-gray-300">{category.name}</span>
                    )}
                    {editingCategory?.id === category.id ? (
                      <>
                        <button onClick={() => handleUpdateCategory(editingCategory)} className="p-1 text-green-500 hover:bg-gray-200 rounded">
                          Save
                        </button>
                        <button onClick={() => setEditingCategory(null)} className="p-1 text-gray-500 hover:bg-gray-200 rounded">
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <button onClick={() => setEditingCategory(category)} className="p-1 text-gray-400 hover:text-ocean-blue rounded">
                          <PencilIcon className="w-4 h-4" />
                        </button>
                        <button onClick={() => handleDeleteCategory(category.id)} className="p-1 text-gray-400 hover:text-red-500 rounded">
                          <TrashIcon className="w-4 h-4" />
                        </button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Task Edit Modal
function TaskEditModal({
  task,
  isOpen,
  onClose,
  onSave,
  phases,
  categories,
}: {
  task: Task | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (task: Partial<Task>) => void;
  phases: Phase[];
  categories: Category[];
}) {
  const [formData, setFormData] = useState<Partial<Task>>({
    title: "",
    description: "",
    status: "backlog",
    priority: "medium",
    category: "",
    phase: "",
    link: "",
    notes: "",
    estimated_hours: null,
    due_date: null,
  });

  useEffect(() => {
    if (task) {
      setFormData({
        title: task.title,
        description: task.description || "",
        status: task.status,
        priority: task.priority,
        category: task.category || "",
        phase: task.phase || "",
        link: task.link || "",
        notes: task.notes || "",
        estimated_hours: task.estimated_hours,
        due_date: task.due_date,
      });
    } else {
      setFormData({
        title: "",
        description: "",
        status: "backlog",
        priority: "medium",
        category: "",
        phase: "",
        link: "",
        notes: "",
        estimated_hours: null,
        due_date: null,
      });
    }
  }, [task, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(formData);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 md:p-4 bg-black/50">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-lg max-h-[95vh] overflow-y-auto">
        <div className="flex items-center justify-between p-3 md:p-4 border-b border-gray-200 dark:border-gray-700 sticky top-0 bg-white dark:bg-gray-800">
          <h2 className="text-base md:text-lg font-semibold text-gray-900 dark:text-gray-100">
            {task ? "Edit Task" : "Add Task"}
          </h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded">
            <XMarkIcon className="w-5 h-5 text-gray-500" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-3 md:p-4 space-y-3 md:space-y-4">
          <div>
            <label className="block text-xs md:text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Title *</label>
            <input
              type="text"
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              className="input-field text-sm"
              required
            />
          </div>
          <div>
            <label className="block text-xs md:text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Description</label>
            <textarea
              value={formData.description || ""}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="input-field text-sm"
              rows={2}
            />
          </div>
          <div className="grid grid-cols-2 gap-2 md:gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Status</label>
              <select
                value={formData.status}
                onChange={(e) => setFormData({ ...formData, status: e.target.value as TaskStatus })}
                className="input-field"
              >
                {COLUMNS.map((col) => (
                  <option key={col.id} value={col.id}>{col.title}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Priority</label>
              <select
                value={formData.priority}
                onChange={(e) => setFormData({ ...formData, priority: e.target.value as TaskPriority })}
                className="input-field"
              >
                {PRIORITIES.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Phase</label>
              <select
                value={formData.phase || ""}
                onChange={(e) => setFormData({ ...formData, phase: e.target.value })}
                className="input-field"
              >
                <option value="">Select Phase</option>
                {phases.map((phase) => (
                  <option key={phase.id} value={phase.name}>{phase.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Category</label>
              <select
                value={formData.category || ""}
                onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                className="input-field"
              >
                <option value="">Select Category</option>
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.name}>{cat.name}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Est. Hours</label>
              <input
                type="number"
                step="0.5"
                min="0"
                value={formData.estimated_hours || ""}
                onChange={(e) => setFormData({ ...formData, estimated_hours: e.target.value ? parseFloat(e.target.value) : null })}
                className="input-field"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Due Date</label>
              <input
                type="date"
                value={formData.due_date?.split("T")[0] || ""}
                onChange={(e) => setFormData({ ...formData, due_date: e.target.value || null })}
                className="input-field"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Link (URL)</label>
            <input
              type="url"
              value={formData.link || ""}
              onChange={(e) => setFormData({ ...formData, link: e.target.value })}
              className="input-field"
              placeholder="https://..."
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Notes</label>
            <textarea
              value={formData.notes || ""}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              className="input-field"
              rows={3}
            />
          </div>
          <div className="flex justify-end gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
            <button type="button" onClick={onClose} className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg">
              Cancel
            </button>
            <button type="submit" className="btn-primary">{task ? "Update" : "Create"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Task Detail Modal
function TaskDetailModal({
  task,
  isOpen,
  onClose,
  onEdit,
  session,
}: {
  task: Task | null;
  isOpen: boolean;
  onClose: () => void;
  onEdit: (task: Task) => void;
  session: any;
}) {
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [activity, setActivity] = useState<TaskActivity[]>([]);
  const [newComment, setNewComment] = useState("");
  const [activeTab, setActiveTab] = useState<"details" | "comments" | "activity">("details");
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (task && isOpen) {
      fetchComments();
      fetchActivity();
    }
  }, [task, isOpen]);

  const fetchComments = async () => {
    if (!task) return;
    const { data } = await supabase
      .from("task_comments")
      .select("*")
      .eq("task_id", task.id)
      .order("created_at", { ascending: false });
    setComments(data || []);
  };

  const fetchActivity = async () => {
    if (!task) return;
    const { data } = await supabase
      .from("task_activity")
      .select("*")
      .eq("task_id", task.id)
      .order("created_at", { ascending: false })
      .limit(50);
    setActivity(data || []);
  };

  const handleAddComment = async () => {
    if (!task || !newComment.trim()) return;
    setIsLoading(true);
    await supabase.from("task_comments").insert({
      task_id: task.id,
      user_id: session?.user?.id,
      content: newComment.trim(),
    });
    await supabase.from("task_activity").insert({
      task_id: task.id,
      user_id: session?.user?.id,
      action: "added_comment",
      new_value: newComment.trim().substring(0, 100),
    });
    setNewComment("");
    fetchComments();
    setIsLoading(false);
  };

  if (!isOpen || !task) return null;

  const priorityConfig = PRIORITIES.find((p) => p.value === task.priority);
  const statusConfig = COLUMNS.find((c) => c.id === task.status);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-start justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex-1 pr-4">
            <div className="flex items-center gap-2 mb-2">
              <span className={`w-3 h-3 rounded-full ${priorityConfig?.color}`} />
              <span className={`px-2 py-0.5 rounded text-xs font-medium ${statusConfig?.color} text-white`}>
                {statusConfig?.title}
              </span>
            </div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{task.title}</h2>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => onEdit(task)} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded">
              <PencilIcon className="w-5 h-5 text-gray-500" />
            </button>
            <button onClick={onClose} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded">
              <XMarkIcon className="w-5 h-5 text-gray-500" />
            </button>
          </div>
        </div>

        <div className="flex border-b border-gray-200 dark:border-gray-700">
          {(["details", "comments", "activity"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 px-4 py-3 text-sm font-medium ${
                activeTab === tab ? "text-ocean-blue border-b-2 border-ocean-blue" : "text-gray-500"
              }`}
            >
              {tab === "details" && "Details"}
              {tab === "comments" && `Comments (${comments.length})`}
              {tab === "activity" && "Activity"}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {activeTab === "details" && (
            <div className="space-y-4">
              {task.description && (
                <div>
                  <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Description</h3>
                  <p className="text-gray-600 dark:text-gray-400 text-sm whitespace-pre-wrap">{task.description}</p>
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                {task.phase && (
                  <div>
                    <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Phase</h3>
                    <span className="inline-flex items-center px-2 py-1 rounded text-sm bg-ocean-blue/10 text-ocean-blue">{task.phase}</span>
                  </div>
                )}
                {task.category && (
                  <div>
                    <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Category</h3>
                    <span className="inline-flex items-center px-2 py-1 rounded text-sm bg-mint-green/10 text-teal">{task.category}</span>
                  </div>
                )}
              </div>
              {task.link && (
                <div>
                  <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Link</h3>
                  <a href={task.link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-ocean-blue hover:underline">
                    <LinkIcon className="w-4 h-4" />
                    {task.link}
                    <ArrowTopRightOnSquareIcon className="w-4 h-4" />
                  </a>
                </div>
              )}
              {task.notes && (
                <div>
                  <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Notes</h3>
                  <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-3 text-sm text-gray-600 dark:text-gray-400 whitespace-pre-wrap">{task.notes}</div>
                </div>
              )}
            </div>
          )}

          {activeTab === "comments" && (
            <div className="space-y-4">
              <div className="flex gap-2">
                <textarea
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                  placeholder="Add a comment..."
                  className="input-field flex-1"
                  rows={2}
                />
                <button onClick={handleAddComment} disabled={!newComment.trim() || isLoading} className="btn-primary self-end disabled:opacity-50">
                  {isLoading ? "..." : "Add"}
                </button>
              </div>
              <div className="space-y-3">
                {comments.length === 0 ? (
                  <p className="text-center text-gray-400 py-8">No comments yet</p>
                ) : (
                  comments.map((comment) => (
                    <div key={comment.id} className="bg-gray-50 dark:bg-gray-900 rounded-lg p-3">
                      <span className="text-xs text-gray-500">{new Date(comment.created_at).toLocaleString()}</span>
                      <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap mt-1">{comment.content}</p>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {activeTab === "activity" && (
            <div className="space-y-2">
              {activity.length === 0 ? (
                <p className="text-center text-gray-400 py-8">No activity yet</p>
              ) : (
                activity.map((item) => (
                  <div key={item.id} className="flex items-start gap-3 py-2 border-b border-gray-100 dark:border-gray-700 last:border-0">
                    <div className="w-2 h-2 rounded-full bg-gray-300 mt-2" />
                    <div className="flex-1">
                      <p className="text-sm text-gray-700 dark:text-gray-300">
                        {item.action === "added_comment" && "Added a comment"}
                        {item.action === "status_change" && <>Changed status from <b>{item.old_value}</b> to <b>{item.new_value}</b></>}
                        {item.action === "created" && "Created this task"}
                        {item.action === "updated" && "Updated task"}
                      </p>
                      <span className="text-xs text-gray-400">{new Date(item.created_at).toLocaleString()}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Main Component
export default function KanbanBoardPage() {
  const { session } = useSession();
  const { profile, isSuperAdmin } = useUserProfile();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [phases, setPhases] = useState<Phase[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [viewingTask, setViewingTask] = useState<Task | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [filterPhase, setFilterPhase] = useState<string>("");
  const [filterCategory, setFilterCategory] = useState<string>("");
  const [filterPriority, setFilterPriority] = useState<string>("");
  const [showFilters, setShowFilters] = useState(false);

  // Mobile column selector
  const [mobileColumn, setMobileColumn] = useState<TaskStatus>("backlog");

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const fetchTasks = async () => {
    const { data } = await supabase.from("kanban_tasks").select("*").order("position", { ascending: true });
    setTasks(data || []);
  };

  const fetchPhases = async () => {
    const { data } = await supabase.from("kanban_phases").select("*").order("position", { ascending: true });
    setPhases(data || []);
  };

  const fetchCategories = async () => {
    const { data } = await supabase.from("kanban_categories").select("*").order("position", { ascending: true });
    setCategories(data || []);
  };

  useEffect(() => {
    Promise.all([fetchTasks(), fetchPhases(), fetchCategories()]).then(() => setIsLoading(false));
  }, []);

  const filteredTasks = useMemo(() => {
    return tasks.filter((task) => {
      if (searchQuery && !task.title.toLowerCase().includes(searchQuery.toLowerCase()) && !task.description?.toLowerCase().includes(searchQuery.toLowerCase())) return false;
      if (filterPhase && task.phase !== filterPhase) return false;
      if (filterCategory && task.category !== filterCategory) return false;
      if (filterPriority && task.priority !== filterPriority) return false;
      return true;
    });
  }, [tasks, searchQuery, filterPhase, filterCategory, filterPriority]);

  const tasksByStatus = useMemo(() => {
    const grouped: Record<TaskStatus, Task[]> = { backlog: [], todo: [], in_progress: [], review: [], done: [] };
    filteredTasks.forEach((task) => { if (grouped[task.status]) grouped[task.status].push(task); });
    return grouped;
  }, [filteredTasks]);

  const handleDragStart = (event: DragStartEvent) => {
    setActiveTask(tasks.find((t) => t.id === event.active.id) || null);
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    if (!over) return;
    const activeTask = tasks.find((t) => t.id === active.id);
    if (!activeTask) return;

    const overColumn = COLUMNS.find((col) => col.id === over.id);
    if (overColumn && activeTask.status !== overColumn.id) {
      setTasks((prev) => prev.map((t) => t.id === activeTask.id ? { ...t, status: overColumn.id } : t));
      return;
    }

    const overTask = tasks.find((t) => t.id === over.id);
    if (overTask && activeTask.status !== overTask.status) {
      setTasks((prev) => prev.map((t) => t.id === activeTask.id ? { ...t, status: overTask.status } : t));
    }
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveTask(null);
    if (!over) return;

    const activeTask = tasks.find((t) => t.id === active.id);
    if (!activeTask) return;

    let targetStatus = activeTask.status;
    const overColumn = COLUMNS.find((col) => col.id === over.id);
    const overTask = tasks.find((t) => t.id === over.id);
    if (overColumn) targetStatus = overColumn.id;
    else if (overTask) targetStatus = overTask.status;

    const oldStatus = tasks.find((t) => t.id === active.id)?.status;
    const columnTasks = tasks.filter((t) => t.status === targetStatus && t.id !== active.id).sort((a, b) => a.position - b.position);
    let newPosition = columnTasks.length;
    if (overTask && overTask.status === targetStatus) {
      const overIndex = columnTasks.findIndex((t) => t.id === over.id);
      newPosition = overIndex >= 0 ? overIndex : columnTasks.length;
    }
    columnTasks.splice(newPosition, 0, { ...activeTask, status: targetStatus });

    const updates = columnTasks.map((task, index) => ({ id: task.id, position: index, status: targetStatus }));
    setTasks((prev) => prev.map((t) => {
      const update = updates.find((u) => u.id === t.id);
      return update ? { ...t, position: update.position, status: update.status } : t;
    }));

    for (const update of updates) {
      await supabase.from("kanban_tasks").update({ position: update.position, status: update.status }).eq("id", update.id);
    }

    if (oldStatus !== targetStatus) {
      await supabase.from("task_activity").insert({
        task_id: active.id,
        user_id: session?.user?.id,
        action: "status_change",
        old_value: COLUMNS.find((c) => c.id === oldStatus)?.title,
        new_value: COLUMNS.find((c) => c.id === targetStatus)?.title,
      });
    }
  };

  const handleSaveTask = async (taskData: Partial<Task>) => {
    if (editingTask) {
      await supabase.from("kanban_tasks").update(taskData).eq("id", editingTask.id);
      setTasks((prev) => prev.map((t) => t.id === editingTask.id ? { ...t, ...taskData } : t));
    } else {
      const maxPosition = Math.max(0, ...tasks.filter((t) => t.status === taskData.status).map((t) => t.position));
      const { data } = await supabase.from("kanban_tasks").insert({
        ...taskData,
        status: taskData.status || "backlog",
        priority: taskData.priority || "medium",
        position: maxPosition + 1,
        created_by: session?.user?.id,
      }).select().single();
      if (data) setTasks((prev) => [...prev, data]);
    }
    setIsEditModalOpen(false);
    setEditingTask(null);
  };

  const handleDeleteTask = async (id: string) => {
    if (!confirm("Delete this task?")) return;
    await supabase.from("kanban_tasks").delete().eq("id", id);
    setTasks((prev) => prev.filter((t) => t.id !== id));
  };

  const clearFilters = () => { setSearchQuery(""); setFilterPhase(""); setFilterCategory(""); setFilterPriority(""); };
  const hasActiveFilters = searchQuery || filterPhase || filterCategory || filterPriority;

  if (isLoading) {
    return (
      <main className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-mint-green"></div>
      </main>
    );
  }

  return (
    <main className="h-screen flex flex-col bg-background dark:bg-gray-900 overflow-hidden">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
        <div className="px-3 md:px-4 py-2 md:py-3">
          {/* Top row - responsive */}
          <div className="flex items-center justify-between mb-2 md:mb-3">
            <div className="flex items-center gap-2 md:gap-4">
              <Link to="/" className="text-xs md:text-sm text-gray-500 hover:text-gray-700">&larr;</Link>
              <h1 className="text-base md:text-xl font-semibold text-midnight-blue dark:text-white">Launch Board</h1>
            </div>
            <div className="flex items-center gap-2 md:gap-3">
              {isSuperAdmin && (
                <button onClick={() => setIsSettingsOpen(true)} className="p-1.5 md:p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg" title="Settings">
                  <Cog6ToothIcon className="w-4 h-4 md:w-5 md:h-5" />
                </button>
              )}
              <span className="hidden sm:inline text-sm text-gray-500">{profile?.email}</span>
              <span className={`px-1.5 md:px-2 py-0.5 md:py-1 text-[10px] md:text-xs font-medium rounded-full ${isSuperAdmin ? "bg-purple-100 text-purple-800" : "bg-blue-100 text-blue-800"}`}>
                {profile?.role}
              </span>
            </div>
          </div>

          {/* Toolbar - responsive */}
          <div className="flex flex-wrap items-center gap-1.5 md:gap-2">
            <div className="relative flex-1 min-w-[120px] md:min-w-48 max-w-xs">
              <MagnifyingGlassIcon className="absolute left-2 md:left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 md:w-4 md:h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="input-field pl-7 md:pl-9 py-1 md:py-1.5 text-xs md:text-sm w-full"
              />
            </div>
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`flex items-center gap-1 px-2 md:px-3 py-1 md:py-1.5 rounded-lg border text-xs md:text-sm ${
                hasActiveFilters ? "border-ocean-blue bg-ocean-blue/10 text-ocean-blue" : "border-gray-300 text-gray-700 dark:text-gray-300"
              }`}
            >
              <FunnelIcon className="w-3.5 h-3.5 md:w-4 md:h-4" />
              <span className="hidden xs:inline">Filters</span>
            </button>
            <button onClick={() => { fetchTasks(); fetchPhases(); fetchCategories(); }} className="p-1.5 md:px-3 md:py-1.5 rounded-lg border border-gray-300 text-gray-700 dark:text-gray-300">
              <ArrowPathIcon className="w-3.5 h-3.5 md:w-4 md:h-4" />
            </button>
            <button onClick={() => { setEditingTask(null); setIsEditModalOpen(true); }} className="btn-primary py-1 md:py-1.5 px-2 md:px-3 text-xs md:text-sm">
              <PlusIcon className="w-3.5 h-3.5 md:w-4 md:h-4 md:mr-1" />
              <span className="hidden md:inline">Add Task</span>
            </button>
          </div>

          {/* Filters panel */}
          {showFilters && (
            <div className="mt-2 md:mt-3 p-2 md:p-3 bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700">
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4 md:gap-3">
                <select value={filterPhase} onChange={(e) => setFilterPhase(e.target.value)} className="input-field text-xs md:text-sm py-1 md:py-1.5">
                  <option value="">All Phases</option>
                  {phases.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}
                </select>
                <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)} className="input-field text-xs md:text-sm py-1 md:py-1.5">
                  <option value="">All Categories</option>
                  {categories.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
                </select>
                <select value={filterPriority} onChange={(e) => setFilterPriority(e.target.value)} className="input-field text-xs md:text-sm py-1 md:py-1.5">
                  <option value="">All Priorities</option>
                  {PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
                <button onClick={clearFilters} className="px-2 md:px-3 py-1 md:py-1.5 text-xs md:text-sm text-gray-600 hover:bg-gray-100 rounded-lg border border-gray-300">
                  Clear
                </button>
              </div>
            </div>
          )}

          {/* Mobile Column Selector - only visible on mobile */}
          <div className="flex md:hidden mt-2 overflow-x-auto gap-1 pb-1" style={{ scrollbarWidth: 'none' }}>
            {COLUMNS.map((col) => (
              <button
                key={col.id}
                onClick={() => setMobileColumn(col.id)}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all ${
                  mobileColumn === col.id
                    ? `${col.color} text-white`
                    : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300"
                }`}
              >
                <span className={`w-2 h-2 rounded-full ${mobileColumn === col.id ? "bg-white" : col.color}`} />
                {col.title}
                <span className="bg-white/20 px-1.5 rounded-full text-[10px]">
                  {tasksByStatus[col.id]?.length || 0}
                </span>
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* Board */}
      <div className="flex-1 overflow-hidden px-4 py-4">
        <div className="text-sm text-gray-500 mb-2">
          {filteredTasks.length} of {tasks.length} tasks {hasActiveFilters && "(filtered)"}
        </div>

        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
        >
          <div className="flex gap-3 overflow-x-auto pb-4 h-full md:flex" style={{ scrollbarWidth: 'thin' }}>
            {COLUMNS.map((column) => (
              <DroppableColumn
                key={column.id}
                column={column}
                tasks={tasksByStatus[column.id]}
                onEdit={(task) => { setEditingTask(task); setIsDetailModalOpen(false); setIsEditModalOpen(true); }}
                onDelete={handleDeleteTask}
                onViewDetails={(task) => { setViewingTask(task); setIsDetailModalOpen(true); }}
                isMobileSelected={mobileColumn === column.id}
              />
            ))}
          </div>

          <DragOverlay>{activeTask ? <TaskCard task={activeTask} /> : null}</DragOverlay>
        </DndContext>
      </div>

      {/* Modals */}
      <TaskEditModal
        task={editingTask}
        isOpen={isEditModalOpen}
        onClose={() => { setIsEditModalOpen(false); setEditingTask(null); }}
        onSave={handleSaveTask}
        phases={phases}
        categories={categories}
      />
      <TaskDetailModal
        task={viewingTask}
        isOpen={isDetailModalOpen}
        onClose={() => { setIsDetailModalOpen(false); setViewingTask(null); }}
        onEdit={(task) => { setEditingTask(task); setIsDetailModalOpen(false); setIsEditModalOpen(true); }}
        session={session}
      />
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        phases={phases}
        categories={categories}
        onPhasesChange={fetchPhases}
        onCategoriesChange={fetchCategories}
      />
    </main>
  );
}
