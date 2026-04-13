'use client';

import type { Editor } from '@tiptap/core';
import {
  Heading1,
  Heading2,
  Heading3,
  Bold,
  Italic,
  Strikethrough,
  Underline,
  Code,
  Terminal,
  ListOrdered,
  List,
  ListChecks,
} from 'lucide-react';
import { cn } from '@/utils/cn';
import s from './FormattingToolbar.module.scss';

type Props = {
  editor: Editor | null;
  isOpen: boolean;
};

export function FormattingToolbar({ editor, isOpen }: Props) {
  return (
    <div className={cn(s.wrapper, isOpen && s.open)}>
      <div className={s.inner}>
        <div className={s.row}>
          <button
            className={s.btn}
            title="Heading 1"
            onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()}
          >
            <Heading1 size={15} />
          </button>
          <button
            className={s.btn}
            title="Heading 2"
            onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
          >
            <Heading2 size={15} />
          </button>
          <button
            className={s.btn}
            title="Heading 3"
            onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()}
          >
            <Heading3 size={15} />
          </button>

          <div className={s.divider} />

          <button
            className={s.btn}
            title="Bold"
            onClick={() => editor?.chain().focus().toggleBold().run()}
          >
            <Bold size={15} />
          </button>
          <button
            className={s.btn}
            title="Italic"
            onClick={() => editor?.chain().focus().toggleItalic().run()}
          >
            <Italic size={15} />
          </button>
          <button
            className={s.btn}
            title="Strikethrough"
            onClick={() => editor?.chain().focus().toggleStrike().run()}
          >
            <Strikethrough size={15} />
          </button>
          <button
            className={s.btn}
            title="Underline"
            onClick={() => editor?.chain().focus().toggleUnderline().run()}
          >
            <Underline size={15} />
          </button>

          <div className={s.divider} />

          <button
            className={s.btn}
            title="Inline code"
            onClick={() => editor?.chain().focus().toggleCode().run()}
          >
            <Code size={15} />
          </button>
          <button
            className={s.btn}
            title="Code block"
            onClick={() => editor?.chain().focus().toggleCodeBlock().run()}
          >
            <Terminal size={15} />
          </button>

          <div className={s.divider} />

          <button
            className={s.btn}
            title="Ordered list"
            onClick={() => editor?.chain().focus().toggleOrderedList().run()}
          >
            <ListOrdered size={15} />
          </button>
          <button
            className={s.btn}
            title="Bullet list"
            onClick={() => editor?.chain().focus().toggleBulletList().run()}
          >
            <List size={15} />
          </button>
          <button
            className={s.btn}
            title="Task list"
            onClick={() => editor?.chain().focus().toggleTaskList().run()}
          >
            <ListChecks size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}
