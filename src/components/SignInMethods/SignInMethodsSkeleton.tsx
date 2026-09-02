import React from 'react';
import s from './SignInMethods.module.scss';

export function SignInMethodsSkeleton({ rows }: { rows: number }) {
  return Array.from({ length: rows }, (_, index) => (
    <React.Fragment key={index}>
      {index > 0 && <div className={s.divider} />}
      <div className={s.identityRow}>
        <div className={`${s.identityIcon} ${s.skeletonIdentityIcon}`} />
        <div className={s.identityInfo}>
          <div className={`${s.skeleton} ${s.skeletonIdentityLabel}`} />
          <div className={`${s.skeleton} ${s.skeletonIdentitySubject}`} />
        </div>
        <div className={`${s.skeleton} ${s.skeletonButton}`} />
      </div>
    </React.Fragment>
  ));
}
