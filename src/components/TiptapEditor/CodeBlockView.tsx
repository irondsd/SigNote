'use client';

import { NodeViewWrapper, NodeViewContent, type NodeViewProps } from '@tiptap/react';
import { Copy } from 'lucide-react';
import { toast } from 'sonner';
import styles from './CodeBlockView.module.scss';
import { Button } from '../ui/button';

export function CodeBlockView({ node, editor }: NodeViewProps) {
  const language: string | null = node.attrs.language ?? null;
  const isEditable = editor.isEditable;
  const hasOverlay = !!language || !isEditable;

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(node.textContent).then(() => {
      toast.success('Copied to clipboard');
    });
  };

  return (
    <NodeViewWrapper className={`${styles.wrapper} ${hasOverlay ? styles.withOverlay : ''}`}>
      {language && <span className={styles.langBadge}>{language}</span>}
      <Button className={styles.copyBtn} onClick={handleCopy} aria-label="Copy code">
        <Copy size={14} />
      </Button>
      <pre>
        <NodeViewContent as={'code' as 'div'} className={language ? `language-${language}` : undefined} />
      </pre>
    </NodeViewWrapper>
  );
}
