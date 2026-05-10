'use client';

import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { File, FileText, FileSpreadsheet, FileArchive, Trash2, X, Loader2, Download } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../ui/button';
import { useDecryptedFile } from '@/hooks/useDecryptedFile';
import s from './FileAttachmentView.module.scss';

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileIcon(mimeType: string) {
  if (mimeType === 'application/pdf') return FileText;
  if (mimeType.includes('spreadsheet') || mimeType.includes('excel')) return FileSpreadsheet;
  if (mimeType === 'application/zip') return FileArchive;
  if (mimeType.startsWith('text/')) return FileText;
  return File;
}

function getMimeLabel(mimeType: string): string {
  const map: Record<string, string> = {
    'application/pdf': 'PDF',
    'application/msword': 'DOC',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
    'application/vnd.ms-excel': 'XLS',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'XLSX',
    'text/plain': 'TXT',
    'text/csv': 'CSV',
    'text/markdown': 'MD',
    'application/zip': 'ZIP',
  };
  return map[mimeType] ?? mimeType.split('/').pop()?.toUpperCase() ?? 'FILE';
}

export function FileAttachmentView({ node, deleteNode, editor, selected }: NodeViewProps) {
  const { fileId, filename, size, mimeType, uploadStatus } = node.attrs;
  const isEditable = editor.isEditable;
  const isUploading = uploadStatus === 'uploading';
  const IconComponent = getFileIcon(mimeType);
  const { blobUrl } = useDecryptedFile(isUploading ? null : fileId);

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!fileId) {
      deleteNode();
      return;
    }
    try {
      const res = await fetch(`/api/files/${fileId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
      deleteNode();
    } catch {
      toast.error('Failed to delete file');
    }
  };

  const handleCancel = (e: React.MouseEvent) => {
    e.stopPropagation();
    deleteNode();
  };

  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (blobUrl) {
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename;
      a.click();
    }
  };

  const handleCardClick = () => {
    if (!isEditable && blobUrl) {
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename;
      a.click();
    }
  };

  return (
    <NodeViewWrapper className={s.wrapper}>
      <div
        className={`${s.card} ${isUploading ? s.uploading : ''} ${!isEditable && blobUrl ? s.clickable : ''} ${selected && isEditable ? s.selected : ''}`}
        onClick={handleCardClick}
      >
        <div className={s.icon}>
          {isUploading ? <Loader2 size={24} className={s.spinner} /> : <IconComponent size={24} />}
        </div>
        <div className={s.info}>
          <span className={s.filename}>{filename}</span>
          <span className={s.meta}>
            <span className={s.badge}>{getMimeLabel(mimeType)}</span>
            <span>{formatFileSize(size)}</span>
          </span>
        </div>
        <div className={s.actions}>
          {isUploading ? (
            <Button variant="ghost" size="icon-sm" onClick={handleCancel} title="Cancel upload">
              <X size={16} />
            </Button>
          ) : (
            <>
              {blobUrl && (
                <Button variant="ghost" size="icon-sm" onClick={handleDownload} title="Download file">
                  <Download size={16} />
                </Button>
              )}
              {isEditable && (
                <Button variant="ghost" size="icon-sm" onClick={handleDelete} title="Delete file">
                  <Trash2 size={16} />
                </Button>
              )}
            </>
          )}
        </div>
      </div>
    </NodeViewWrapper>
  );
}
