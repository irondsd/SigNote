'use client';

import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { Trash2, Download, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../ui/button';
import s from './ImageAttachmentView.module.scss';

export function ImageAttachmentView({ node, deleteNode, editor, selected }: NodeViewProps) {
  const { fileId, filename, uploadStatus } = node.attrs;
  const isEditable = editor.isEditable;
  const isUploading = uploadStatus === 'uploading';

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
      toast.error('Failed to delete image');
    }
  };

  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (fileId) {
      window.open(`/api/files/${fileId}`, '_blank');
    }
  };

  return (
    <NodeViewWrapper className={s.wrapper}>
      {isUploading ? (
        <div className={s.placeholder}>
          <Loader2 size={24} className={s.spinner} />
          <span>Uploading {filename}...</span>
        </div>
      ) : (
        <div className={`${s.imageContainer} ${selected && isEditable ? s.selected : ''}`}>
          {/* eslint-disable-next-line @next/next/no-img-element -- Tiptap node view, not a page component */}
          <img src={`/api/files/${fileId}`} alt={filename} className={s.image} draggable={false} />
          <div className={s.overlay}>
            <Button variant="ghost" size="icon-sm" onClick={handleDownload} title="Download image" className={s.overlayBtn}>
              <Download size={16} />
            </Button>
            {isEditable && (
              <Button variant="ghost" size="icon-sm" onClick={handleDelete} title="Delete image" className={s.overlayBtn}>
                <Trash2 size={16} />
              </Button>
            )}
          </div>
        </div>
      )}
    </NodeViewWrapper>
  );
}
