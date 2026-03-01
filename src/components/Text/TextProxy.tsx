'use client';

import React from 'react';
import { useDevice } from '@/hooks/useDevice';

import type { TextProps } from './Text';
import { Text } from './Text';


const TextProxy: React.FC<TextProps> = (props) => {
  const {  mobileSize } = props;

  const { isMobile } = useDevice();

  if (!isMobile) return <Text {...{ ...props, mobileSize: undefined }} />;
  if (mobileSize !== undefined) return <Text {...{ ...props, size: mobileSize, mobileSize: undefined }} />;
  
  return <Text {...{ ...props, mobileSize: undefined }} />;
};

export default TextProxy;
