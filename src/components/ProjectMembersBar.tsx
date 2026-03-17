import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { UserPlus, Users } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface ProjectMember {
  id: string;
  user_id: string;
  invited_email: string;
  role: string;
  status: string;
  displayName?: string;
}

interface ProjectMembersBarProps {
  projectId: string;
  isOwner: boolean;
  onInviteClick: () => void;
  refreshTrigger?: number;
}

export const ProjectMembersBar = ({ projectId, isOwner, onInviteClick, refreshTrigger }: ProjectMembersBarProps) => {
  const [members, setMembers] = useState<ProjectMember[]>([]);

  useEffect(() => {
    fetchMembers();
  }, [projectId, refreshTrigger]);

  // Realtime subscription for member changes
  useEffect(() => {
    const channel = supabase
      .channel(`project-members-${projectId}`)
      .on(
        'postgres_changes' as any,
        {
          event: '*',
          schema: 'public',
          table: 'focusos_project_members',
          filter: `project_id=eq.${projectId}`,
        },
        () => fetchMembers()
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [projectId]);

  const fetchMembers = async () => {
    const { data, error } = await (supabase as any)
      .from('focusos_project_members')
      .select('id, user_id, invited_email, role, status')
      .eq('project_id', projectId)
      .in('status', ['pending', 'accepted']);

    if (error || !data) return;

    // Fetch display names for accepted members
    const userIds = data.filter((m: any) => m.status === 'accepted' && m.user_id !== '00000000-0000-0000-0000-000000000000').map((m: any) => m.user_id);
    let profilesMap: Record<string, string> = {};
    if (userIds.length > 0) {
      const { data: profiles } = await (supabase as any)
        .from('focusos_profiles')
        .select('user_id, first_name, last_name')
        .in('user_id', userIds);
      if (profiles) {
        for (const p of profiles) {
          const name = [p.first_name, p.last_name].filter(Boolean).join(' ');
          if (name) profilesMap[p.user_id] = name;
        }
      }
    }

    setMembers(data.map((m: any) => ({
      ...m,
      displayName: profilesMap[m.user_id] || m.invited_email,
    })));
  };

  if (members.length === 0 && !isOwner) return null;

  const acceptedMembers = members.filter(m => m.status === 'accepted');
  const pendingMembers = members.filter(m => m.status === 'pending');

  const getInitials = (name: string) => {
    const parts = name.split(/[@.\s]/);
    return parts.slice(0, 2).map(p => p[0]?.toUpperCase() || '').join('');
  };

  const roleColor = (role: string) => {
    switch (role) {
      case 'collaborator': return 'bg-primary/20 text-primary border-primary/30';
      case 'viewer': return 'bg-muted text-muted-foreground border-border';
      default: return '';
    }
  };

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {(acceptedMembers.length > 0 || pendingMembers.length > 0) && (
        <TooltipProvider delayDuration={300}>
          <div className="flex items-center -space-x-2">
            {acceptedMembers.slice(0, 5).map((member) => (
              <Tooltip key={member.id}>
                <TooltipTrigger asChild>
                  <Avatar className="h-7 w-7 border-2 border-background cursor-default">
                    <AvatarFallback className="text-[10px] bg-primary/20 text-primary">
                      {getInitials(member.displayName || member.invited_email)}
                    </AvatarFallback>
                  </Avatar>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">
                  <p className="font-medium">{member.displayName}</p>
                  <p className="text-muted-foreground capitalize">{member.role}</p>
                </TooltipContent>
              </Tooltip>
            ))}
            {acceptedMembers.length > 5 && (
              <Avatar className="h-7 w-7 border-2 border-background">
                <AvatarFallback className="text-[10px] bg-muted text-muted-foreground">
                  +{acceptedMembers.length - 5}
                </AvatarFallback>
              </Avatar>
            )}
          </div>
        </TooltipProvider>
      )}
      
      {pendingMembers.length > 0 && (
        <Badge variant="outline" className="text-[10px] text-muted-foreground">
          {pendingMembers.length} pending
        </Badge>
      )}

      {isOwner && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 text-xs text-primary hover:text-primary hover:bg-primary/10"
          onClick={onInviteClick}
        >
          <UserPlus className="h-3.5 w-3.5" />
          <span className="hidden lg:inline">Invite</span>
        </Button>
      )}
    </div>
  );
};
