'use client';

import { useMemo, useState } from 'react';
import DOMPurify from 'dompurify';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Copy, CopyPlus, History, Info, RotateCcw, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/utils/cn';
import { Button } from '@/components/ui/button';
import { Backdrop } from '@/components/Backdrop/Backdrop';
import { Modal } from '@/components/Modal/Modal';
import { getRelativeTime } from '@/utils/getRelativeTime';
import { useDeleteVersion, useRestoreVersion, versionsKey, type VersionTier } from '@/hooks/useVersions';
import { MAX_VERSIONS } from '@/config/constants';
import editorStyles from '@/components/TiptapEditor/TiptapEditor.module.scss';
import s from './VersionHistoryModal.module.scss';

// Same allowances as NoteCard: keep Tiptap's attachment markup intact.
const PURIFY_CONFIG = {
  ADD_TAGS: ['div'],
  ADD_ATTR: ['data-type', 'data-file-id', 'data-filename', 'data-size', 'data-mime-type'],
};

export const CURRENT_VERSION_ID = 'current';

// A version ready for display: bodies are plaintext HTML (tier modals decrypt
// before handing them over). The head travels as one of these too, with
// _id = CURRENT_VERSION_ID.
export type DisplayVersion = {
  _id: string;
  title: string;
  content: string;
  createdAt: string | Date;
};

type VersionHistoryModalProps = {
  tier: VersionTier;
  noteId: string;
  color: string | null;
  pattern: string | null;
  current: DisplayVersion;
  /** Past versions, newest first. undefined = still loading. */
  versions: DisplayVersion[] | undefined;
  /** Back to the regular note modal. */
  onClose: () => void;
  /** The head changed (restore/undo) — parent syncs its local title/content. */
  onRestored: (v: DisplayVersion) => void;
  /** Tier-specific "save as new note" (re-encrypts where needed). */
  onDuplicate: (v: { title: string; content: string }) => void;
};

function formatAbsolute(date: string | Date): string {
  return new Date(date).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function htmlToPlainText(html: string): string {
  const el = document.createElement('div');
  el.innerHTML = DOMPurify.sanitize(html, PURIFY_CONFIG);
  return el.textContent?.trim() ?? '';
}

export function VersionHistoryModal({
  tier,
  noteId,
  color,
  pattern,
  current,
  versions,
  onClose,
  onRestored,
  onDuplicate,
}: VersionHistoryModalProps) {
  const qc = useQueryClient();
  const restoreVersion = useRestoreVersion(tier);
  const deleteVersion = useDeleteVersion(tier);

  const [selectedId, setSelectedId] = useState(CURRENT_VERSION_ID);
  const [previewId, setPreviewId] = useState<string | null>(null);
  // Hover previews only make sense with a real pointer; on touch, tap selects.
  const [canHover] = useState(() => typeof window !== 'undefined' && window.matchMedia('(hover: hover)').matches);

  const entries = useMemo(() => [current, ...(versions ?? [])], [current, versions]);
  const shown = entries.find((v) => v._id === (previewId ?? selectedId)) ?? current;
  const shownIsCurrent = shown._id === CURRENT_VERSION_ID;

  const bodyHtml = useMemo(() => DOMPurify.sanitize(shown.content, PURIFY_CONFIG), [shown.content]);

  const handleRestore = (v: DisplayVersion) => {
    const previousHead = current;
    restoreVersion.mutate(
      { id: noteId, versionId: v._id },
      {
        onSuccess: () => {
          onRestored(v);
          setSelectedId(CURRENT_VERSION_ID);
          setPreviewId(null);
          toast.success(`Restored version from ${getRelativeTime(v.createdAt)}`, {
            description: 'Your previous note was saved to history.',
            duration: 7000,
            action: {
              label: 'Undo',
              onClick: () => {
                // The raw cache is oldest → newest; restore just pushed the
                // pre-restore head as the newest entry.
                const raw = qc.getQueryData<{ _id: string }[]>(versionsKey(tier, noteId));
                const newest = raw?.[raw.length - 1];
                if (!newest) return;
                restoreVersion.mutate(
                  { id: noteId, versionId: newest._id },
                  {
                    onSuccess: () => {
                      onRestored(previousHead);
                      toast.success('Restore undone');
                    },
                    onError: () => toast.error('Failed to undo restore'),
                  },
                );
              },
            },
          });
        },
        onError: () => toast.error('Failed to restore version'),
      },
    );
  };

  const handleDelete = (v: DisplayVersion) => {
    if (selectedId === v._id) setSelectedId(CURRENT_VERSION_ID);
    setPreviewId(null);
    deleteVersion.mutate(
      { id: noteId, versionId: v._id },
      { onError: () => toast.error('Failed to delete version') },
    );
  };

  const handleCopy = async (v: DisplayVersion) => {
    await navigator.clipboard.writeText(htmlToPlainText(v.content));
    toast.success('Copied to clipboard');
  };

  const handleDuplicate = (v: DisplayVersion) => {
    onDuplicate({ title: v.title, content: v.content });
    toast.success('Saved as new note');
  };

  return (
    // No entrance animations: the surface morphs from the note modal in place.
    <Backdrop onClose={onClose} animate={false}>
      <Modal className={s.modal} animate={false} data-color={color || undefined}>
        <div className={s.noteColumn}>
          <div className={s.header}>
            <h2 data-testid="version-title" className={s.title}>
              {shown.title || 'Untitled'}
            </h2>
            <Button variant="ghost" size="icon-sm" onClick={onClose} title="Close history" aria-label="Close history">
              <X size={18} />
            </Button>
          </div>

          <div className={s.bodyWrap} data-pattern={pattern || undefined}>
            <div data-testid="version-content" className={cn(s.body, !shownIsCurrent && s.past)}>
              <div className={editorStyles.editor}>
                <div className="ProseMirror" dangerouslySetInnerHTML={{ __html: bodyHtml }} />
              </div>
            </div>
          </div>

          <div className={s.actionBar}>
            <div className={s.actionIcons}>
              <Button
                data-testid="version-copy-btn"
                variant="ghost"
                size="icon-sm"
                onClick={() => handleCopy(shown)}
                title="Copy content"
                aria-label="Copy version content"
              >
                <Copy size={15} />
              </Button>
              <Button
                data-testid="version-duplicate-btn"
                variant="ghost"
                size="icon-sm"
                onClick={() => handleDuplicate(shown)}
                title="Save as new note"
                aria-label="Save version as new note"
              >
                <CopyPlus size={15} />
              </Button>
              {!shownIsCurrent && (
                <Button
                  data-testid="version-delete-btn"
                  variant="destructive"
                  size="icon-sm"
                  onClick={() => handleDelete(shown)}
                  title="Delete this version"
                  aria-label="Delete this version"
                >
                  <Trash2 size={15} />
                </Button>
              )}
            </div>
            {shownIsCurrent ? (
              <div className={s.latestNote}>
                <Check size={13} />
                You&rsquo;re on the latest version
              </div>
            ) : (
              <Button
                data-testid="version-restore-btn"
                size="sm"
                onClick={() => handleRestore(shown)}
                disabled={restoreVersion.isPending}
              >
                <RotateCcw size={14} />
                {restoreVersion.isPending ? 'Restoring…' : 'Restore'}
              </Button>
            )}
          </div>
        </div>

        <aside className={s.sidebar} data-testid="version-sidebar">
          <div className={s.sidebarHeader}>
            <div className={s.sidebarTitle}>
              <History size={15} />
              Version history
              <span data-testid="version-count" className={s.countBadge}>
                {entries.length}
              </span>
            </div>
            <Button
              data-testid="version-history-close"
              variant="ghost"
              size="icon-sm"
              onClick={onClose}
              title="Close history"
              aria-label="Close history"
            >
              <X size={15} />
            </Button>
          </div>

          <div className={s.list} onMouseLeave={canHover ? () => setPreviewId(null) : undefined}>
            {versions === undefined ? (
              <>
                <div className={s.skeletonRow} />
                <div className={s.skeletonRow} />
                <div className={s.skeletonRow} />
              </>
            ) : (
              entries.map((v, i) => {
                const isCurrent = v._id === CURRENT_VERSION_ID;
                const isActive = v._id === (previewId ?? selectedId);
                // Oldest visible entry counts as version 1; numbering shifts as
                // the capped history drops old rows, which is fine for orientation.
                const number = entries.length - i;
                const isOrigin = i === entries.length - 1 && (versions?.length ?? 0) < MAX_VERSIONS;
                return (
                  <div
                    key={v._id}
                    data-testid="version-row"
                    role="button"
                    tabIndex={0}
                    className={cn(s.row, isActive && s.active)}
                    onClick={() => setSelectedId(v._id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') setSelectedId(v._id);
                    }}
                    onMouseEnter={canHover ? () => setPreviewId(v._id) : undefined}
                  >
                    <span className={s.rail}>
                      <span className={cn(s.dot, (isActive || isCurrent) && s.dotActive)} />
                    </span>
                    <span className={s.rowBody}>
                      <span className={s.rowTop}>
                        <span className={s.rel}>{getRelativeTime(v.createdAt)}</span>
                        {isCurrent && <span className={s.currentPill}>Current</span>}
                      </span>
                      <span className={s.abs}>{formatAbsolute(v.createdAt)}</span>
                      <span className={s.meta}>{isOrigin && !isCurrent ? `Version ${number} · Created` : `Version ${number}`}</span>
                    </span>
                  </div>
                );
              })
            )}
          </div>

          <div className={s.hint}>
            <Info size={12} />
            The last {MAX_VERSIONS} edits are kept. Restoring is non-destructive.
          </div>
        </aside>
      </Modal>
    </Backdrop>
  );
}
