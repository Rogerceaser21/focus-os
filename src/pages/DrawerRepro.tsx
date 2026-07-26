// DEV-ONLY reproduction harness for the mobile Projects drawer.
//
// Routed only when import.meta.env.DEV (see App.tsx). It mirrors the mobile
// Projects drawer construct from ProjectSidebar.tsx so tests/drawer.spec.ts can
// prove the touch-dismiss / navigate-open bugs and their fixes WITHOUT Supabase
// auth (the real /app route needs a live session). Keep this in lockstep with
// ProjectSidebar's normal-mobile branch AND Index's MobileSidebarController:
// whatever drawer construct + open/clear logic those use, this uses.
//
// Two routes:
//   /dev/drawer-repro  — mirrors /app: mounts the drawer + a toggle button wired
//                        like BottomNav's Projects button (toggleSidebar in place).
//                        Also runs an artificial ~1.5s data-delay after mount to
//                        mimic the projects fetch, so the drawer opens EMPTY and
//                        populates later (the sign-in -> Home -> Projects path).
//   /dev/drawer-away   — mirrors /meetings: NO drawer, a button that navigates to
//                        /dev/drawer-repro?openSidebar=true (the openSidebar flow
//                        below opens the drawer after remount).
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { SidebarProvider, useSidebar } from '@/components/ui/sidebar';

const AWAY_PATH = '/dev/drawer-away';
const REPRO_PATH = '/dev/drawer-repro';

// Artificial projects-fetch latency: the drawer opens immediately (empty) and
// the body content only arrives after this delay, mirroring the real sign-in
// path where the drawer opens before projects load. Also forces a re-render
// mid-window so tests can prove the fixed drawer neither self-reopens nor
// self-recloses when data lands.
const DATA_DELAY_MS = 1500;

const DrawerReproInner = () => {
  const { openMobile, setOpenMobile, toggleSidebar, isMobile } = useSidebar();
  const location = useLocation();
  const navigate = useNavigate();
  const onAway = location.pathname === AWAY_PATH;

  // Mirror Index.tsx:791-825 + MobileSidebarController (Index.tsx:151-159).
  // A one-shot request flag decouples "consume the ?openSidebar param" from
  // "open the drawer", exactly like the real app.
  const [openSidebarRequested, setOpenSidebarRequested] = useState(false);
  const [dataReady, setDataReady] = useState(false);

  // Ghost-click latch for the overlay — mirrors ProjectSidebar.tsx. Close only
  // when one gesture both starts (pointerdown) and ends (click) on the overlay.
  const overlayPointerDownRef = useRef(false);

  // One-shot latch for the ?openSidebar handshake — mirrors Index.tsx fix 2.
  // Guards against the consume effect re-raising the request on an interim
  // re-run (a `projects`-style dep change) before the async URL strip commits.
  const openSidebarHandledRef = useRef(false);

  // Artificial data-delay: flip dataReady ~1.5s after landing on the repro
  // route, like the projects fetch resolving. Mirrors "drawer opens empty, then
  // data loads".
  useEffect(() => {
    if (onAway) return;
    setDataReady(false);
    const t = setTimeout(() => setDataReady(true), DATA_DELAY_MS);
    return () => clearTimeout(t);
  }, [onAway]);

  // Mirror Index.tsx's openSidebar effect INCLUDING fix 2's one-shot latch — on
  // ?openSidebar=true, raise the request flag once and strip the param. The
  // latch is cleared only once the param has left the URL, so an interim re-run
  // (before the async strip commits) cannot re-raise the request, while a fresh
  // navigation with ?openSidebar=true is still handled once.
  useEffect(() => {
    if (onAway) return;
    const params = new URLSearchParams(location.search);
    const wantsOpen = params.get('openSidebar') === 'true';
    if (!wantsOpen) {
      openSidebarHandledRef.current = false;
      return;
    }
    if (openSidebarHandledRef.current) return;
    openSidebarHandledRef.current = true;
    if (isMobile) setOpenSidebarRequested(true);
    params.delete('openSidebar');
    const clean = params.toString();
    navigate(clean ? `${REPRO_PATH}?${clean}` : REPRO_PATH, { replace: true });
  }, [location.search, isMobile, onAway, navigate]);

  // Mirror MobileSidebarController (Index.tsx:155-159), INCLUDING fix B: the
  // effect consumes the request, opens the drawer, and immediately clears the
  // flag so a later data-load re-render can never re-fire the open (one-shot).
  useEffect(() => {
    if (!openSidebarRequested || !isMobile) return;
    setOpenMobile(true);
    setOpenSidebarRequested(false); // fix B — one-shot per request
  }, [openSidebarRequested, isMobile, setOpenMobile]);

  // Hygiene: clear the overlay latch whenever the drawer closes (mirrors
  // ProjectSidebar.tsx).
  useEffect(() => {
    if (!openMobile) overlayPointerDownRef.current = false;
  }, [openMobile]);

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

      {/* Desktop sidebar branch — mirrors ProjectSidebar's !isMobile sidebar,
          the only place that renders the `aria-label="Close sidebar"` button.
          At a mobile viewport this must NEVER render: useIsMobile now resolves
          synchronously so isMobile is true from the first render. The pre-fix
          async hook returned desktop for one render, flashing this 280px
          sidebar over the app before the drawer swapped in — spec 3a guards
          that it has count 0 at all times. */}
      {!onAway && !isMobile && (
        <aside
          data-testid="desktop-sidebar"
          className="fixed inset-y-0 left-0 z-40 w-[280px] p-4 lg-side"
        >
          <button
            type="button"
            aria-label="Close sidebar"
            className="lg-iconbtn h-7 w-7"
            onClick={() => {}}
          >
            Close
          </button>
        </aside>
      )}

      {/* Drawer construct — mounted only on the repro route (mirrors /app; the
          away route is like /meetings with no drawer). isMobile gate mirrors
          ProjectSidebar's normal-mobile branch. FIXED construct: plain-div
          portal to document.body with the ghost-click-guarded overlay (matches
          ProjectSidebar.tsx exactly). */}
      {!onAway && isMobile && createPortal(
        <>
          <div
            data-state={openMobile ? 'open' : 'closed'}
            className="fixed inset-0 z-50 lg-side-overlay"
            // Fix A: close only when the gesture both started (pointerdown) and
            // ended (click) on this overlay. A cross-navigation ghost click has
            // no pointerdown latch, so it can never self-close the drawer.
            onPointerDown={() => { overlayPointerDownRef.current = true; }}
            onClick={() => {
              if (!overlayPointerDownRef.current) return;
              overlayPointerDownRef.current = false;
              setOpenMobile(false);
            }}
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
            <div className="p-4" data-testid="drawer-body">
              {dataReady ? 'Drawer body' : 'Loading projects…'}
            </div>
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
