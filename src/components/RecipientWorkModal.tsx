import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Clock, Calendar, CheckCircle2, Image as ImageIcon, FileText, AlertCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { getImageDisplayUrl } from '@/lib/taskImageStorage';
import { ImageViewer } from '@/components/ImageViewer';
import { format } from 'date-fns';

interface RecipientWorkModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sharedItemId: string;
  recipientEmail: string;
  recipientName?: string;
}

interface RecipientTaskData {
  title: string;
  description: string | null;
  images: string[] | null;
  timer_total_seconds: number;
  timer_is_running: boolean;
  timer_start_time: number | null;
  start_date: string | null;
  end_date: string | null;
  due_date: string | null;
  completed_at: string | null;
  status: string;
  priority: string;
}

const formatTimer = (totalSeconds: number, isRunning: boolean, startTime: number | null): string => {
  let seconds = totalSeconds;
  if (isRunning && startTime) {
    seconds += Math.floor((Date.now() - startTime) / 1000);
  }
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
};

export const RecipientWorkModal = ({ open, onOpenChange, sharedItemId, recipientEmail, recipientName }: RecipientWorkModalProps) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [task, setTask] = useState<RecipientTaskData | null>(null);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);

    supabase.functions.invoke('focusos-get-recipient-task', {
      body: { sharedItemId },
    }).then(({ data, error: fnError }) => {
      if (fnError || data?.error) {
        setError(data?.error || fnError?.message || 'Failed to load');
      } else {
        setTask(data.task);
      }
      setLoading(false);
    });
  }, [open, sharedItemId]);

  const images = (task?.images as string[] | null) || [];
  const displayName = recipientName || recipientEmail;

  const statusLabel: Record<string, { text: string; className: string }> = {
    todo: { text: 'To Do', className: 'bg-muted text-foreground' },
    'in-progress': { text: 'In Progress', className: 'bg-primary/15 text-primary' },
    completed: { text: 'Completed', className: 'bg-green-500/15 text-green-400' },
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[550px] max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <span>Work by</span>
              <Badge variant="outline" className="bg-purple-600/15 text-purple-400 border-purple-600/30 text-xs">
                {displayName}
              </Badge>
            </DialogTitle>
          </DialogHeader>

          {loading && (
            <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
              Loading...
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 py-8 text-destructive text-sm justify-center">
              <AlertCircle className="h-4 w-4" />
              {error}
            </div>
          )}

          {task && !loading && (
            <div className="space-y-4 pt-2">
              {/* Title */}
              <div>
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1">Task</p>
                <p className="text-sm font-medium">{task.title}</p>
              </div>

              {/* Status & Priority row */}
              <div className="flex items-center gap-2">
                <Badge className={statusLabel[task.status]?.className || 'bg-muted text-foreground'}>
                  {statusLabel[task.status]?.text || task.status}
                </Badge>
                <Badge variant="outline" className="text-xs capitalize">{task.priority}</Badge>
                {task.completed_at && (
                  <span className="text-[10px] text-green-400 flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3" />
                    {format(new Date(task.completed_at), 'MMM d, yyyy')}
                  </span>
                )}
              </div>

              {/* Description */}
              <div>
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1 flex items-center gap-1">
                  <FileText className="h-3 w-3" /> Description
                </p>
                {task.description ? (
                  <p className="text-sm text-foreground whitespace-pre-wrap bg-muted/30 rounded-md p-3">
                    {task.description}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground italic">No description added</p>
                )}
              </div>

              {/* Timer */}
              <div>
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1 flex items-center gap-1">
                  <Clock className="h-3 w-3" /> Time Tracked
                </p>
                <p className="text-sm font-mono">
                  {formatTimer(task.timer_total_seconds, task.timer_is_running, task.timer_start_time)}
                  {task.timer_is_running && (
                    <Badge className="ml-2 bg-green-500/15 text-green-400 text-[10px]">Running</Badge>
                  )}
                </p>
              </div>

              {/* Dates */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1 flex items-center gap-1">
                    <Calendar className="h-3 w-3" /> Start
                  </p>
                  <p className="text-xs">{task.start_date ? format(new Date(task.start_date), 'MMM d, yyyy') : '—'}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1 flex items-center gap-1">
                    <Calendar className="h-3 w-3" /> End
                  </p>
                  <p className="text-xs">{task.end_date ? format(new Date(task.end_date), 'MMM d, yyyy') : '—'}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1 flex items-center gap-1">
                    <Calendar className="h-3 w-3" /> Due
                  </p>
                  <p className="text-xs">{task.due_date ? format(new Date(task.due_date), 'MMM d, yyyy') : '—'}</p>
                </div>
              </div>

              {/* Images */}
              <div>
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1 flex items-center gap-1">
                  <ImageIcon className="h-3 w-3" /> Images ({images.length})
                </p>
                {images.length > 0 ? (
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                    {images.map((img, idx) => (
                      <img
                        key={idx}
                        src={getImageDisplayUrl(img)}
                        alt={`Image ${idx + 1}`}
                        className="w-full h-20 object-cover rounded border cursor-pointer hover:opacity-80 transition-opacity"
                        onClick={() => { setCurrentImageIndex(idx); setViewerOpen(true); }}
                      />
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground italic">No images added</p>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {viewerOpen && images.length > 0 && (
        <ImageViewer
          images={images.map(getImageDisplayUrl)}
          currentIndex={currentImageIndex}
          onClose={() => setViewerOpen(false)}
          onNavigate={setCurrentImageIndex}
        />
      )}
    </>
  );
};
