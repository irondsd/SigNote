'use client';

import { useEffect, useRef } from 'react';
import { useEditor, EditorContent, ReactNodeViewRenderer } from '@tiptap/react';
import type { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import CodeBlock from '@tiptap/extension-code-block';
import Link from '@tiptap/extension-link';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { toast } from 'sonner';
import s from './TiptapEditor.module.scss';
import { CodeBlockView } from './CodeBlockView';

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
};

export function TiptapEditor({ content, onChange, editable, placeholder, autoFocus, onEditorReady }: TiptapEditorProps) {
  const editableRef = useRef(editable);

  const editor = useEditor({
    immediatelyRender: false,
    autofocus: autoFocus ? 'end' : false,
    extensions: [
      StarterKit.configure({ codeBlock: false, link: false }),
      CustomCodeBlock,
      Link.configure({ openOnClick: true, autolink: true }),
      TaskList,
      TaskItem.configure({ nested: false }),
    ],
    content,
    editable,
    onUpdate: ({ editor }) => {
      if (editableRef.current) {
        onChange(editor.getHTML());
      }
    },
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
      navigator.clipboard.writeText(text)
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
