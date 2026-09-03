'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { toast } from 'sonner';
import {
  useCreateNote,
  useDeleteNote,
  useUndeleteNote,
  useUpdateNote,
  type CachedNote,
} from '@/hooks/useNoteMutations';
import { useVersions, type PlainVersion } from '@/hooks/useVersions';
import { CURRENT_VERSION_ID, type DisplayVersion } from '@/components/VersionHistoryModal/VersionHistoryModal';
import { useNoteModalMeta } from '@/hooks/useNoteModalMeta';
import { TiptapEditor } from '@/components/TiptapEditor/TiptapEditor';
import { FormattingToolbar, FormatToggleButton } from '@/components/TiptapEditor/FormattingToolbar';
import { SharedNoteModal } from '@/components/SharedNoteModal/SharedNoteModal';
import { NoteActionsMenu } from '@/components/NoteActionsMenu/NoteActionsMenu';
import { ConfirmDiscardDialog } from '@/components/ConfirmDiscardDialog/ConfirmDiscardDialog';
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';
import { MAX_TITLE, MAX_CONTENT } from '@/config/constants';
import { clearDraft, saveDraft } from '@/lib/draft';

const VersionHistoryModal = dynamic(
  () => import('@/components/VersionHistoryModal/VersionHistoryModal').then((m) => m.VersionHistoryModal),
  { ssr: false },
);

type NoteModalProps = {
  note: CachedNote;
  onClose: () => void;
  cardRect?: DOMRect;
};

export function NoteModal({ note, onClose, cardRect }: NoteModalProps) {
  const [content, setContent] = useState(note.content ?? '');

  const deleteNote = useDeleteNote();
  const undeleteNote = useUndeleteNote();
  const updateNote = useUpdateNote();
  const createNote = useCreateNote();

  const {
    noteId,
    editing,
    setEditing,
    title,
    setTitle,
    isArchived,
    color,
    pattern,
    stylePickerOpen,
    setStylePickerOpen,
    updatedAt,
    setUpdatedAt,
    showFormatBar,
    setShowFormatBar,
    editor,
    setEditor,
    isUploading,
    setIsUploading,
    pinned,
    expiresAt,
    burnAfterReading,
    tags,
    historyOpen,
    setHistoryOpen,
    historyWasOpen,
    setHistoryWasOpen,
    menuOpened,
    setMenuOpened,
    handleArchiveToggle,
    handleColorChange,
    handlePatternChange,
    handleTagsChange,
    handleTogglePinned,
    handleSetExpiry,
    wasInitiallyBurning,
  } = useNoteModalMeta(note, (patch) => updateNote.mutate(patch));

  const openHistory = () => {
    setHistoryOpen(true);
    setHistoryWasOpen(true);
  };

  const isDirty = editing && (title !== (note.title ?? '') || content !== (note.content ?? ''));
  const { showConfirm, confirmClose, onConfirmDiscard, onCancelClose } = useUnsavedChanges(isDirty);

  const handleClose = () => confirmClose(onClose);

  const versionsQuery = useVersions<PlainVersion>('notes', noteId, { enabled: menuOpened || historyOpen });
  const versions: DisplayVersion[] | undefined = versionsQuery.data;

  const handleRestored = (v: DisplayVersion) => {
    setTitle(v.title);
    setContent(v.content);
    setUpdatedAt(new Date().toISOString());
  };

  const handleDelete = () => {
    deleteNote.mutate(noteId);
    onClose();
    toast.success('Note deleted', {
      description: 'You can undo this action.',
      duration: 7000,
      action: {
        label: 'Undo',
        onClick: () => {
          undeleteNote.mutate({ id: noteId, note: note as unknown as CachedNote });
          toast.success('Note restored');
        },
      },
    });
  };

  const handleCancel = () => {
    setTitle(note.title ?? '');
    setContent(note.content ?? '');
    setEditing(false);
    clearDraft();
  };

  // Editing deserves the same crash/session-expiry recovery as creation. Keep
  // a plaintext recovery copy locally while the form is dirty; restoring it as
  // a new note is safer than silently overwriting a possibly newer server copy.
  useEffect(() => {
    if (!isDirty) return;
    const timer = setTimeout(() => {
      saveDraft({ type: 'note', title, content, savedAt: Date.now(), sourceId: noteId });
    }, 500);
    return () => clearTimeout(timer);
  }, [content, isDirty, noteId, title]);

  const handleSave = () => {
    if (title.length > MAX_TITLE) {
      toast.error('Title is too long');
      return;
    }
    if (content.length > MAX_CONTENT) {
      toast.error('Content is too large to save');
      return;
    }
    saveDraft({ type: 'note', title, content, savedAt: Date.now(), sourceId: noteId });

    const onSuccess = () => {
      clearDraft();
      setUpdatedAt(new Date().toISOString());
      setEditing(false);
      setShowFormatBar(false);
    };

    if (noteId.startsWith('temp-')) {
      // Recover an optimistic create left by an older/offline app session. A
      // temp id never existed server-side, so turn the edit into a real create.
      createNote.mutate({ title, content, color, pattern, tags }, { onSuccess });
    } else {
      updateNote.mutate({ id: noteId, title, content }, { onSuccess, onError: () => setEditing(true) });
    }
  };

  if (historyOpen) {
    return (
      <VersionHistoryModal
        tier="notes"
        noteId={noteId}
        color={color}
        pattern={pattern}
        current={{ _id: CURRENT_VERSION_ID, title, content, createdAt: updatedAt }}
        versions={versions}
        onClose={() => setHistoryOpen(false)}
        onRestored={handleRestored}
        onDuplicate={(v) => createNote.mutate({ title: v.title, content: v.content, color, pattern })}
      />
    );
  }

  return (
    <>
      <SharedNoteModal
        cardRect={historyWasOpen ? undefined : cardRect}
        animateIn={!historyWasOpen}
        title={title}
        editing={editing}
        onTitleChange={setTitle}
        color={color}
        pattern={pattern}
        onColorChange={handleColorChange}
        onPatternChange={handlePatternChange}
        tags={tags}
        onTagsChange={handleTagsChange}
        isDirty={isDirty}
        stylePickerOpen={stylePickerOpen}
        onStylePickerOpenChange={setStylePickerOpen}
        onEditToggle={() => setEditing(!editing)}
        onClose={handleClose}
        disableClose={editing}
        updatedAt={updatedAt}
        createdAt={note.createdAt}
        onSave={handleSave}
        onCancel={handleCancel}
        saving={updateNote.isPending || createNote.isPending}
        isArchived={isArchived}
        onArchive={handleArchiveToggle}
        onDelete={handleDelete}
        disableSave={isUploading}
        toolbar={<FormattingToolbar editor={editor} isOpen={showFormatBar} showFileUpload />}
        formatToggle={<FormatToggleButton isActive={showFormatBar} onToggle={() => setShowFormatBar((v) => !v)} />}
        pinned={pinned}
        onUnpin={() => handleTogglePinned(false)}
        expiresAt={expiresAt}
        burnAfterReading={wasInitiallyBurning && burnAfterReading}
        moreActions={
          <NoteActionsMenu
            pinned={pinned}
            onTogglePinned={handleTogglePinned}
            expiresAt={expiresAt}
            burnAfterReading={burnAfterReading}
            onSetExpiry={handleSetExpiry}
            onVersionHistory={openHistory}
            onOpenChange={(open) => open && setMenuOpened(true)}
          />
        }
      >
        <TiptapEditor
          key={editing ? 'editing' : 'viewing'}
          content={content}
          onChange={(html) => {
            setContent(html);
            if (!editing) {
              updateNote.mutate({ id: noteId, content: html });
            }
          }}
          editable={editing}
          placeholder="Write your note..."
          onEditorReady={setEditor}
          allowFileUpload
          onUploadingChange={setIsUploading}
        />
      </SharedNoteModal>

      {showConfirm && (
        <ConfirmDiscardDialog
          onDiscard={() => {
            clearDraft();
            onConfirmDiscard();
          }}
          onCancel={onCancelClose}
        />
      )}
    </>
  );
}
