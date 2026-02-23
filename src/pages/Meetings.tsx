import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Mic, Clock, FileText, ChevronRight, Plus, Folder } from 'lucide-react';
import { format } from 'date-fns';
import { Skeleton } from '@/components/ui/skeleton';

interface Meeting {
  id: string;
  title: string;
  duration_seconds: number;
  summary: string | null;
  action_items: any[];
  project_id: string | null;
  created_at: string;
}

interface Project {
  id: string;
  name: string;
  color: string;
}

const Meetings = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const projectId = searchParams.get('project');
  const { user, loading: authLoading } = useAuth();
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/auth');
    }
  }, [user, authLoading, navigate]);

  useEffect(() => {
    if (user) {
      fetchMeetings();
      fetchProjects();
    }
  }, [user, projectId]);

  const fetchProjects = async () => {
    const { data } = await supabase
      .from('projects')
      .select('id, name, color');
    if (data) setProjects(data);
  };

  const fetchMeetings = async () => {
    setLoading(true);
    let query = supabase
      .from('meetings')
      .select('*')
      .order('created_at', { ascending: false });

    if (projectId) {
      query = query.eq('project_id', projectId);
    }

    const { data, error } = await query;
    if (!error && data) {
      setMeetings(data.map(m => ({
        ...m,
        action_items: Array.isArray(m.action_items) ? m.action_items : [],
      })));
    }
    setLoading(false);
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const hrs = Math.floor(mins / 60);
    if (hrs > 0) return `${hrs}h ${mins % 60}m`;
    return `${mins}m`;
  };

  const currentProject = projects.find(p => p.id === projectId);

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate('/app')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex-1">
            <h1 className="text-xl font-bold">Meetings</h1>
            {currentProject && (
              <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Folder className="h-3.5 w-3.5" style={{ color: currentProject.color }} />
                <span>{currentProject.name}</span>
              </div>
            )}
          </div>
          <Button className="gap-2" onClick={() => { /* TODO: start new meeting */ }}>
            <Plus className="h-4 w-4" />
            New Meeting
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-4 py-6">
        {loading ? (
          <div className="space-y-4">
            {[1, 2, 3].map(i => (
              <Skeleton key={i} className="h-24 w-full rounded-lg" />
            ))}
          </div>
        ) : meetings.length === 0 ? (
          <div className="text-center py-20">
            <Mic className="h-12 w-12 mx-auto text-muted-foreground/40 mb-4" />
            <h2 className="text-lg font-semibold mb-1">No meetings yet</h2>
            <p className="text-muted-foreground text-sm mb-6">
              Record a meeting to get AI-powered transcription, summaries, and action items.
            </p>
            <Button className="gap-2" onClick={() => { /* TODO: start new meeting */ }}>
              <Mic className="h-4 w-4" />
              Record Your First Meeting
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {meetings.map(meeting => {
              const project = projects.find(p => p.id === meeting.project_id);
              return (
                <Card
                  key={meeting.id}
                  className="cursor-pointer hover:border-primary/30 transition-colors"
                  onClick={() => { /* TODO: open meeting detail */ }}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="font-semibold truncate">{meeting.title}</h3>
                          {project && (
                            <Badge variant="outline" className="text-xs shrink-0">
                              <Folder className="h-3 w-3 mr-1" style={{ color: project.color }} />
                              {project.name}
                            </Badge>
                          )}
                        </div>
                        {meeting.summary && (
                          <p className="text-sm text-muted-foreground line-clamp-2 mb-2">
                            {meeting.summary}
                          </p>
                        )}
                        <div className="flex items-center gap-4 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {formatDuration(meeting.duration_seconds)}
                          </span>
                          <span>
                            {format(new Date(meeting.created_at), 'MMM d, yyyy · h:mm a')}
                          </span>
                          {meeting.action_items.length > 0 && (
                            <span className="flex items-center gap-1">
                              <FileText className="h-3 w-3" />
                              {meeting.action_items.length} action items
                            </span>
                          )}
                        </div>
                      </div>
                      <ChevronRight className="h-5 w-5 text-muted-foreground shrink-0 mt-1" />
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default Meetings;
