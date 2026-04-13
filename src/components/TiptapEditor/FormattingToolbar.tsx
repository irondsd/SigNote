'use client';

import React from 'react';
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
  Type,
} from 'lucide-react';
import { cn } from '@/utils/cn';
import { Button } from '@/components/ui/button';
import s from './FormattingToolbar.module.scss';

type Props = {
  editor: Editor | null;
  isOpen: boolean;
};

// On desktop: onMouseDown preventDefault keeps editor focused when clicking toolbar buttons.
// On mobile: touchstart preventDefault stops the browser from dismissing the keyboard.
// Since preventing touchstart cancels click synthesis, we run the action on touchend instead.
export function FormatToggleButton({ isActive, onToggle }: { isActive: boolean; onToggle: () => void }) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      title="Formatting options"
      onMouseDown={(e) => e.preventDefault()}
      onTouchStart={(e) => e.preventDefault()}
      onTouchEnd={(e) => { e.preventDefault(); onToggle(); }}
      onClick={onToggle}
      className={cn(isActive && s.toggleActive)}
    >
      <Type size={15} />
    </Button>
  );
}

function ToolbarButton({ title, action, children }: { title: string; action: () => void; children: React.ReactNode }) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      title={title}
      onMouseDown={(e) => e.preventDefault()}
      onTouchStart={(e) => e.preventDefault()}
      onTouchEnd={(e) => {
        e.preventDefault();
        action();
      }}
      onClick={action}
    >
      {children}
    </Button>
  );
}

export function FormattingToolbar({ editor, isOpen }: Props) {
  return (
    <div className={cn(s.wrapper, isOpen && s.open)}>
      <div className={s.inner}>
        <div className={s.row}>
          <ToolbarButton title="Heading 1" action={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()}>
            <Heading1 size={15} />
          </ToolbarButton>
          <ToolbarButton title="Heading 2" action={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}>
            <Heading2 size={15} />
          </ToolbarButton>
          <ToolbarButton title="Heading 3" action={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()}>
            <Heading3 size={15} />
          </ToolbarButton>

          <div className={s.divider} />

          <ToolbarButton title="Bold" action={() => editor?.chain().focus().toggleBold().run()}>
            <Bold size={15} />
          </ToolbarButton>
          <ToolbarButton title="Italic" action={() => editor?.chain().focus().toggleItalic().run()}>
            <Italic size={15} />
          </ToolbarButton>
          <ToolbarButton title="Strikethrough" action={() => editor?.chain().focus().toggleStrike().run()}>
            <Strikethrough size={15} />
          </ToolbarButton>
          <ToolbarButton title="Underline" action={() => editor?.chain().focus().toggleUnderline().run()}>
            <Underline size={15} />
          </ToolbarButton>

          <div className={s.divider} />

          <ToolbarButton title="Inline code" action={() => editor?.chain().focus().toggleCode().run()}>
            <Code size={15} />
          </ToolbarButton>
          <ToolbarButton title="Code block" action={() => editor?.chain().focus().toggleCodeBlock().run()}>
            <Terminal size={15} />
          </ToolbarButton>

          <div className={s.divider} />

          <ToolbarButton title="Ordered list" action={() => editor?.chain().focus().toggleOrderedList().run()}>
            <ListOrdered size={15} />
          </ToolbarButton>
          <ToolbarButton title="Bullet list" action={() => editor?.chain().focus().toggleBulletList().run()}>
            <List size={15} />
          </ToolbarButton>
          <ToolbarButton title="Task list" action={() => editor?.chain().focus().toggleTaskList().run()}>
            <ListChecks size={15} />
          </ToolbarButton>

          <div className={s.divider} />

          <ToolbarButton title="Divider line" action={() => editor?.chain().focus().setHorizontalRule().run()}>
            <Minus size={15} />
          </ToolbarButton>
        </div>
      </div>
    </div>
  );
}
