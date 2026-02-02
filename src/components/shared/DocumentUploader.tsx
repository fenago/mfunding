import { useState, useCallback } from "react";
import { DocumentArrowUpIcon, XMarkIcon, CheckCircleIcon, ExclamationCircleIcon } from "@heroicons/react/24/outline";
import supabase from "../../supabase";
import { useSession } from "../../context/SessionContext";

interface DocumentUploaderProps {
  entityType: "lender" | "customer" | "company";
  entityId: string;
  bucket: string;
  onUploadComplete: (document: UploadedDocument) => void;
  onError?: (error: string) => void;
  acceptedTypes?: string[];
  maxSizeMB?: number;
  documentType?: string;
  multiple?: boolean;
}

interface UploadedDocument {
  id: string;
  filename: string;
  storage_path: string;
  file_size: number;
  mime_type: string;
}

interface FileWithStatus {
  id: string;
  file: File;
  status: "pending" | "uploading" | "success" | "error";
  error?: string;
}

export default function DocumentUploader({
  entityType,
  entityId,
  bucket,
  onUploadComplete,
  onError,
  acceptedTypes = [".pdf", ".doc", ".docx", ".jpg", ".jpeg", ".png"],
  maxSizeMB = 10,
  documentType = "other",
  multiple = true,
}: DocumentUploaderProps) {
  const { session } = useSession();
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<FileWithStatus[]>([]);

  const maxSizeBytes = maxSizeMB * 1024 * 1024;

  const validateFile = (file: File): string | null => {
    if (file.size > maxSizeBytes) {
      return `File size exceeds ${maxSizeMB}MB limit`;
    }

    const extension = "." + file.name.split(".").pop()?.toLowerCase();
    const isValidType = acceptedTypes.some(
      (type) => type.toLowerCase() === extension || file.type.includes(type.replace(".", ""))
    );

    if (!isValidType) {
      return `Invalid file type. Accepted: ${acceptedTypes.join(", ")}`;
    }

    return null;
  };

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files);
    const filesToAdd = multiple ? files : files.slice(0, 1);

    const validFiles: FileWithStatus[] = [];
    filesToAdd.forEach((file) => {
      const error = validateFile(file);
      if (error) {
        onError?.(error);
      } else {
        validFiles.push({ id: crypto.randomUUID(), file, status: "pending" });
      }
    });

    if (validFiles.length > 0) {
      setSelectedFiles((prev) => multiple ? [...prev, ...validFiles] : validFiles);
    }
  }, [multiple, onError, maxSizeBytes, acceptedTypes]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    const filesToAdd = multiple ? files : files.slice(0, 1);

    const validFiles: FileWithStatus[] = [];
    filesToAdd.forEach((file) => {
      const error = validateFile(file);
      if (error) {
        onError?.(error);
      } else {
        validFiles.push({ id: crypto.randomUUID(), file, status: "pending" });
      }
    });

    if (validFiles.length > 0) {
      setSelectedFiles((prev) => multiple ? [...prev, ...validFiles] : validFiles);
    }

    e.target.value = "";
  };

  const uploadSingleFile = async (fileWithStatus: FileWithStatus): Promise<boolean> => {
    const { file, id } = fileWithStatus;

    // Update status to uploading
    setSelectedFiles((prev) =>
      prev.map((f) => (f.id === id ? { ...f, status: "uploading" as const } : f))
    );

    try {
      const fileExt = file.name.split(".").pop();
      const fileName = `${entityType}/${entityId}/${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from(bucket)
        .upload(fileName, file, {
          cacheControl: "3600",
          upsert: false,
        });

      if (uploadError) throw uploadError;

      const tableName = entityType === "lender"
        ? "lender_documents"
        : entityType === "customer"
          ? "customer_documents"
          : "company_documents";

      // Build the insert payload based on entity type
      const insertPayload: Record<string, unknown> = {
        document_type: documentType,
        filename: file.name,
        storage_path: fileName,
        file_size: file.size,
        mime_type: file.type,
        uploaded_by: session?.user?.id,
      };

      // Add foreign key only for lender/customer entities
      if (entityType === "lender") {
        insertPayload.lender_id = entityId;
      } else if (entityType === "customer") {
        insertPayload.customer_id = entityId;
      }

      const { data, error: dbError } = await supabase
        .from(tableName)
        .insert(insertPayload)
        .select()
        .single();

      if (dbError) throw dbError;

      // Update status to success
      setSelectedFiles((prev) =>
        prev.map((f) => (f.id === id ? { ...f, status: "success" as const } : f))
      );

      onUploadComplete({
        id: data.id,
        filename: file.name,
        storage_path: fileName,
        file_size: file.size,
        mime_type: file.type,
      });

      return true;
    } catch (error) {
      console.error("Upload error:", error);
      setSelectedFiles((prev) =>
        prev.map((f) =>
          f.id === id ? { ...f, status: "error" as const, error: "Upload failed" } : f
        )
      );
      return false;
    }
  };

  const handleUploadAll = async () => {
    if (!session?.user?.id || selectedFiles.length === 0) return;

    const pendingFiles = selectedFiles.filter((f) => f.status === "pending");
    if (pendingFiles.length === 0) return;

    setIsUploading(true);

    // Upload files sequentially to avoid overwhelming the server
    for (const fileWithStatus of pendingFiles) {
      await uploadSingleFile(fileWithStatus);
    }

    setIsUploading(false);

    // Clear successful uploads after a delay
    setTimeout(() => {
      setSelectedFiles((prev) => prev.filter((f) => f.status !== "success"));
    }, 2000);
  };

  const removeFile = (id: string) => {
    setSelectedFiles((prev) => prev.filter((f) => f.id !== id));
  };

  const clearAllFiles = () => {
    setSelectedFiles([]);
  };

  const pendingCount = selectedFiles.filter((f) => f.status === "pending").length;
  const successCount = selectedFiles.filter((f) => f.status === "success").length;

  return (
    <div className="space-y-4">
      {/* Drop Zone */}
      <label
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`block cursor-pointer ${isUploading ? "pointer-events-none opacity-50" : ""}`}
      >
        <div
          className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors ${
            isDragging
              ? "border-mint-green bg-mint-green/10"
              : "border-gray-300 dark:border-gray-600 hover:border-mint-green"
          }`}
        >
          <DocumentArrowUpIcon className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <p className="text-gray-600 dark:text-gray-400 mb-2">
            {isDragging ? "Drop files here" : `Click or drag to upload ${multiple ? "files" : "a file"}`}
          </p>
          <p className="text-sm text-gray-500">
            {acceptedTypes.join(", ")} up to {maxSizeMB}MB {multiple && "each"}
          </p>
        </div>
        <input
          type="file"
          className="hidden"
          accept={acceptedTypes.join(",")}
          onChange={handleFileSelect}
          disabled={isUploading}
          multiple={multiple}
        />
      </label>

      {/* Selected Files List */}
      {selectedFiles.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-600 dark:text-gray-400">
              {selectedFiles.length} file{selectedFiles.length !== 1 ? "s" : ""} selected
              {successCount > 0 && ` (${successCount} uploaded)`}
            </span>
            {!isUploading && pendingCount > 0 && (
              <button
                onClick={clearAllFiles}
                className="text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
              >
                Clear all
              </button>
            )}
          </div>

          <div className="max-h-60 overflow-y-auto space-y-2">
            {selectedFiles.map((fileWithStatus) => (
              <div
                key={fileWithStatus.id}
                className={`flex items-center justify-between p-3 rounded-lg border ${
                  fileWithStatus.status === "success"
                    ? "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800"
                    : fileWithStatus.status === "error"
                    ? "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800"
                    : fileWithStatus.status === "uploading"
                    ? "bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800"
                    : "bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700"
                }`}
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  {fileWithStatus.status === "success" ? (
                    <CheckCircleIcon className="w-5 h-5 text-green-500 flex-shrink-0" />
                  ) : fileWithStatus.status === "error" ? (
                    <ExclamationCircleIcon className="w-5 h-5 text-red-500 flex-shrink-0" />
                  ) : fileWithStatus.status === "uploading" ? (
                    <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />
                  ) : (
                    <DocumentArrowUpIcon className="w-5 h-5 text-gray-400 flex-shrink-0" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                      {fileWithStatus.file.name}
                    </p>
                    <p className="text-xs text-gray-500">
                      {(fileWithStatus.file.size / 1024 / 1024).toFixed(2)} MB
                      {fileWithStatus.error && (
                        <span className="text-red-500 ml-2">{fileWithStatus.error}</span>
                      )}
                    </p>
                  </div>
                </div>
                {fileWithStatus.status === "pending" && !isUploading && (
                  <button
                    onClick={() => removeFile(fileWithStatus.id)}
                    className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded"
                  >
                    <XMarkIcon className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
          </div>

          {/* Upload Button */}
          {pendingCount > 0 && (
            <button
              onClick={handleUploadAll}
              disabled={isUploading}
              className="w-full btn-primary py-2 disabled:opacity-50"
            >
              {isUploading
                ? `Uploading...`
                : `Upload ${pendingCount} file${pendingCount !== 1 ? "s" : ""}`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
