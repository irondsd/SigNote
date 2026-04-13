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
  Minus,
} from 'lucide-react';
import { cn } from '@/utils/cn';
import { Button } from '@/components/ui/button';
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
          <Button variant="ghost" size="icon-sm" title="Heading 1" onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()}>
            <Heading1 size={15} />
          </Button>
          <Button variant="ghost" size="icon-sm" title="Heading 2" onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}>
            <Heading2 size={15} />
          </Button>
          <Button variant="ghost" size="icon-sm" title="Heading 3" onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()}>
            <Heading3 size={15} />
          </Button>

          <div className={s.divider} />

          <Button variant="ghost" size="icon-sm" title="Bold" onClick={() => editor?.chain().focus().toggleBold().run()}>
            <Bold size={15} />
          </Button>
          <Button variant="ghost" size="icon-sm" title="Italic" onClick={() => editor?.chain().focus().toggleItalic().run()}>
            <Italic size={15} />
          </Button>
          <Button variant="ghost" size="icon-sm" title="Strikethrough" onClick={() => editor?.chain().focus().toggleStrike().run()}>
            <Strikethrough size={15} />
          </Button>
          <Button variant="ghost" size="icon-sm" title="Underline" onClick={() => editor?.chain().focus().toggleUnderline().run()}>
            <Underline size={15} />
          </Button>

          <div className={s.divider} />

          <Button variant="ghost" size="icon-sm" title="Inline code" onClick={() => editor?.chain().focus().toggleCode().run()}>
            <Code size={15} />
          </Button>
          <Button variant="ghost" size="icon-sm" title="Code block" onClick={() => editor?.chain().focus().toggleCodeBlock().run()}>
            <Terminal size={15} />
          </Button>

          <div className={s.divider} />

          <Button variant="ghost" size="icon-sm" title="Ordered list" onClick={() => editor?.chain().focus().toggleOrderedList().run()}>
            <ListOrdered size={15} />
          </Button>
          <Button variant="ghost" size="icon-sm" title="Bullet list" onClick={() => editor?.chain().focus().toggleBulletList().run()}>
            <List size={15} />
          </Button>
          <Button variant="ghost" size="icon-sm" title="Task list" onClick={() => editor?.chain().focus().toggleTaskList().run()}>
            <ListChecks size={15} />
          </Button>

          <div className={s.divider} />

          <Button variant="ghost" size="icon-sm" title="Divider line" onClick={() => editor?.chain().focus().setHorizontalRule().run()}>
            <Minus size={15} />
          </Button>
        </div>
      </div>
    </div>
  );
}
