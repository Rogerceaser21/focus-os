import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { FolderOpen, Calendar, ListTodo, AlertTriangle, Settings, LogOut } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import SettingsDialog from '@/components/SettingsDialog';
import { useUserPreferences } from '@/hooks/useUserPreferences';

interface BottomNavProps {
  projects?: { id: string; name: string; color?: string }[];
}

const BottomNav = ({ projects = [] }: BottomNavProps) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { preferences, loading: prefsLoading, updatePreferences } = useUserPreferences();

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
        className="fixed bottom-0 left-0 right-0 grid grid-cols-6 z-20 border-t border-border/30"
        style={{
          background: 'hsl(var(--dock-background))',
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        }}
      >
      >
        <NavButton
          icon={<FolderOpen className="w-5 h-5" />}
          label="Projects"
          onClick={() => navigate('/app?view=projects')}
          active={isActive('/app', 'projects')}
        />
        <NavButton
          icon={<Calendar className="w-5 h-5" />}
          label="Meetings"
          onClick={() => navigate('/meetings')}
          active={location.pathname.startsWith('/meetings')}
        />
        <NavButton
          icon={<ListTodo className="w-5 h-5" />}
          label="Today"
          onClick={() => navigate('/app?view=today')}
          active={isActive('/app', 'today') || (location.pathname === '/app' && !location.search)}
        />
        <NavButton
          icon={<AlertTriangle className="w-5 h-5" />}
          label="Past Due"
          onClick={() => navigate('/app?view=past-due')}
          active={isActive('/app', 'past-due')}
          accent
        />
        <NavButton
          icon={<Settings className="w-5 h-5" />}
          label="Settings"
          onClick={() => setSettingsOpen(true)}
        />
        <NavButton
          icon={<LogOut className="w-5 h-5" />}
          label="Log Out"
          onClick={handleSignOut}
        />
      </div>

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        projects={projects.map(p => ({ id: p.id, name: p.name, color: p.color || '#888' }))}
        preferences={preferences}
        loading={prefsLoading}
        onSave={updatePreferences}
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
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  accent?: boolean;
  active?: boolean;
}) => (
  <button
    onClick={onClick}
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
