import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Project } from '@/types/task';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, Folder, ListTodo, Calendar, HelpCircle, Mic, Search, Share2, CheckCircle2, XCircle, FileText, ClipboardList } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { CreateProjectDialog } from './CreateProjectDialog';
import AnimatedList from './AnimatedList';
import { useIsMobile } from '@/hooks/use-mobile';
import { useSidebar } from '@/components/ui/sidebar';
import Fuse from 'fuse.js';
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
  userId?: string;
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
  isTourActive,
  userId
}: ProjectSidebarProps) => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [meetings, setMeetings] = useState<{ id: string; title: string }[]>([]);
  const [sharedItems, setSharedItems] = useState<any[]>([]);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [decliningId, setDecliningId] = useState<string | null>(null);
  const [isCreateOpenInternal, setIsCreateOpenInternal] = useState(false);
  const [sidebarSearchInput, setSidebarSearchInput] = useState('');
  const [sidebarSearchQuery, setSidebarSearchQuery] = useState('');
  const navigate = useNavigate();

  // Debounce sidebar search
  useEffect(() => {
    const timer = setTimeout(() => setSidebarSearchQuery(sidebarSearchInput), 300);
    return () => clearTimeout(timer);
  }, [sidebarSearchInput]);
  
  // Use controlled state if provided, otherwise use internal state
  const isCreateOpen = createDialogOpen !== undefined ? createDialogOpen : isCreateOpenInternal;
  const setIsCreateOpen = onCreateDialogOpenChange || setIsCreateOpenInternal;

  useEffect(() => {
    fetchProjects();
    fetchMeetings();
    fetchSharedItems();
  }, [projectRefreshTrigger]);

  // Supabase Realtime: live shared items for current user
  useEffect(() => {
    if (!userId) return;

    const channel = supabase
      .channel('shared-items-realtime')
      .on(
        'postgres_changes' as any,
        {
          event: 'INSERT',
          schema: 'public',
          table: 'focusos_shared_items',
          filter: `recipient_user_id=eq.${userId}`,
        },
        (payload: any) => {
          const newItem = payload.new;
          toast.info(`📬 New item shared with you`, {
            description: `"${newItem.item_title}" from ${newItem.sender_name || newItem.sender_email}`,
          });
          // Refresh shared items list
          fetchSharedItems();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId]);

  const fetchProjects = async () => {
    const { data, error } = await (supabase as any)
      .from('focusos_projects')
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

  const fetchMeetings = async () => {
    const { data, error } = await (supabase as any)
      .from('focusos_meetings')
      .select('id, title')
      .order('created_at', { ascending: false });

    if (!error && data) {
      setMeetings(data.map(m => ({ id: m.id, title: m.title })));
    }
  };

  const fetchSharedItems = async () => {
    const { data, error } = await (supabase as any)
      .from('focusos_shared_items')
      .select('*')
      .in('status', ['pending', 'accepted'])
      .order('created_at', { ascending: false });

    if (!error && data) {
      setSharedItems(data);
    }
  };

  const handleAcceptSharedItem = async (sharedItemId: string) => {
    setAcceptingId(sharedItemId);
    try {
      const { error } = await supabase.functions.invoke('focusos-accept-shared-item', {
        body: { sharedItemId },
      });
      if (error) throw error;
      toast.success('Item accepted and added to your data!');
      fetchSharedItems();
      fetchProjects();
      fetchMeetings();
    } catch (err) {
      console.error('Accept error:', err);
      toast.error('Failed to accept shared item');
    } finally {
      setAcceptingId(null);
    }
  };

  const handleDeclineSharedItem = async (sharedItemId: string) => {
    setDecliningId(sharedItemId);
    try {
      const { error } = await supabase.functions.invoke('focusos-decline-shared-item', {
        body: { sharedItemId },
      });
      if (error) throw error;
      toast.success('Item declined');
      fetchSharedItems();
    } catch (err) {
      console.error('Decline error:', err);
      toast.error('Failed to decline shared item');
    } finally {
      setDecliningId(null);
    }
  };


  const projectFuse = useMemo(() => new Fuse(projects, {
    keys: ['name'],
    threshold: 0.4,
    ignoreLocation: true,
    minMatchCharLength: 2,
  }), [projects]);

  const meetingFuse = useMemo(() => new Fuse(meetings, {
    keys: ['title'],
    threshold: 0.4,
    ignoreLocation: true,
    minMatchCharLength: 2,
  }), [meetings]);

  const isSearching = sidebarSearchQuery.trim().length > 0;
  const matchedProjects = isSearching ? projectFuse.search(sidebarSearchQuery.trim()).map(r => r.item) : [];
  const matchedMeetings = isSearching ? meetingFuse.search(sidebarSearchQuery.trim()).map(r => r.item) : [];

  const handleCreateProject = async (name: string, color: string) => {
    if (!userId) return;

    const { error } = await (supabase as any)
      .from('focusos_projects')
      .insert({ name, color, user_id: userId });

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
      <div className="border-b p-4 flex-shrink-0">
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
        <Button 
          variant="outline"
          size="sm" 
          className="w-full gap-2 mt-2 border-teal-500/50 text-teal-400 hover:bg-teal-500/10 hover:border-teal-400"
          onClick={() => {
            navigate('/meetings');
            if (isActuallyMobile) setOpenMobile(false);
          }}
        >
          <Mic className="h-4 w-4" />
          Meetings
        </Button>
        {/* Search bar */}
        <div className="relative mt-2">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input 
            placeholder="Search projects & meetings..." 
            value={sidebarSearchInput} 
            onChange={e => setSidebarSearchInput(e.target.value)} 
            className="pl-8 h-8 text-sm bg-card/80 backdrop-blur-sm border"
          />
        </div>
      </div>

      <div className="flex-1 min-h-0 flex flex-col overflow-y-auto">
        {isSearching ? (
          /* Search results */
          <div className="p-2 space-y-3 flex-1 min-h-0 overflow-y-auto">
            {matchedProjects.length > 0 && (
              <div>
                <h3 className="text-xs font-medium text-muted-foreground px-2 mb-1">Projects</h3>
                <div className="space-y-1">
                  {matchedProjects.map(project => (
                    <Button
                      key={project.id}
                      variant="ghost"
                      className="w-full justify-start gap-2"
                      onClick={() => {
                        handleSelectProject(project.id);
                        setSidebarSearchInput('');
                        if (isActuallyMobile) setOpenMobile(false);
                      }}
                    >
                      <Folder className="h-4 w-4" style={{ color: project.color }} />
                      <span className="truncate">{project.name}</span>
                    </Button>
                  ))}
                </div>
              </div>
            )}
            {matchedMeetings.length > 0 && (
              <div>
                <h3 className="text-xs font-medium text-muted-foreground px-2 mb-1">Meetings</h3>
                <div className="space-y-1">
                  {matchedMeetings.map(meeting => (
                    <Button
                      key={meeting.id}
                      variant="ghost"
                      className="w-full justify-start gap-2"
                      onClick={() => {
                        navigate(`/meetings/${meeting.id}`);
                        setSidebarSearchInput('');
                        if (isActuallyMobile) setOpenMobile(false);
                      }}
                    >
                      <Mic className="h-4 w-4 text-teal-400" />
                      <span className="truncate">{meeting.title}</span>
                    </Button>
                  ))}
                </div>
              </div>
            )}
            {matchedProjects.length === 0 && matchedMeetings.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">No results found</p>
            )}
          </div>
        ) : (
          /* Normal sidebar content */
          <>
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

            {/* Shared Items Section */}
            {sharedItems.length > 0 && (
              <div className="mt-3 px-2">
                <div className="px-2 mb-2">
                  <h3 className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
                    <Share2 className="h-3.5 w-3.5" />
                    Shared Items ({sharedItems.length})
                  </h3>
                </div>
                <div className="space-y-1.5">
                  {sharedItems.map((item) => {
                    const isPending = item.status === 'pending';
                    const typeIcon = item.item_type === 'task' 
                      ? <ClipboardList className="h-3.5 w-3.5 text-primary" />
                      : item.item_type === 'project' 
                      ? <Folder className="h-3.5 w-3.5 text-primary" />
                      : <Mic className="h-3.5 w-3.5 text-teal-400" />;
                    
                    return (
                      <div key={item.id} className="rounded-lg border border-border/50 bg-card/50 p-2.5 space-y-1.5">
                        <div className="flex items-start gap-2">
                          {typeIcon}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-foreground truncate">{item.item_title}</p>
                            {item.project_name && (
                              <p className="text-xs text-muted-foreground truncate">
                                <Folder className="h-3 w-3 inline mr-1" />
                                {item.project_name}
                              </p>
                            )}
                            <p className="text-xs text-muted-foreground truncate">
                              From: {item.sender_name || item.sender_email}
                            </p>
                          </div>
                          <Badge variant="outline" className="text-[10px] shrink-0">
                            {item.item_type}
                          </Badge>
                        </div>
                        {isPending && (
                          <div className="flex gap-1.5">
                            <Button
                              size="sm"
                              variant="outline"
                              className="flex-1 h-7 text-xs gap-1 border-green-500/30 text-green-400 hover:bg-green-500/10"
                              onClick={() => handleAcceptSharedItem(item.id)}
                              disabled={acceptingId === item.id}
                            >
                              <CheckCircle2 className="h-3 w-3" />
                              {acceptingId === item.id ? '...' : 'Accept'}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="flex-1 h-7 text-xs gap-1 border-destructive/30 text-destructive hover:bg-destructive/10"
                              onClick={() => handleDeclineSharedItem(item.id)}
                              disabled={decliningId === item.id}
                            >
                              <XCircle className="h-3 w-3" />
                              {decliningId === item.id ? '...' : 'Decline'}
                            </Button>
                          </div>
                        )}
                        {!isPending && (
                          <Badge variant="outline" className="text-[10px] bg-green-500/10 text-green-400 border-green-500/20">
                            Accepted
                          </Badge>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Projects with AnimatedList */}
            {projects.length > 0 && (
              <div className="mt-4 flex-1 min-h-0 flex flex-col">
                <div className="px-4 mb-2">
                  <h3 className="text-sm font-medium text-muted-foreground">My Projects ({projects.length})</h3>
                </div>
                <div className="px-2 flex-1 min-h-0 flex flex-col">
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
          </>
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
            className="w-[280px] p-0 bg-card/50 backdrop-blur-sm flex flex-col"
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