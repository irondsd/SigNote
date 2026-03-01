import cx from 'classnames';
import React, { type FC } from 'react';

import s from './Switch.module.scss';

type SwitchProps = {
  value: boolean;
  onChange: (value: boolean) => void;
  label?: string;
  isLoading?: boolean;
};

export const Switch: FC<SwitchProps> = ({ value, onChange, label, isLoading }) => {
  const handleChange = () => {
    if (isLoading) return;
    onChange(!value);
  };

  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      aria-label={label || 'Toggle switch'}
      className={cx(s.container, value && s.active, isLoading && s.disabled)}
      onClick={handleChange}
    >
      <div className={cx(s.switch, value && s.active)} />
    </button>
  );
};
