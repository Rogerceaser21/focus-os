import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Project } from '@/types/task';
import { Button } from '@/components/ui/button';
import { Plus, Folder, ListTodo, Calendar } from 'lucide-react';
import { CreateProjectDialog } from './CreateProjectDialog';
import { toast } from 'sonner';
import AnimatedList from './AnimatedList';
import { useIsMobile } from '@/hooks/use-mobile';
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  useSidebar,
} from '@/components/ui/sidebar';
import {
  Sheet,
  SheetContent,
} from '@/components/ui/sheet';

interface ProjectSidebarProps {
  selectedProjectId: string | null;
  onSelectProject: (projectId: string | null) => void;
  onSelectSpecialList: (list: 'unassigned' | 'today' | null) => void;
  selectedSpecialList: 'unassigned' | 'today' | null;
  projectRefreshTrigger?: number;
}

export const ProjectSidebar = ({ 
  selectedProjectId, 
  onSelectProject, 
  onSelectSpecialList,
  selectedSpecialList,
  projectRefreshTrigger 
}: ProjectSidebarProps) => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [isCreateOpen, setIsCreateOpen] = useState(false);

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

  const sidebarContent = (
    <>
      <div className="border-b p-4">
        <h2 className="font-semibold text-lg mb-3">Projects</h2>
        <Button onClick={() => setIsCreateOpen(true)} size="sm" className="w-full gap-2">
          <Plus className="h-4 w-4" />
          New Project
        </Button>
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

      <CreateProjectDialog 
        open={isCreateOpen}
        onOpenChange={setIsCreateOpen}
        onCreate={handleCreateProject}
      />
    </>
  );

  // On mobile, use Sheet overlay
  if (isActuallyMobile) {
    return (
      <Sheet open={openMobile} onOpenChange={setOpenMobile}>
        <SheetContent side="left" className="w-[280px] p-0 bg-card/50 backdrop-blur-sm">
          {sidebarContent}
        </SheetContent>
      </Sheet>
    );
  }

  // On desktop, use standard Sidebar
  return (
    <Sidebar className="border-r bg-card/50 backdrop-blur-sm">
      <SidebarHeader className="border-b p-4">
        <h2 className="font-semibold text-lg mb-3">Projects</h2>
        <Button onClick={() => setIsCreateOpen(true)} size="sm" className="w-full gap-2">
          <Plus className="h-4 w-4" />
          {sidebarOpen && "New Project"}
        </Button>
      </SidebarHeader>

      <SidebarContent>
        <div className="p-2 space-y-1">
          {/* Special Lists */}
          <Button
            variant={selectedSpecialList === 'today' ? 'secondary' : 'ghost'}
            className="w-full justify-start gap-2"
            onClick={() => handleSelectSpecial('today')}
          >
            <Calendar className="h-4 w-4" />
            {sidebarOpen && "Today's To-Do"}
          </Button>
          
          <Button
            variant={selectedSpecialList === 'unassigned' ? 'secondary' : 'ghost'}
            className="w-full justify-start gap-2"
            onClick={() => handleSelectSpecial('unassigned')}
          >
            <ListTodo className="h-4 w-4" />
            {sidebarOpen && "Unassigned"}
          </Button>
        </div>

        {/* Projects with AnimatedList */}
        {sidebarOpen && projects.length > 0 && (
          <div className="mt-4">
            <div className="px-4 mb-2">
              <h3 className="text-sm font-medium text-muted-foreground">My Projects ({projects.length})</h3>
            </div>
            <div className="px-2">
              <AnimatedList
                items={projects}
                onItemSelect={(project) => handleSelectProject(project.id)}
                showGradients={false}
                enableArrowNavigation={false}
                displayScrollbar={true}
                className="w-full"
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
      </SidebarContent>

      <CreateProjectDialog 
        open={isCreateOpen}
        onOpenChange={setIsCreateOpen}
        onCreate={handleCreateProject}
      />
    </Sidebar>
  );
};