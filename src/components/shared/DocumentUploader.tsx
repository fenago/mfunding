import { useState, useCallback } from "react";
import { DocumentArrowUpIcon, XMarkIcon } from "@heroicons/react/24/outline";
import supabase from "../../supabase";
import { useSession } from "../../context/SessionContext";

interface DocumentUploaderProps {
  entityType: "lender" | "customer";
  entityId: string;
  bucket: string;
  onUploadComplete: (document: UploadedDocument) => void;
  onError?: (error: string) => void;
  acceptedTypes?: string[];
  maxSizeMB?: number;
  documentType?: string;
}

interface UploadedDocument {
  id: string;
  filename: string;
  storage_path: string;
  file_size: number;
  mime_type: string;
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
}: DocumentUploaderProps) {
  const { session } = useSession();
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const maxSizeBytes = maxSizeMB * 1024 * 1024;

  const validateFile = (file: File): string | null => {
    // Check file size
    if (file.size > maxSizeBytes) {
      return `File size exceeds ${maxSizeMB}MB limit`;
    }

    // Check file type
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

    const file = e.dataTransfer.files[0];
    if (file) {
      const error = validateFile(file);
      if (error) {
        onError?.(error);
        return;
      }
      setSelectedFile(file);
    }
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const error = validateFile(file);
      if (error) {
        onError?.(error);
        return;
      }
      setSelectedFile(file);
    }
  };

  const handleUpload = async () => {
    if (!selectedFile || !session?.user?.id) return;

    setIsUploading(true);
    setUploadProgress(0);

    try {
      // Generate unique file path
      const fileExt = selectedFile.name.split(".").pop();
      const fileName = `${entityType}/${entityId}/${Date.now()}.${fileExt}`;

      // Upload to Supabase Storage
      const { error: uploadError } = await supabase.storage
        .from(bucket)
        .upload(fileName, selectedFile, {
          cacheControl: "3600",
          upsert: false,
        });

      if (uploadError) throw uploadError;

      setUploadProgress(50);

      // Determine the table based on entity type
      const tableName = entityType === "lender" ? "lender_documents" : "customer_documents";
      const foreignKey = entityType === "lender" ? "lender_id" : "customer_id";

      // Create document record in database
      const { data, error: dbError } = await supabase
        .from(tableName)
        .insert({
          [foreignKey]: entityId,
          document_type: documentType,
          filename: selectedFile.name,
          storage_path: fileName,
          file_size: selectedFile.size,
          mime_type: selectedFile.type,
          uploaded_by: session.user.id,
        })
        .select()
        .single();

      if (dbError) throw dbError;

      setUploadProgress(100);

      onUploadComplete({
        id: data.id,
        filename: selectedFile.name,
        storage_path: fileName,
        file_size: selectedFile.size,
        mime_type: selectedFile.type,
      });

      setSelectedFile(null);
    } catch (error) {
      console.error("Upload error:", error);
      onError?.("Failed to upload document. Please try again.");
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
    }
  };

  const clearSelectedFile = () => {
    setSelectedFile(null);
  };

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
            {isDragging ? "Drop file here" : "Click or drag to upload"}
          </p>
          <p className="text-sm text-gray-500">
            {acceptedTypes.join(", ")} up to {maxSizeMB}MB
          </p>
        </div>
        <input
          type="file"
          className="hidden"
          accept={acceptedTypes.join(",")}
          onChange={handleFileSelect}
          disabled={isUploading}
        />
      </label>

      {/* Selected File Preview */}
      {selectedFile && (
        <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-3 min-w-0">
            <DocumentArrowUpIcon className="w-8 h-8 text-gray-400 flex-shrink-0" />
            <div className="min-w-0">
              <p className="font-medium text-gray-900 dark:text-white truncate">
                {selectedFile.name}
              </p>
              <p className="text-sm text-gray-500">
                {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {!isUploading && (
              <button
                onClick={clearSelectedFile}
                className="p-1 text-gray-400 hover:text-gray-600 rounded"
              >
                <XMarkIcon className="w-5 h-5" />
              </button>
            )}
            <button
              onClick={handleUpload}
              disabled={isUploading}
              className="btn-primary text-sm px-4 py-2 disabled:opacity-50"
            >
              {isUploading ? `Uploading ${uploadProgress}%` : "Upload"}
            </button>
          </div>
        </div>
      )}

      {/* Upload Progress */}
      {isUploading && (
        <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
          <div
            className="bg-mint-green h-2 rounded-full transition-all duration-300"
            style={{ width: `${uploadProgress}%` }}
          />
        </div>
      )}
    </div>
  );
}
