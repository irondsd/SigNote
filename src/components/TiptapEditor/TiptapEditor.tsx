'use client';

import { useEffect, useRef, useMemo } from 'react';
import { useEditor, EditorContent, ReactNodeViewRenderer } from '@tiptap/react';
import type { Editor, Extension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import CodeBlock from '@tiptap/extension-code-block';
import Link from '@tiptap/extension-link';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { toast } from 'sonner';
import s from './TiptapEditor.module.scss';
import { CodeBlockView } from './CodeBlockView';
import { FileAttachmentNode } from './extensions/FileAttachmentNode';
import { ImageAttachmentNode } from './extensions/ImageAttachmentNode';
import { FileDropHandler } from './extensions/FileDropHandler';
import { DropZoneNode } from './extensions/DropZoneNode';
import type { FileEncryptionContext } from './utils/uploadFile';

export type { FileEncryptionContext };

const CustomCodeBlock = CodeBlock.extend({
  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockView);
  },
});

type TiptapEditorProps = {
  content: string;
  onChange: (html: string) => void;
  editable: boolean;
  placeholder?: string;
  autoFocus?: boolean;
  onEditorReady?: (editor: Editor) => void;
  allowFileUpload?: boolean;
  onUploadingChange?: (isUploading: boolean) => void;
  fileEncryptionCtx?: FileEncryptionContext;
  requiresEncryption?: boolean;
};

export function TiptapEditor({
  content,
  onChange,
  editable,
  placeholder,
  autoFocus,
  onEditorReady,
  allowFileUpload = false,
  onUploadingChange,
  fileEncryptionCtx,
  requiresEncryption = false,
}: TiptapEditorProps) {
  const editableRef = useRef(editable);
  const uploadingRef = useRef(false);
  const onUploadingChangeRef = useRef(onUploadingChange);
  onUploadingChangeRef.current = onUploadingChange;
  const encryptionRef = useRef<{ ctx: FileEncryptionContext | undefined; required: boolean }>({
    ctx: fileEncryptionCtx,
    required: requiresEncryption,
  });
  encryptionRef.current = { ctx: fileEncryptionCtx, required: requiresEncryption };

  const extensions = useMemo(() => {
    const base: Extension[] = [
      StarterKit.configure({ codeBlock: false, link: false }) as unknown as Extension,
      CustomCodeBlock as unknown as Extension,
      Link.configure({ openOnClick: true, autolink: true }) as unknown as Extension,
      TaskList as unknown as Extension,
      TaskItem.configure({ nested: false }) as unknown as Extension,
    ];
    if (allowFileUpload) {
      base.push(
        FileAttachmentNode as unknown as Extension,
        ImageAttachmentNode as unknown as Extension,
        FileDropHandler.configure({ encryptionRef }) as unknown as Extension,
        DropZoneNode as unknown as Extension,
      );
    }
    return base;
  }, [allowFileUpload, encryptionRef]);

  const editor = useEditor({
    immediatelyRender: false,
    autofocus: autoFocus ? 'end' : false,
    extensions,
    content,
    editable,
    onUpdate: ({ editor }) => {
      if (editableRef.current) {
        let html = editor.getHTML();
        // remove drop zones from the output HTML on save, so they don't persist in the content after save
        html = html.replace(/<div data-type="drop-zone"><\/div>/g, '');
        onChange(html);
      }
    },
    onTransaction: allowFileUpload
      ? ({ editor }) => {
          const storage = editor.extensionManager.extensions.find((e) => e.name === 'fileDropHandler')?.storage;
          const count = storage?.fileUploadCounter ?? 0;
          const isUploading = count > 0;
          if (isUploading !== uploadingRef.current) {
            uploadingRef.current = isUploading;
            onUploadingChangeRef.current?.(isUploading);
          }
        }
      : undefined,
  });

  useEffect(() => {
    editableRef.current = editable;
    editor?.setEditable(editable);
  }, [editor, editable]);

  useEffect(() => {
    if (editor) onEditorReady?.(editor);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  const handleClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (!editable && target.tagName === 'CODE' && !target.closest('pre')) {
      const text = target.textContent ?? '';
      navigator.clipboard
        .writeText(text)
        .then(() => toast.success('Copied to clipboard'))
        .catch(() => toast.error('Could not copy to clipboard'));
    }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (editable || !editor) return;
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' && (target as HTMLInputElement).type === 'checkbox') {
      e.preventDefault(); // block browser default toggle + NodeView's change handler
      const li = target.closest('li');
      if (!li) return;
      try {
        const nodePos = editor.view.posAtDOM(li, 0) - 1;
        const node = editor.state.doc.nodeAt(nodePos);
        if (node?.type.name === 'taskItem') {
          editor.view.dispatch(
            editor.state.tr.setNodeMarkup(nodePos, undefined, {
              ...node.attrs,
              checked: !node.attrs.checked,
            }),
          );
          onChange(editor.getHTML());
        }
      } catch {
        // posAtDOM can throw if the node isn't mapped
      }
    }
  };

  return (
    <div
      data-testid="tiptap-editor"
      className={`${s.editor} ${editable ? s.editable : s.readonly}`}
      data-placeholder={placeholder}
      onClick={handleClick}
      onMouseDown={handleMouseDown}
    >
      <EditorContent editor={editor} />
    </div>
  );
}
