import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Project } from '@/types/task';
import { Button } from '@/components/ui/button';
import { Plus, Folder, ListTodo, Calendar } from 'lucide-react';
import { CreateProjectDialog } from './CreateProjectDialog';
import { toast } from 'sonner';
import AnimatedList from './AnimatedList';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  useSidebar,
} from '@/components/ui/sidebar';

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
      .order('created_at', { ascending: true });

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

  const { open: sidebarOpen } = useSidebar();

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
        <SidebarGroup>
          <SidebarGroupContent className="p-2 space-y-1">
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
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Projects with AnimatedList */}
        {sidebarOpen && projects.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel className="px-4">My Projects</SidebarGroupLabel>
            <SidebarGroupContent className="px-2">
              <AnimatedList
                items={projects}
                onItemSelect={(project) => handleSelectProject(project.id)}
                showGradients={true}
                enableArrowNavigation={false}
                displayScrollbar={false}
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
            </SidebarGroupContent>
          </SidebarGroup>
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