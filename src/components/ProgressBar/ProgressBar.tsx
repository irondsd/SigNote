import cx from 'classnames';
import React, { type FC } from 'react';

import s from './ProgressBar.module.scss';

type ProgressBarProps = {
  className?: string;
  progress: number;
};

export const ProgressBar: FC<ProgressBarProps> = ({ className, progress }) => {
  return (
    <div className={cx(s.container, className)}>
      <div className="h-28 rounded-full bg-primary-100" style={{ width: `${progress}%` }} />
    </div>
  );
};
