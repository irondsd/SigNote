'use client';

import { useEffect, useRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { toast } from 'sonner';
import styles from './TiptapEditor.module.scss';

type TiptapEditorProps = {
  content: string;
  onChange: (html: string) => void;
  editable: boolean;
  placeholder?: string;
};

export function TiptapEditor({ content, onChange, editable, placeholder }: TiptapEditorProps) {
  const editableRef = useRef(editable);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
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

  const handleClick = (e: React.MouseEvent) => {
    if (!editable && (e.target as HTMLElement).tagName === 'CODE') {
      const text = (e.target as HTMLElement).textContent ?? '';
      navigator.clipboard.writeText(text).then(() => {
        toast.success('Copied to clipboard');
      });
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
      className={`${styles.editor} ${editable ? styles.editable : styles.readonly}`}
      data-placeholder={placeholder}
      onClick={handleClick}
      onMouseDown={handleMouseDown}
    >
      <EditorContent editor={editor} />
    </div>
  );
}
