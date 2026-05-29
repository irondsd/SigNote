import s from './layout.module.scss';
import { Sidebar } from '@/components/Sidebar/Sidebar';
import { MobileHeader } from '@/components/MobileHeader/MobileHeader';
import { DraftToast } from '@/components/DraftToast/DraftToast';
import { SwipeNavWrapper } from '@/components/SwipeNavWrapper/SwipeNavWrapper';
import { DraftRestoreProvider } from '@/contexts/DraftRestoreContext';
import { OfflineBanner } from '@/components/OfflineBanner/OfflineBanner';
import { OfflineManager } from '@/components/OfflineManager/OfflineManager';
import { SearchPaletteProvider } from '@/contexts/SearchPaletteContext';
import { SearchPalette } from '@/components/SearchPalette/SearchPalette';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <DraftRestoreProvider>
      <SearchPaletteProvider>
        <OfflineManager />
        <div className={s.shell}>
          <Sidebar />
          <div className={s.content}>
            <MobileHeader />
            <OfflineBanner />
            <SwipeNavWrapper className={s.main}>{children}</SwipeNavWrapper>
            <SearchPalette />
          </div>
          <DraftToast />
        </div>
      </SearchPaletteProvider>
    </DraftRestoreProvider>
  );
}
