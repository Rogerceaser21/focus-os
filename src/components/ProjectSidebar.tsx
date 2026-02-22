import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Project } from '@/types/task';
import { Button } from '@/components/ui/button';
import { Plus, Folder, ListTodo, Calendar, HelpCircle } from 'lucide-react';
import { CreateProjectDialog } from './CreateProjectDialog';
import { toast } from 'sonner';
import AnimatedList from './AnimatedList';
import { useIsMobile } from '@/hooks/use-mobile';
import { useSidebar } from '@/components/ui/sidebar';
import {
  Sheet,
  SheetContent,
} from '@/components/ui/sheet';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface ProjectSidebarProps {
  selectedProjectId: string | null;
  onSelectProject: (projectId: string | null) => void;
  onSelectSpecialList: (list: 'unassigned' | 'today' | null) => void;
  selectedSpecialList: 'unassigned' | 'today' | null;
  projectRefreshTrigger?: number;
  onProjectCreated?: () => void;
  onStartTour?: () => void;
  onStartTaskTour?: () => void;
  onStartProjectsTour?: () => void;
  createDialogOpen?: boolean;
  onCreateDialogOpenChange?: (open: boolean) => void;
  isTourActive?: boolean;
}

export const ProjectSidebar = ({ 
  selectedProjectId, 
  onSelectProject, 
  onSelectSpecialList,
  selectedSpecialList,
  projectRefreshTrigger,
  onProjectCreated,
  onStartTour,
  onStartTaskTour,
  onStartProjectsTour,
  createDialogOpen,
  onCreateDialogOpenChange,
  isTourActive
}: ProjectSidebarProps) => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [isCreateOpenInternal, setIsCreateOpenInternal] = useState(false);
  
  // Use controlled state if provided, otherwise use internal state
  const isCreateOpen = createDialogOpen !== undefined ? createDialogOpen : isCreateOpenInternal;
  const setIsCreateOpen = onCreateDialogOpenChange || setIsCreateOpenInternal;

  useEffect(() => {
    fetchProjects();
  }, [projectRefreshTrigger]);

  const fetchProjects = async () => {
    const { data, error } = await supabase
      .from('projects')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      toast.error('Failed to load projects');
      return;
    }

    setProjects(data.map(p => ({
      id: p.id,
      name: p.name,
      color: p.color,
      timer: { totalSeconds: 0, isRunning: false }
    })));
  };

  const handleCreateProject = async (name: string, color: string) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { error } = await supabase
      .from('projects')
      .insert({ name, color, user_id: user.id });

    if (error) {
      toast.error('Failed to create project');
      return;
    }

    toast.success('Project created!');
    fetchProjects();
    setIsCreateOpen(false);
    onProjectCreated?.();
  };

  const handleSelectProject = (projectId: string) => {
    onSelectProject(projectId);
    onSelectSpecialList(null);
  };

  const handleSelectSpecial = (list: 'unassigned' | 'today') => {
    onSelectSpecialList(list);
    onSelectProject(null);
  };

  const { open: sidebarOpen, openMobile, setOpenMobile, isMobile } = useSidebar();
  const isActuallyMobile = useIsMobile();

  const handleHelpMenuClick = (tourType: 'menu-magic' | 'tasks' | 'projects') => {
    if (tourType === 'menu-magic' && onStartTour) {
      onStartTour();
    } else if (tourType === 'tasks' && onStartTaskTour) {
      onStartTaskTour();
    } else if (tourType === 'projects' && onStartProjectsTour) {
      onStartProjectsTour();
    } else {
      toast.info('Coming soon!', {
        description: `This tour is under development.`
      });
    }
  };

  const sidebarContent = (
    <>
      <div className="border-b p-4">
        <h2 className="font-semibold text-lg mb-3">Projects</h2>
        <div className="flex gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button 
                size="sm" 
                className="gap-2 bg-purple-600 hover:bg-purple-700 text-white"
              >
                <HelpCircle className="h-4 w-4" />
                Help
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-48 bg-popover">
              <DropdownMenuItem onClick={() => handleHelpMenuClick('menu-magic')}>
                Menu Magic Buttons
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleHelpMenuClick('tasks')}>
                Tasks Tour
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleHelpMenuClick('projects')}>
                Projects Tour
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button 
            onClick={() => setIsCreateOpen(true)} 
            size="sm" 
            className="flex-1 gap-2"
            data-projects-tour-step="new-project-button"
          >
            <Plus className="h-4 w-4" />
            New Project
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="p-2 space-y-1">
          {/* Special Lists */}
          <Button
            variant={selectedSpecialList === 'today' ? 'secondary' : 'ghost'}
            className="w-full justify-start gap-2"
            onClick={() => {
              handleSelectSpecial('today');
              if (isActuallyMobile) setOpenMobile(false);
            }}
          >
            <Calendar className="h-4 w-4" />
            Today's To-Do
          </Button>
          
          <Button
            variant={selectedSpecialList === 'unassigned' ? 'secondary' : 'ghost'}
            className="w-full justify-start gap-2"
            onClick={() => {
              handleSelectSpecial('unassigned');
              if (isActuallyMobile) setOpenMobile(false);
            }}
          >
            <ListTodo className="h-4 w-4" />
            Unassigned
          </Button>
        </div>

        {/* Projects with AnimatedList */}
        {projects.length > 0 && (
          <div className="mt-4">
            <div className="px-4 mb-2">
              <h3 className="text-sm font-medium text-muted-foreground">My Projects ({projects.length})</h3>
            </div>
            <div className="px-2">
              <AnimatedList
                items={projects}
                onItemSelect={(project) => {
                  handleSelectProject(project.id);
                  if (isActuallyMobile) setOpenMobile(false);
                }}
                showGradients={false}
                enableArrowNavigation={false}
                displayScrollbar={true}
                className="w-full"
                getItemDataAttributes={(project) => 
                  project.name.startsWith('Demo Project') 
                    ? { 'data-projects-tour-step': 'demo-project' } 
                    : {}
                }
                renderItem={(project, isSelected) => (
                  <Button
                    variant={selectedProjectId === project.id ? 'secondary' : 'ghost'}
                    className="w-full justify-start gap-2"
                  >
                    <Folder 
                      className="h-4 w-4" 
                      style={{ color: project.color }}
                    />
                    <span className="truncate">{project.name}</span>
                  </Button>
                )}
              />
            </div>
          </div>
        )}
      </div>
    </>
  );

  // Dialog rendered separately so it works even when Sheet is closed on mobile
  const createDialog = (
    <CreateProjectDialog 
      open={isCreateOpen}
      onOpenChange={setIsCreateOpen}
      onCreate={handleCreateProject}
    />
  );

  // On mobile, use Sheet overlay - dialog is OUTSIDE the Sheet
  // BUT when tour is active, use a simple fixed div to avoid Radix focus/event trapping
  if (isActuallyMobile) {
    if (isTourActive) {
      // Tour mode: Bypass Sheet entirely, use simple fixed positioning
      return (
        <>
          {/* Backdrop */}
          {openMobile && (
            <div 
              className="fixed inset-0 z-40 bg-black/80 pointer-events-none"
              style={{ zIndex: 50 }}
            />
          )}
          {/* Sidebar content */}
          <div 
            className={`
              fixed inset-y-0 left-0 z-50 w-[280px] bg-card/95 backdrop-blur-sm border-r
              transform transition-transform duration-300 ease-in-out flex flex-col
              ${openMobile ? 'translate-x-0' : '-translate-x-full'}
            `}
            style={{ zIndex: 51 }}
          >
            {sidebarContent}
          </div>
          {createDialog}
        </>
      );
    }
    
    // Normal mode: Use Sheet
    return (
      <>
        <Sheet open={openMobile} onOpenChange={setOpenMobile}>
          <SheetContent 
            side="left" 
            className="w-[280px] p-0 bg-card/50 backdrop-blur-sm"
          >
            {sidebarContent}
          </SheetContent>
        </Sheet>
        {createDialog}
      </>
    );
  }

  // On desktop, use conditional width and opacity with smooth transitions
  return (
    <div 
      className={`
        border-r bg-background flex flex-col h-screen
        transition-all duration-300 ease-in-out relative z-20
        ${sidebarOpen ? 'w-[280px] opacity-100' : 'w-0 opacity-0 overflow-hidden'}
      `}
    >
      {sidebarContent}
      {createDialog}
    </div>
  );
};