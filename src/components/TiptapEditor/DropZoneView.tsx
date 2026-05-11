'use client';

import { useRef, useState, useCallback } from 'react';
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { Upload } from 'lucide-react';
import { toast } from 'sonner';
import { uploadFileToEditor } from './utils/uploadFile';
import { useFileEncryption } from '@/contexts/FileEncryptionContext';
import s from './DropZoneView.module.scss';

export function DropZoneView({ editor, deleteNode }: NodeViewProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { mek } = useFileEncryption();
  const isEditable = editor.isEditable;

  const requiresEncryption = !!(
    editor.extensionManager.extensions.find((e) => e.name === 'fileDropHandler')?.options as
      | { encryptionRef?: { current: { required: boolean } } }
      | undefined
  )?.encryptionRef?.current?.required;

  const handleFiles = useCallback(
    (files: FileList | File[]) => {
      const fileArray = Array.from(files);
      if (!fileArray.length) return;
      if (requiresEncryption && !mek) {
        toast.error('Unlock required to attach files');
        return;
      }
      deleteNode();
      const encCtx = mek ? { mek } : undefined;
      for (const file of fileArray) {
        uploadFileToEditor(editor, file, encCtx);
      }
    },
    [editor, deleteNode, mek, requiresEncryption],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);
      if (e.dataTransfer.files.length) {
        handleFiles(e.dataTransfer.files);
      }
    },
    [handleFiles],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleClick = useCallback(() => {
    inputRef.current?.click();
  }, []);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files?.length) {
        handleFiles(e.target.files);
      }
    },
    [handleFiles],
  );

  if (!isEditable) return <NodeViewWrapper />;

  return (
    <NodeViewWrapper>
      <div
        className={`${s.dropZone} ${isDragOver ? s.dragOver : ''}`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={handleClick}
      >
        <Upload size={20} />
        <span>Drop file here or click to browse</span>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="image/jpeg,image/png,image/gif,image/webp,image/svg+xml,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/plain,text/csv,text/markdown,application/zip"
          onChange={handleInputChange}
          className={s.hiddenInput}
        />
      </div>
    </NodeViewWrapper>
  );
}
