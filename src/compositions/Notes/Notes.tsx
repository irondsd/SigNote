import React, { type FC } from 'react';
import cx from 'classnames';
import s from './Notes.module.scss';
import { useNotes } from '@/hooks/useNotes';

type NotesProps = {
  className?: string;
};

export const Notes: FC<NotesProps> = ({ className }) => {
  const { data } = useNotes();

  return (
    <div className={cx(s.container, className)}>
      {data.map((note) => (
        <div key={String(note._id)} className={s.note}>
          <h3>{note.title}</h3>
          <p>{note.content}</p>
        </div>
      ))}
    </div>
  );
};
