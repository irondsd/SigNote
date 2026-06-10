'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Tag as TagIcon, Settings, ChevronRight } from 'lucide-react';
import { cn } from '@/utils/cn';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tag } from '@/components/Tag/Tag';
import { ConfirmDiscardDialog } from '@/components/ConfirmDiscardDialog/ConfirmDiscardDialog';
import { useTags, type ClientTag } from '@/hooks/useTags';
import { useTagMutations } from '@/hooks/useTagMutations';
import { autoTagColor } from '@/config/noteStyles';
import { MAX_TAGS_PER_NOTE } from '@/config/constants';
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
  onMouseEnter,
  onClick,
}: {
  tag: ClientTag;
  count?: number;
  active?: boolean;
  hint?: string;
  onMouseEnter?: () => void;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={cn(s.row, active && s.rowActive)}
      onMouseDown={(e) => e.preventDefault()}
      onMouseEnter={onMouseEnter}
      onClick={onClick}
    >
      <Tag tag={tag} size="xs" variant="soft" dot />
      {hint ? <span className={s.rowHint}>{hint}</span> : <span className={s.rowCount}>{count ?? 0}</span>}
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
  // `tags` arrives sorted most-recently-used first, so the top 3 available are
  // the "Recent" group and everything after is "All tags".
  const recent = useMemo(() => available.slice(0, 3), [available]);
  const rest = useMemo(() => available.slice(3), [available]);

  // Flattened, in-display-order list of selectable tags. Arrow keys and Enter
  // operate on this so the highlighted row always matches what gets added.
  const orderedTags = q ? matching : [...recent, ...rest];
  const showCreate = !!q && !exact;
  const optionCount = orderedTags.length + (showCreate ? 1 : 0);
  const createIndex = showCreate ? orderedTags.length : -1;

  const [selectedIndex, setSelectedIndex] = useState(0);

  // Reset the highlight to the top whenever the query (and thus the option
  // list) changes — adjusting state during render rather than in an effect.
  const [prevQ, setPrevQ] = useState(q);
  if (q !== prevQ) {
    setPrevQ(q);
    setSelectedIndex(0);
  }

  // Clamp to the current option list so a stale index never highlights nothing.
  const activeIndex = Math.min(selectedIndex, Math.max(optionCount - 1, 0));

  const atLimit = value.length >= MAX_TAGS_PER_NOTE;

  const add = (id: string) => {
    if (atLimit) return;
    if (!value.includes(id)) onChange([...value, id]);
    setQuery('');
  };

  const createAndAdd = async () => {
    const name = query.trim();
    if (!name || atLimit) return;
    const tag = await create.mutateAsync({ name });
    add(tag._id);
  };

  const activate = (index: number) => {
    if (index === createIndex) void createAndAdd();
    else if (orderedTags[index]) add(orderedTags[index]._id);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(Math.min(activeIndex + 1, optionCount - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(Math.max(activeIndex - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      activate(activeIndex);
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
            {atLimit ? (
              <div className={s.paletteEmpty}>Tag limit reached — a note can have up to {MAX_TAGS_PER_NOTE} tags</div>
            ) : !q ? (
              <>
                {recent.length > 0 && (
                  <>
                    <div className={s.groupLabel}>Recent</div>
                    {recent.map((t, i) => (
                      <PaletteRow
                        key={t._id}
                        tag={t}
                        count={counts[t._id]}
                        active={activeIndex === i}
                        onMouseEnter={() => setSelectedIndex(i)}
                        onClick={() => add(t._id)}
                      />
                    ))}
                  </>
                )}
                {rest.length > 0 && (
                  <>
                    <div className={s.groupLabel}>All tags</div>
                    {rest.map((t, i) => (
                      <PaletteRow
                        key={t._id}
                        tag={t}
                        count={counts[t._id]}
                        active={activeIndex === recent.length + i}
                        onMouseEnter={() => setSelectedIndex(recent.length + i)}
                        onClick={() => add(t._id)}
                      />
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
                    active={activeIndex === i}
                    hint={`· ${counts[t._id] ?? 0} notes`}
                    onMouseEnter={() => setSelectedIndex(i)}
                    onClick={() => add(t._id)}
                  />
                ))}
                {showCreate && (
                  <>
                    {matching.length === 0 && <div className={s.groupLabel}>No matching tag</div>}
                    <button
                      type="button"
                      className={cn(s.row, activeIndex === createIndex && s.rowActive)}
                      onMouseDown={(e) => e.preventDefault()}
                      onMouseEnter={() => setSelectedIndex(createIndex)}
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
