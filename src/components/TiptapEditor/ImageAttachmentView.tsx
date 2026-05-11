'use client';

import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { Trash2, Download, Loader2, ImageOff } from 'lucide-react';
import { Button } from '../ui/button';
import { useDecryptedFile } from '@/hooks/useDecryptedFile';
import { useAttachmentActions } from '@/hooks/useAttachmentActions';
import s from './ImageAttachmentView.module.scss';

export function ImageAttachmentView({ node, deleteNode, editor, selected }: NodeViewProps) {
  const { fileId, filename, uploadStatus } = node.attrs;
  const isEditable = editor.isEditable;
  const isUploading = uploadStatus === 'uploading';
  const { blobUrl, loading: decrypting, error } = useDecryptedFile(isUploading ? null : fileId);
  const { handleDelete, handleDownload } = useAttachmentActions(fileId, filename, blobUrl, deleteNode);

  return (
    <NodeViewWrapper className={s.wrapper}>
      {isUploading || decrypting ? (
        <div className={s.placeholder}>
          <Loader2 size={24} className={s.spinner} />
          <span>{isUploading ? `Uploading ${filename}...` : 'Loading...'}</span>
        </div>
      ) : error ? (
        <div className={s.placeholder}>
          <ImageOff size={24} />
          <span>Unable to load image</span>
        </div>
      ) : blobUrl ? (
        <div className={`${s.imageContainer} ${selected && isEditable ? s.selected : ''}`}>
          {/* eslint-disable-next-line @next/next/no-img-element -- Tiptap node view, not a page component */}
          <img src={blobUrl} alt={filename} className={s.image} draggable={false} />
          <div className={s.overlay}>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={handleDownload}
              title="Download image"
              className={s.overlayBtn}
            >
              <Download size={16} />
            </Button>
            {isEditable && (
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={handleDelete}
                title="Delete image"
                className={s.overlayBtn}
              >
                <Trash2 size={16} />
              </Button>
            )}
          </div>
        </div>
      ) : null}
    </NodeViewWrapper>
  );
}
