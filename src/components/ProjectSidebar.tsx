import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Project } from '@/types/task';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Plus, Folder, ListTodo, Calendar } from 'lucide-react';
import { CreateProjectDialog } from './CreateProjectDialog';
import { toast } from 'sonner';

interface ProjectSidebarProps {
  selectedProjectId: string | null;
  onSelectProject: (projectId: string | null) => void;
  onSelectSpecialList: (list: 'unassigned' | 'today' | null) => void;
  selectedSpecialList: 'unassigned' | 'today' | null;
}

export const ProjectSidebar = ({ 
  selectedProjectId, 
  onSelectProject, 
  onSelectSpecialList,
  selectedSpecialList 
}: ProjectSidebarProps) => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  useEffect(() => {
    fetchProjects();
  }, []);

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

  return (
    <div className="flex flex-col h-full border-r bg-card/50 backdrop-blur-sm">
      <div className="p-4 border-b">
        <h2 className="font-semibold text-lg mb-3">Projects</h2>
        <Button onClick={() => setIsCreateOpen(true)} size="sm" className="w-full gap-2">
          <Plus className="h-4 w-4" />
          New Project
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          {/* Special Lists */}
          <Button
            variant={selectedSpecialList === 'today' ? 'secondary' : 'ghost'}
            className="w-full justify-start gap-2"
            onClick={() => handleSelectSpecial('today')}
          >
            <Calendar className="h-4 w-4" />
            Today's To-Do
          </Button>
          
          <Button
            variant={selectedSpecialList === 'unassigned' ? 'secondary' : 'ghost'}
            className="w-full justify-start gap-2"
            onClick={() => handleSelectSpecial('unassigned')}
          >
            <ListTodo className="h-4 w-4" />
            Unassigned
          </Button>

          {/* Projects */}
          <div className="pt-2 mt-2 border-t">
            {projects.map(project => (
              <Button
                key={project.id}
                variant={selectedProjectId === project.id ? 'secondary' : 'ghost'}
                className="w-full justify-start gap-2 mb-1"
                onClick={() => handleSelectProject(project.id)}
              >
                <Folder 
                  className="h-4 w-4" 
                  style={{ color: project.color }}
                />
                <span className="truncate">{project.name}</span>
              </Button>
            ))}
          </div>
        </div>
      </ScrollArea>

      <CreateProjectDialog 
        open={isCreateOpen}
        onOpenChange={setIsCreateOpen}
        onCreate={handleCreateProject}
      />
    </div>
  );
};