import s from './layout.module.scss';
import { Sidebar } from '@/components/Sidebar/Sidebar';
import { MobileHeader } from '@/components/MobileHeader/MobileHeader';
import { DraftToast } from '@/components/DraftToast/DraftToast';
import { SwipeNavWrapper } from '@/components/SwipeNavWrapper/SwipeNavWrapper';
import { DraftRestoreProvider } from '@/contexts/DraftRestoreContext';
import { OfflineBanner } from '@/components/OfflineBanner/OfflineBanner';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <DraftRestoreProvider>
      <div className={s.shell}>
        <Sidebar />
        <div className={s.content}>
          <MobileHeader />
          <OfflineBanner />
          <SwipeNavWrapper className={s.main}>{children}</SwipeNavWrapper>
        </div>
        <DraftToast />
      </div>
    </DraftRestoreProvider>
  );
}
