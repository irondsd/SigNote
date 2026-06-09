'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Tag as TagIcon, Settings, ChevronRight, CornerDownLeft } from 'lucide-react';
import { cn } from '@/utils/cn';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tag } from '@/components/Tag/Tag';
import { ConfirmDiscardDialog } from '@/components/ConfirmDiscardDialog/ConfirmDiscardDialog';
import { useTags, type ClientTag } from '@/hooks/useTags';
import { useTagMutations } from '@/hooks/useTagMutations';
import { autoTagColor } from '@/config/noteStyles';
import s from './TagStrip.module.scss';

type AddTagButtonProps = {
  value: string[];
  onChange: (ids: string[]) => void;
  isDirty?: boolean;
};

function PaletteRow({
  tag,
  count,
  active,
  hint,
  showEnter,
  onClick,
}: {
  tag: ClientTag;
  count?: number;
  active?: boolean;
  hint?: string;
  showEnter?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={cn(s.row, active && s.rowActive)}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      <Tag tag={tag} size="xs" variant="soft" dot />
      {hint ? <span className={s.rowHint}>{hint}</span> : <span className={s.rowCount}>{count ?? 0}</span>}
      {showEnter && <CornerDownLeft size={12} className={s.rowEnter} />}
    </button>
  );
}

/** The dashed "+ Add tag" chip in the strip, plus its ⌘K-style command palette. */
export function AddTagButton({ value, onChange, isDirty }: AddTagButtonProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [confirmingLeave, setConfirmingLeave] = useState(false);
  const router = useRouter();
  const { tags, counts } = useTags();
  const { create } = useTagMutations();

  const q = query.trim().toLowerCase();
  const available = useMemo(() => tags.filter((t) => !value.includes(t._id)), [tags, value]);
  const matching = q ? available.filter((t) => t.name.includes(q)) : available;
  const exact = tags.find((t) => t.name === q);
  const recent = useMemo(
    () => [...available].sort((a, b) => (counts[b._id] ?? 0) - (counts[a._id] ?? 0)).slice(0, 3),
    [available, counts],
  );
  const rest = available.filter((t) => !recent.includes(t));

  const add = (id: string) => {
    if (!value.includes(id)) onChange([...value, id]);
    setQuery('');
  };

  const createAndAdd = async () => {
    const name = query.trim();
    if (!name) return;
    const tag = await create.mutateAsync({ name });
    add(tag._id);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (matching.length > 0) add(matching[0]._id);
      else if (q && !exact) void createAndAdd();
    }
  };

  const goToManageTags = () => {
    setOpen(false);
    if (isDirty) setConfirmingLeave(true);
    else router.push('/tags');
  };

  return (
    <>
      <Popover
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) setQuery('');
        }}
      >
        <PopoverTrigger asChild>
          <button type="button" data-testid="add-tag-btn" className={cn(s.addChip, open && s.addChipActive)}>
            <Plus size={11} strokeWidth={2.5} />
            Add tag
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" side="top" sideOffset={8} className={s.palette}>
          <div className={s.inputRow}>
            <TagIcon size={16} className={s.inputIcon} />
            <input
              autoFocus
              className={s.input}
              placeholder="Search or create a tag…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
            />
            <kbd className={s.kbd}>Esc</kbd>
          </div>

          <div className={s.groups}>
            {!q ? (
              <>
                {recent.length > 0 && (
                  <>
                    <div className={s.groupLabel}>Recent</div>
                    {recent.map((t, i) => (
                      <PaletteRow
                        key={t._id}
                        tag={t}
                        count={counts[t._id]}
                        active={i === 0}
                        showEnter={i === 0}
                        onClick={() => add(t._id)}
                      />
                    ))}
                  </>
                )}
                {rest.length > 0 && (
                  <>
                    <div className={s.groupLabel}>All tags</div>
                    {rest.map((t) => (
                      <PaletteRow key={t._id} tag={t} count={counts[t._id]} onClick={() => add(t._id)} />
                    ))}
                  </>
                )}
                {available.length === 0 && <div className={s.paletteEmpty}>No tags yet — type to create one</div>}
              </>
            ) : (
              <>
                {matching.length > 0 && <div className={s.groupLabel}>Matching tags</div>}
                {matching.map((t, i) => (
                  <PaletteRow
                    key={t._id}
                    tag={t}
                    active={i === 0}
                    hint={`· ${counts[t._id] ?? 0} notes`}
                    showEnter={i === 0}
                    onClick={() => add(t._id)}
                  />
                ))}
                {!exact && (
                  <>
                    {matching.length === 0 && <div className={s.groupLabel}>No matching tag</div>}
                    <button
                      type="button"
                      className={cn(s.row, matching.length === 0 && s.rowActive)}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => void createAndAdd()}
                    >
                      <Plus size={15} className={s.createIcon} strokeWidth={2.4} />
                      <span className={s.createText}>Create</span>
                      <Tag
                        tag={{ name: query.trim(), color: autoTagColor(query.trim()) }}
                        size="sm"
                        variant="soft"
                        dot
                      />
                      {matching.length === 0 && <CornerDownLeft size={12} className={s.rowEnter} />}
                    </button>
                    {matching.length === 0 && (
                      <div className={s.autoHint}>
                        <span className={s.autoDot} data-color={autoTagColor(query.trim())} />
                        Color auto-assigned · change it anytime in <b>Manage tags</b>
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </div>

          <button type="button" className={s.manageRow} onClick={goToManageTags}>
            <Settings size={15} />
            <span>Manage tags…</span>
            <ChevronRight size={15} className={s.manageChevron} />
          </button>
        </PopoverContent>
      </Popover>

      {confirmingLeave && (
        <ConfirmDiscardDialog
          onDiscard={() => {
            setConfirmingLeave(false);
            router.push('/tags');
          }}
          onCancel={() => setConfirmingLeave(false)}
        />
      )}
    </>
  );
}
