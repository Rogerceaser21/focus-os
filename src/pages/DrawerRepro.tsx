// DEV-ONLY reproduction harness for the mobile Projects drawer.
//
// Routed only when import.meta.env.DEV (see App.tsx). It mirrors the mobile
// Projects drawer construct from ProjectSidebar.tsx so tests/drawer.spec.ts can
// prove the touch-dismiss reopen bug and its fix WITHOUT Supabase auth (the real
// /app route needs a live session). Keep this in lockstep with ProjectSidebar's
// normal-mobile branch: whatever drawer construct ProjectSidebar uses, this uses.
//
// Two routes:
//   /dev/drawer-repro  — mirrors /app: mounts the drawer + a toggle button wired
//                        like BottomNav's Projects button (toggleSidebar in place).
//   /dev/drawer-away   — mirrors /meetings: NO drawer, a button that navigates to
//                        /dev/drawer-repro?openSidebar=true (the openSidebar effect
//                        below opens the drawer after remount).
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { SidebarProvider, useSidebar } from '@/components/ui/sidebar';

const AWAY_PATH = '/dev/drawer-away';
const REPRO_PATH = '/dev/drawer-repro';

const DrawerReproInner = () => {
  const { openMobile, setOpenMobile, toggleSidebar, isMobile } = useSidebar();
  const location = useLocation();
  const navigate = useNavigate();
  const onAway = location.pathname === AWAY_PATH;

  // Mirror Index.tsx:817 (setOpenSidebarRequested) + MobileSidebarController
  // effect (Index.tsx:156-159): ?openSidebar=true opens the drawer on mount.
  useEffect(() => {
    if (onAway) return;
    const params = new URLSearchParams(location.search);
    if (params.get('openSidebar') === 'true' && isMobile) {
      setOpenMobile(true);
    }
  }, [location.search, isMobile, onAway, setOpenMobile]);

  // Toggle button wired exactly like BottomNav's Projects button (BottomNav.tsx
  // :72-78): on the repro route toggle in place; from the away route navigate to
  // the repro route with ?openSidebar=true.
  const handleToggle = () => {
    if (onAway) {
      navigate(`${REPRO_PATH}?openSidebar=true`);
    } else {
      toggleSidebar();
    }
  };

  return (
    <div>
      {/* Full-width bottom toggle bar — z-20 like the real BottomNav, so the
          z-50 drawer overlay covers it while the drawer is open. */}
      <button
        type="button"
        data-testid={onAway ? 'away-toggle' : 'repro-toggle'}
        onClick={handleToggle}
        className="fixed bottom-0 left-0 right-0 z-20 py-5 bg-secondary text-foreground font-semibold"
      >
        {onAway ? 'Open Projects drawer' : 'Toggle Projects drawer'}
      </button>

      {/* Drawer construct — mounted only on the repro route (mirrors /app; the
          away route is like /meetings with no drawer). isMobile gate mirrors
          ProjectSidebar's normal-mobile branch. FIXED construct: plain-div
          portal to document.body (matches ProjectSidebar.tsx exactly). */}
      {!onAway && isMobile && createPortal(
        <>
          <div
            data-state={openMobile ? 'open' : 'closed'}
            className="fixed inset-0 z-50 lg-side-overlay"
            onClick={() => setOpenMobile(false)}
          />
          <div
            role="dialog"
            aria-label="Projects"
            data-state={openMobile ? 'open' : 'closed'}
            data-testid="drawer-panel"
            className="fixed inset-y-0 left-0 h-full z-50 w-[280px] p-0 lg-side flex flex-col gap-4"
          >
            <div className="border-b p-4">
              <h2 className="font-semibold text-lg">Projects</h2>
            </div>
            <div className="p-4" data-testid="drawer-body">Drawer body</div>
          </div>
        </>,
        document.body,
      )}
    </div>
  );
};

const DrawerRepro = () => (
  <SidebarProvider>
    <DrawerReproInner />
  </SidebarProvider>
);

export default DrawerRepro;
