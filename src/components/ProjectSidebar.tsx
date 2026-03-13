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
  const [sharedProjects, setSharedProjects] = useState<Project[]>([]);
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

  // Supabase Realtime: live shared items for current user (as recipient)
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
          fetchSharedItems();
        }
      )
      // Listen for updates too (when status changes to 'accepted' — notify sender)
      .on(
        'postgres_changes' as any,
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'focusos_shared_items',
          filter: `sender_user_id=eq.${userId}`,
        },
        (payload: any) => {
          const updated = payload.new;
          const old = payload.old;
          // Notify sender when their shared item is accepted — queued via fetchSharedItems
          if (updated.status === 'accepted' && old?.status === 'pending') {
            // Don't show toast here — we'll show queued notifications from state
          }
          fetchSharedItems();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId]);

  // Realtime: re-fetch shared projects when any of this user's tasks change (status updates)
  useEffect(() => {
    if (!userId) return;

    const taskChannel = supabase
      .channel('sidebar-tasks-realtime')
      .on(
        'postgres_changes' as any,
        {
          event: '*',
          schema: 'public',
          table: 'focusos_tasks',
          filter: `user_id=eq.${userId}`,
        },
        (payload: any) => {
          // Re-fetch projects to update shared project visibility
          fetchProjects();
          // Also re-fetch shared items in case a change_request was created
          fetchSharedItems();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(taskChannel);
    };
  }, [userId]);

  // Queued notification: show one unacknowledged accepted item at a time for the sender
  useEffect(() => {
    if (!userId) return;
    const unacknowledged = sharedItems.filter(
      (item) => item.sender_user_id === userId && item.status === 'accepted' && !item.sender_acknowledged
    );
    if (unacknowledged.length > 0) {
      const first = unacknowledged[0];
      // Use a stable toast ID so we don't stack duplicates
      toast.success(`✅ "${first.item_title}" was accepted`, {
        id: `accept-notify-${first.id}`,
        description: `${first.recipient_email} accepted your shared ${first.item_type}`,
        duration: Infinity,
        action: {
          label: '✓ Dismiss',
          onClick: () => handleAcknowledgeSharedItem(first.id),
        },
      });
    }
  }, [sharedItems, userId]);

  const fetchProjects = async () => {
    const { data, error } = await (supabase as any)
      .from('focusos_projects')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      toast.error('Failed to load projects');
      return;
    }

    // Split into own projects and shared projects
    const ownProjects = data.filter((p: any) => !p.is_shared);
    const shared = data.filter((p: any) => p.is_shared);
    setProjects(ownProjects.map((p: any) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      timer: { totalSeconds: 0, isRunning: false }
    })));

    // For shared projects, filter out those where ALL tasks are completed
    if (shared.length > 0) {
      const sharedIds = shared.map((p: any) => p.id);
      const { data: sharedTasks } = await (supabase as any)
        .from('focusos_tasks')
        .select('id, project_id, status, change_request_message')
        .in('project_id', sharedIds);

      const activeShared = shared.filter((p: any) => {
        const projectTasks = (sharedTasks || []).filter((t: any) => t.project_id === p.id);
        // Show if no tasks yet, or if any task is actively visible (not completed AND no pending change request)
        const visibleActiveTasks = projectTasks.filter((t: any) => t.status !== 'completed' && !t.change_request_message);
        return projectTasks.length === 0 || visibleActiveTasks.length > 0;
      });

      setSharedProjects(activeShared.map((p: any) => ({
        id: p.id,
        name: p.name,
        color: p.color,
        timer: { totalSeconds: 0, isRunning: false }
      })));
    } else {
      setSharedProjects([]);
    }
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
      
      // Find the shared item to get its project_name and type
      const acceptedItem = sharedItems.find(i => i.id === sharedItemId);
      const isChangeRequest = acceptedItem?.item_type === 'change_request';
      
      toast.success(isChangeRequest ? 'Changes accepted — task is back in your project!' : 'Item accepted and added to your data!', { duration: 1500 });
      
      // Refresh data
      await fetchProjects();
      await fetchSharedItems();
      await fetchMeetings();
      
      // After a brief delay, navigate to the project
      if (acceptedItem?.project_name) {
        setTimeout(async () => {
          // Find the project matching the name
          const { data: matchedProject } = await (supabase as any)
            .from('focusos_projects')
            .select('id')
            .eq('name', acceptedItem.project_name)
            .limit(1)
            .single();
          
          if (matchedProject) {
            onSelectProject(matchedProject.id);
            onSelectSpecialList(null);
            if (isActuallyMobile) setOpenMobile(false);
          }
        }, 1200);
      }
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
  const handleAcknowledgeSharedItem = async (sharedItemId: string) => {
    try {
      await (supabase as any)
        .from('focusos_shared_items')
        .update({ sender_acknowledged: true })
        .eq('id', sharedItemId);
      fetchSharedItems();
    } catch (err) {
      console.error('Acknowledge error:', err);
    }
  };

  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const handleCancelSharedItem = async (sharedItemId: string) => {
    setCancellingId(sharedItemId);
    try {
      await (supabase as any)
        .from('focusos_shared_items')
        .update({ status: 'cancelled' })
        .eq('id', sharedItemId);
      toast.success('Shared item cancelled');
      fetchSharedItems();
    } catch (err) {
      console.error('Cancel error:', err);
      toast.error('Failed to cancel shared item');
    } finally {
      setCancellingId(null);
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
            {(() => {
              // Filter: hide accepted items for recipients, and sender's acknowledged items
              const visibleItems = sharedItems.filter((item) => {
                const isSender = item.sender_user_id === userId;
                const isRecipient = item.recipient_user_id === userId;
                // Hide accepted items from recipient's view (task is now in Shared Projects)
                if (isRecipient && item.status === 'accepted') return false;
                // Hide sender's accepted+acknowledged items
                if (isSender && item.status === 'accepted' && item.sender_acknowledged) return false;
                return true;
              });
              return visibleItems.length > 0 ? (
              <div className="mt-3 px-2">
                <div className="px-2 mb-2">
                  <h3 className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
                    <Share2 className="h-3.5 w-3.5" />
                    Shared Items ({visibleItems.length})
                  </h3>
                </div>
                <div className="space-y-1.5">
                  {visibleItems.map((item) => {
                    const isPending = item.status === 'pending';
                    const isAccepted = item.status === 'accepted';
                    const isSender = item.sender_user_id === userId;
                    const isChangeRequest = item.item_type === 'change_request';
                    const typeIcon = (item.item_type === 'task' || isChangeRequest)
                      ? <ClipboardList className="h-3.5 w-3.5 text-primary" />
                      : item.item_type === 'project' 
                      ? <Folder className="h-3.5 w-3.5 text-primary" />
                      : <Mic className="h-3.5 w-3.5 text-teal-400" />;
                    
                    // For change_request items, sender_name holds the change message
                    const changeMessage = isChangeRequest ? item.sender_name : null;
                    
                    return (
                      <div key={item.id} className={`rounded-lg border p-2.5 space-y-1.5 ${isChangeRequest ? 'border-orange-500/40 bg-orange-500/5' : 'border-border/50 bg-card/50'}`}>
                        {isChangeRequest && (
                          <div className="flex items-center gap-1.5 text-orange-400">
                            <span className="text-xs font-semibold">⚠️ Changes Requested</span>
                          </div>
                        )}
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
                              {isChangeRequest
                                ? `From: ${item.sender_email}`
                                : isSender 
                                  ? `To: ${item.recipient_email}` 
                                  : `From: ${item.sender_name || item.sender_email}`
                              }
                            </p>
                          </div>
                          <Badge variant="outline" className="text-[10px] shrink-0">
                            {isChangeRequest ? 'task' : item.item_type}
                          </Badge>
                        </div>
                        {/* Show change request message */}
                        {isChangeRequest && changeMessage && (
                          <p className="text-xs text-orange-300/80 italic px-1">"{changeMessage}"</p>
                        )}
                        {isPending && !isSender && (
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
                              {decliningId === item.id ? '...' : 'Reject'}
                            </Button>
                          </div>
                        )}
                        {isPending && isSender && (
                          <Badge variant="outline" className="text-[10px] text-muted-foreground">
                            Pending acceptance
                          </Badge>
                        )}
                        {isAccepted && (
                          <div className="flex items-center gap-1.5">
                            <Badge variant="outline" className="text-[10px] bg-green-500/10 text-green-400 border-green-500/20">
                              Accepted
                            </Badge>
                            {isSender && !item.sender_acknowledged && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-6 px-2 text-[10px] gap-1 border-green-500/30 text-green-400 hover:bg-green-500/10"
                                onClick={() => handleAcknowledgeSharedItem(item.id)}
                              >
                                <CheckCircle2 className="h-3 w-3" />
                                Dismiss
                              </Button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
              ) : null;
            })()}

            {/* Shared Projects */}
            {sharedProjects.length > 0 && (
              <div className="mt-3 px-2">
                <div className="px-2 mb-2">
                  <h3 className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
                    <Share2 className="h-3.5 w-3.5" />
                    Shared Projects ({sharedProjects.length})
                  </h3>
                </div>
                <div className="space-y-1">
                  {sharedProjects.map((project) => (
                    <Button
                      key={project.id}
                      variant={selectedProjectId === project.id ? 'secondary' : 'ghost'}
                      className="w-full justify-start gap-2"
                      onClick={() => {
                        handleSelectProject(project.id);
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