'use client';

import { Tag } from '@/components/Tag/Tag';
import { useTags } from '@/hooks/useTags';
import { AddTagButton } from './AddTagButton';
import s from './TagStrip.module.scss';

type TagStripProps = {
  value: string[];
  onChange: (ids: string[]) => void;
};

/** The "Tags" line in the note modal — toggled open/closed by the footer tag button. */
export function TagStrip({ value, onChange }: TagStripProps) {
  const { resolve } = useTags();
  const selected = resolve(value);

  return (
    <div className={s.strip} data-testid="tag-strip">
      <span className={s.stripLabel}>Tags</span>
      <div className={s.chips}>
        {selected.map((t) => (
          <Tag
            key={t._id}
            tag={t}
            size="sm"
            variant="soft"
            onRemove={() => onChange(value.filter((id) => id !== t._id))}
          />
        ))}
        <AddTagButton value={value} onChange={onChange} />
      </div>
    </div>
  );
}
