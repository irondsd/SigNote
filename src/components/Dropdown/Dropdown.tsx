import dynamic from 'next/dynamic';
import React from 'react';

import { useDevice } from '@/hooks/useDevice';

const Desktop = dynamic(() => import('./views/Desktop/Desktop').then((m) => m.Desktop));
const Mobile = dynamic(() => import('./views/Mobile/Mobile').then((m) => m.Mobile));

export type DropdownProps = {
  dropListClassName?: string;
  name: string;
  content: React.ReactElement;
  className?: string;
  placement?: 'bottomLeft' | 'bottomRight' | 'center';
  children: React.ReactElement | (({ isOpen }: { isOpen: boolean }) => React.ReactElement);
  disabled?: boolean;
  mobileClosable?: boolean;
};

export const Dropdown: React.FC<DropdownProps> = (props) => {
  const { breakpoint } = useDevice();

  const isMobileView = breakpoint === 'xs';

  if (isMobileView) return <Mobile {...props} />;

  return <Desktop {...props} />;
};
