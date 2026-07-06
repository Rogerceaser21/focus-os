import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { FolderOpen, Calendar, ListTodo, AlertTriangle, Settings, LogOut } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import SettingsDialog from '@/components/SettingsDialog';
import { useUserPreferences, type UserPreferences } from '@/hooks/useUserPreferences';
import { useAuth } from '@/hooks/useAuth';
import { useIsMobile } from '@/hooks/use-mobile';

interface BottomNavProps {
  projects?: { id: string; name: string; color?: string }[];
  onToggleSidebar?: () => void;
  preferences?: UserPreferences | null;
  prefsLoading?: boolean;
  onSavePreferences?: (updates: Partial<UserPreferences>) => Promise<void>;
  settingsOpen?: boolean;
  onSettingsOpenChange?: (open: boolean) => void;
}

const BottomNav = ({
  projects = [],
  onToggleSidebar,
  preferences: providedPreferences,
  prefsLoading: providedPrefsLoading,
  onSavePreferences,
  settingsOpen: controlledSettingsOpen,
  onSettingsOpenChange,
}: BottomNavProps) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [internalSettingsOpen, setInternalSettingsOpen] = useState(false);
  const { user } = useAuth();
  const {
    preferences: localPreferences,
    loading: localPrefsLoading,
    updatePreferences: updateLocalPreferences,
  } = useUserPreferences(user?.id);
  const isMobile = useIsMobile();

  const settingsOpen = controlledSettingsOpen ?? internalSettingsOpen;
  const setSettingsOpen = onSettingsOpenChange ?? setInternalSettingsOpen;
  const preferences = providedPreferences ?? localPreferences;
  const prefsLoading = providedPrefsLoading ?? localPrefsLoading;
  const handleSavePreferences = onSavePreferences ?? updateLocalPreferences;

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate('/auth');
  };

  const isActive = (path: string, view?: string) => {
    if (view) {
      return location.pathname === path && location.search.includes(`view=${view}`);
    }
    return location.pathname === path && !location.search.includes('view=');
  };

  return (
    <>
      <div
        className="fixed bottom-0 left-0 right-0 grid grid-cols-6 z-20 border-t border-border/30 lg-dock"
        style={{
          background: 'hsl(var(--dock-background))',
          paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 20px)',
          marginBottom: '-20px',
        }}
      >
        <NavButton
          dataTour="projects"
          icon={<FolderOpen className="w-5 h-5" />}
          label="Projects"
          onClick={() => {
            if (isMobile && location.pathname === '/app' && onToggleSidebar) {
              onToggleSidebar();
            } else {
              navigate('/app?openSidebar=true');
            }
          }}
          active={isActive('/app', 'projects')}
        />
        <NavButton
          dataTour="meetings"
          icon={<Calendar className="w-5 h-5" />}
          label="Meetings"
          onClick={() => navigate('/meetings')}
          active={location.pathname.startsWith('/meetings')}
        />
        <NavButton
          dataTour="today"
          icon={<ListTodo className="w-5 h-5" />}
          label="Today"
          onClick={() => navigate('/app?view=today')}
          active={isActive('/app', 'today') || (location.pathname === '/app' && !location.search)}
        />
        <NavButton
          dataTour="past-due"
          icon={<AlertTriangle className="w-5 h-5" />}
          label="Past Due"
          onClick={() => navigate('/app?view=past-due')}
          active={isActive('/app', 'past-due')}
          accent
        />
        <NavButton
          dataTour="settings"
          icon={<Settings className="w-5 h-5" />}
          label="Settings"
          onClick={() => setSettingsOpen(true)}
        />
        <NavButton
          dataTour="logout"
          icon={<LogOut className="w-5 h-5" />}
          label="Log Out"
          onClick={handleSignOut}
        />
      </div>

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        projects={projects.map((p) => ({ id: p.id, name: p.name, color: p.color || '#888' }))}
        preferences={preferences}
        loading={prefsLoading}
        onSave={handleSavePreferences}
      />
    </>
  );
};

const NavButton = ({
  icon,
  label,
  onClick,
  accent,
  active,
  dataTour,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  accent?: boolean;
  active?: boolean;
  dataTour?: string;
}) => (
  <button
    onClick={onClick}
    data-home-tour-step={dataTour}
    className={`flex flex-col items-center justify-center gap-1 py-3 transition-colors ${
      active
        ? accent
          ? 'text-red-400'
          : 'text-white'
        : accent
          ? 'text-accent hover:text-red-400'
          : 'text-muted-foreground hover:text-white'
    }`}
  >
    {icon}
    <span className="leading-tight text-[11px] font-bold">{label}</span>
  </button>
);

export default BottomNav;
