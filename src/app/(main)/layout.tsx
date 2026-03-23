import s from './layout.module.scss';
import { Sidebar } from '@/components/Sidebar/Sidebar';
import { MobileHeader } from '@/components/MobileHeader/MobileHeader';
import { DraftToast } from '@/components/DraftToast/DraftToast';
import { SwipeNavWrapper } from '@/components/SwipeNavWrapper/SwipeNavWrapper';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={s.shell}>
      <Sidebar />
      <div className={s.content}>
        <MobileHeader />
        <SwipeNavWrapper className={s.main}>{children}</SwipeNavWrapper>
      </div>
      <DraftToast />
    </div>
  );
}
