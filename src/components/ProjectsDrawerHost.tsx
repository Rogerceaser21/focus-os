import { useNavigate } from 'react-router-dom';
import { ProjectSidebar } from '@/components/ProjectSidebar';

interface ProjectsDrawerHostProps {
  /** Host page's open state. Mount this component PERMANENTLY and flip this. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId?: string;
}

/**
 * The Projects drawer for pages that are NOT /app (/home, /meetings,
 * /meetings/:id).
 *
 * Before this existed, the dock's Projects button on those pages navigated to
 * /app?openSidebar=true, so the BACKGROUND page switched to the last project /
 * Today view before the drawer had even opened. Here the drawer opens OVER the
 * page the user is on and nothing navigates until a pick is made INSIDE it.
 *
 * Wiring:
 *  - ProjectSidebar in `overlayMode` renders its portalled overlay+panel branch
 *    at every width and reads open/close from the props below, not from the
 *    SidebarProvider context (host pages have none; useSidebar falls back to a
 *    no-op there, so no provider wrapper is needed and no wrapper div lands in
 *    the host's layout).
 *  - Selection is always empty: this drawer is a launcher, not a reflection of
 *    the current page's state.
 *  - Picks navigate with the deep links /app already handles on mount
 *    (Index.tsx resolves ?view= during render).
 *
 * WHITE-FLASH LAW: render this unconditionally and let `open` drive it. Never
 * mount it only while open — the overlay/panel layers must be born once.
 */
export const ProjectsDrawerHost = ({ open, onOpenChange, userId }: ProjectsDrawerHostProps) => {
  const navigate = useNavigate();

  return (
    <ProjectSidebar
      overlayMode
      open={open}
      onOpenChange={onOpenChange}
      selectedProjectId={null}
      selectedSpecialList={null}
      onSelectProject={(projectId) => {
        if (projectId) navigate(`/app?view=${projectId}`);
      }}
      onSelectSpecialList={(list) => {
        if (list) navigate(`/app?view=${list}`);
      }}
      userId={userId}
    />
  );
};

export default ProjectsDrawerHost;
