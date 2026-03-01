'use client';

import cx from 'classnames';
import React, { useEffect, useState, type MouseEvent as ReactMouseEvent, useRef } from 'react';

import type { DropdownProps } from '../../Dropdown';
import s from './Desktop.module.scss';

export const Desktop: React.FC<DropdownProps> = (props) => {
  const { children, className, dropListClassName, content, placement = 'bottomLeft', disabled } = props;

  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  const rootClassName = cx(s.container, className);

  const menuClassName = cx(s.menu, dropListClassName, {
    [s[placement]]: placement,
  });

  const btnClassName = cx(s.btn, {
    [s.disable]: !content,
  });

  const handleButtonClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.stopPropagation();

    setIsOpen((prev) => !prev);
  };

  const handleContainerClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.stopPropagation();

    let element = event.target as HTMLElement | null;

    // in order to close dropdown with onClick,
    // element must have attribute data-dismiss="dropdown"
    while (element && element?.getAttribute) {
      const data = element.getAttribute('data-dismiss');

      if (data === 'dropdown') {
        return setIsOpen(false);
      }

      element = element.parentNode as HTMLElement;
    }
  };

  const handleClickOutside = (event: MouseEvent) => {
    if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
      setIsOpen(false);
    }
  };

  useEffect(() => {
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  return (
    <div className={rootClassName} ref={dropdownRef}>
      <div className={btnClassName} onClick={handleButtonClick}>
        {typeof children === 'function' ? children({ isOpen }) : <>{children}</>}
      </div>

      {isOpen && !disabled && (
        <div className={cx(s.content, menuClassName)} onClick={handleContainerClick}>
          {content}
        </div>
      )}
    </div>
  );
};
