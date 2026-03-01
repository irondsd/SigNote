import cx from 'classnames';
import React from 'react';

import s from './Bone.module.scss';

type BoneProps = {
  className?: string;
};

const Bone: React.FunctionComponent<BoneProps> = ({ className }) => {
  return <div className={cx(s.bone, className)} />;
};

export default React.memo(Bone);
