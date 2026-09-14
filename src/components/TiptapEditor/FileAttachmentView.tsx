'use client';

import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { File, FileText, FileSpreadsheet, FileArchive, Trash2, X, Loader2, Download } from 'lucide-react';
import { Button } from '../ui/button';
import { useAttachmentActions } from '@/hooks/useAttachmentActions';
import s from './FileAttachmentView.module.scss';

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function FileIcon({ mimeType }: { mimeType: string }) {
  if (mimeType === 'application/pdf') return <FileText size={24} />;
  if (mimeType.includes('spreadsheet') || mimeType.includes('excel')) return <FileSpreadsheet size={24} />;
  if (mimeType === 'application/zip') return <FileArchive size={24} />;
  if (mimeType.startsWith('text/')) return <FileText size={24} />;
  return <File size={24} />;
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
  // No preview to render, so the file is only fetched when the user downloads it.
  const { handleDelete, handleDownload, downloading } = useAttachmentActions(
    fileId,
    filename,
    null,
    deleteNode,
    mimeType,
  );
  const canDownload = !isUploading && !!fileId;

  const handleCancel = (e: React.MouseEvent) => {
    e.stopPropagation();
    deleteNode();
  };

  const handleCardClick = (e: React.MouseEvent) => {
    if (!isEditable && canDownload) handleDownload(e);
  };

  return (
    <NodeViewWrapper className={s.wrapper}>
      <div
        className={`${s.card} ${isUploading ? s.uploading : ''} ${!isEditable && canDownload ? s.clickable : ''} ${selected && isEditable ? s.selected : ''}`}
        onClick={handleCardClick}
      >
        <div className={s.icon}>
          {isUploading || downloading ? <Loader2 size={24} className={s.spinner} /> : <FileIcon mimeType={mimeType} />}
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
              {canDownload && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={handleDownload}
                  disabled={downloading}
                  title="Download file"
                >
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
