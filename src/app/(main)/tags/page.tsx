'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Tag } from '@/components/Tag/Tag';
import { useTags, type ClientTag } from '@/hooks/useTags';
import { useTagMutations } from '@/hooks/useTagMutations';
import { NOTE_COLORS, autoTagColor, type TagColor } from '@/config/noteStyles';
import s from './page.module.scss';

const cap = (v: string) => v.charAt(0).toUpperCase() + v.slice(1);

function Swatches({ value, onChange }: { value: TagColor; onChange: (c: TagColor) => void }) {
  return (
    <div className={s.swatches}>
      {NOTE_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          data-color={c}
          className={`${s.swatch} ${value === c ? s.swatchSelected : ''}`}
          onClick={() => onChange(c)}
          title={cap(c)}
          aria-label={c}
        />
      ))}
    </div>
  );
}

function ColorButton({ value, onChange }: { value: TagColor; onChange: (c: TagColor) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className={s.colorBtn}>
          <span data-color={value} className={s.colorDot} />
          {cap(value)}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className={s.colorPopover}>
        <div className={s.colorPopoverLabel}>Color</div>
        <Swatches
          value={value}
          onChange={(c) => {
            onChange(c);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

function TagRow({
  tag,
  count,
  onRename,
  onRecolor,
  onDelete,
}: {
  tag: ClientTag;
  count: number;
  onRename: (name: string) => void;
  onRecolor: (color: TagColor) => void;
  onDelete: () => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(tag.name);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const startRename = () => {
    setName(tag.name);
    setRenaming(true);
    requestAnimationFrame(() => inputRef.current?.select());
  };

  const commitRename = () => {
    const next = name.trim();
    if (next && next.toLowerCase() !== tag.name) onRename(next);
    setRenaming(false);
  };

  return (
    <div className={s.row} data-testid="tag-row">
      <div className={s.rowMain}>
        <div className={s.cellTag}>
          {renaming ? (
            <span data-color={tag.color} className={s.renamePill}>
              <span className={s.renameDot} />
              <input
                ref={inputRef}
                className={s.renameInput}
                value={name}
                autoFocus
                maxLength={50}
                onChange={(e) => setName(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    commitRename();
                  } else if (e.key === 'Escape') {
                    setRenaming(false);
                  }
                }}
              />
            </span>
          ) : (
            <Tag tag={tag} size="sm" variant="soft" dot />
          )}
        </div>
        <div>
          <ColorButton value={tag.color} onChange={onRecolor} />
        </div>
        <div className={s.cellCount}>{count} notes</div>
        <div className={s.cellActions}>
          <Button variant="ghost" size="icon-sm" asChild title="Find notes" aria-label={`Find notes tagged ${tag.name}`}>
            <Link href={`/search?tag=${tag._id}`}>
              <Search size={14} />
            </Link>
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={startRename} title="Rename" aria-label={`Rename ${tag.name}`}>
            <Pencil size={14} />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className={s.deleteBtn}
            onClick={() => setConfirmingDelete(true)}
            title="Delete"
            aria-label={`Delete ${tag.name}`}
          >
            <Trash2 size={14} />
          </Button>
        </div>
      </div>

      {confirmingDelete && (
        <div className={s.confirm}>
          <div className={s.confirmText}>
            Delete <b>{tag.name}</b>? It’s on <b>{count} notes</b> — the tag is removed from them, the notes are kept.
          </div>
          <div className={s.confirmActions}>
            <button type="button" className={s.confirmCancel} onClick={() => setConfirmingDelete(false)}>
              Cancel
            </button>
            <button
              type="button"
              className={s.confirmDelete}
              onClick={() => {
                onDelete();
                setConfirmingDelete(false);
              }}
            >
              Delete tag
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function TagsPage() {
  const { status } = useSession();
  const router = useRouter();
  const { tags, counts, isLoading } = useTags();
  const { create, update, remove } = useTagMutations();
  const [newName, setNewName] = useState('');

  useEffect(() => {
    if (status === 'unauthenticated') router.replace('/');
  }, [status, router]);

  if (status !== 'authenticated') return null;

  const newColor: TagColor = newName.trim() ? autoTagColor(newName) : NOTE_COLORS[0];

  const handleCreate = () => {
    const name = newName.trim();
    if (!name) return;
    create.mutate({ name });
    setNewName('');
  };

  return (
    <div className={s.page}>
      <header className={s.header}>
        <h1 className={s.title}>Tags</h1>
        <p className={s.subtitle}>
          {tags.length} {tags.length === 1 ? 'tag' : 'tags'} · rename, recolor or remove
        </p>
      </header>

      <div className={s.table}>
        <div className={s.tableHead}>
          <span>Tag</span>
          <span>Color</span>
          <span>Used by</span>
          <span className={s.right}>Actions</span>
        </div>

        {tags.map((t) => (
          <TagRow
            key={t._id}
            tag={t}
            count={counts[t._id] ?? 0}
            onRename={(name) => update.mutate({ id: t._id, name })}
            onRecolor={(color) => update.mutate({ id: t._id, color })}
            onDelete={() => remove.mutate(t._id)}
          />
        ))}

        {!isLoading && tags.length === 0 && <div className={s.empty}>No tags yet — create one below.</div>}

        <div className={s.newRow}>
          <span data-color={newColor} className={s.newField}>
            <span className={s.newDot} />
            <input
              className={s.newInput}
              placeholder="New tag name…"
              value={newName}
              maxLength={50}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleCreate();
                }
              }}
            />
            {newName.trim() && <span className={s.newHint}>color auto-assigned</span>}
          </span>
          <Button size="sm" onClick={handleCreate} disabled={!newName.trim() || create.isPending}>
            <Plus size={14} />
            Add tag
          </Button>
        </div>
      </div>
    </div>
  );
}
