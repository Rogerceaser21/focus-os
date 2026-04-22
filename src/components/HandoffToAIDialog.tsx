import { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Separator } from '@/components/ui/separator';
import { Mic, Square, Loader2, Image as ImageIcon, Copy, ExternalLink } from 'lucide-react';
import { HandToAI } from '@/components/icons/HandToAI';
import { Task } from '@/types/task';
import { useVoiceRecorder } from '@/hooks/useVoiceRecorder';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import {
  AIProvider,
  ImageMode,
  PROVIDERS,
  buildFallbackPrompt,
  copyImageUrlToClipboard,
  openProviderWithPrompt,
} from '@/lib/aiHandoff';
import { cn } from '@/lib/utils';
import { getImageDisplayUrl } from '@/lib/taskImageStorage';

interface HandoffToAIDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task: Task;
  projectName?: string;
  defaultProvider?: AIProvider | null;
  defaultImageMode?: ImageMode;
  onPersistDefaults?: (updates: { provider?: AIProvider; imageMode?: ImageMode }) => void;
}

export const HandoffToAIDialog = ({
  open,
  onOpenChange,
  task,
  projectName,
  defaultProvider,
  defaultImageMode = 'public_link',
  onPersistDefaults,
}: HandoffToAIDialogProps) => {
  const [userContext, setUserContext] = useState('');
  const [provider, setProvider] = useState<AIProvider | null>(defaultProvider ?? null);
  const [imageMode, setImageMode] = useState<ImageMode>(defaultImageMode);
  const [includedImages, setIncludedImages] = useState<Record<string, boolean>>({});
  const [isCleaningUp, setIsCleaningUp] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isBuilding, setIsBuilding] = useState(false);
  const [previewPrompt, setPreviewPrompt] = useState<string | null>(null);

  const { isRecording, audioBlob, startRecording, stopRecording, reset } = useVoiceRecorder();
  const transcribedRef = useRef<Blob | null>(null);

  // Reset state when (re)opened
  useEffect(() => {
    if (open) {
      setUserContext('');
      setProvider(defaultProvider ?? null);
      setImageMode(defaultImageMode);
      setPreviewPrompt(null);
      const init: Record<string, boolean> = {};
      (task.images || []).forEach((img) => { init[img] = true; });
      setIncludedImages(init);
      reset();
      transcribedRef.current = null;
    }
  }, [open, task.id, defaultProvider, defaultImageMode]);

  // When recording stops, transcribe + clean up
  useEffect(() => {
    if (!audioBlob || transcribedRef.current === audioBlob) return;
    transcribedRef.current = audioBlob;
    void handleTranscribe(audioBlob);
  }, [audioBlob]);

  const blobToBase64 = (blob: Blob): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });

  const handleTranscribe = async (blob: Blob) => {
    try {
      setIsTranscribing(true);
      const base64 = await blobToBase64(blob);
      const { data, error } = await supabase.functions.invoke('focusos-transcribe-audio', {
        body: { audio: base64 },
      });
      if (error) throw error;
      const raw: string = data?.text || '';
      setIsTranscribing(false);

      if (!raw.trim()) {
        toast({ title: 'No speech detected', variant: 'destructive' });
        return;
      }

      // Dedicated cleanup endpoint — never reuse the prompt builder for this.
      setIsCleaningUp(true);
      const cleanupResp = await supabase.functions.invoke('focusos-clean-dictation', {
        body: { text: raw },
      });
      setIsCleaningUp(false);

      const cleaned = (cleanupResp.data as { cleaned?: string } | null)?.cleaned?.trim() || raw;
      setUserContext((prev) => (prev.trim() ? prev.trim() + '\n\n' + cleaned : cleaned));
    } catch (e) {
      console.error('transcribe error', e);
      setIsTranscribing(false);
      setIsCleaningUp(false);
      toast({ title: 'Voice capture failed', description: 'Please try again or type instead.', variant: 'destructive' });
    }
  };

  const toggleRecording = async () => {
    if (isRecording) {
      stopRecording();
    } else {
      try {
        await startRecording();
      } catch (e) {
        toast({ title: 'Mic permission denied', description: 'Allow microphone access to dictate.', variant: 'destructive' });
      }
    }
  };

  const buildImageUrls = (): string[] => {
    if (imageMode !== 'public_link') return [];
    return (task.images || [])
      .filter((img) => includedImages[img])
      .map((img) => getImageDisplayUrl(img));
  };

  const buildAndOpen = async () => {
    if (!provider) {
      toast({ title: 'Pick a provider', description: 'Choose where to send your prompt.', variant: 'destructive' });
      return;
    }

    setIsBuilding(true);
    let prompt = '';
    const imageUrls = buildImageUrls();
    try {
      const { data, error } = await supabase.functions.invoke('focusos-build-ai-handoff-prompt', {
        body: {
          task: {
            title: task.title,
            description: task.description,
            priority: task.priority,
            dueDate: task.dueDate ? new Date(task.dueDate).toLocaleDateString() : undefined,
            projectName,
          },
          userContext: userContext.trim() || undefined,
          imageUrls: imageUrls.length ? imageUrls : undefined,
          targetProvider: PROVIDERS[provider].label,
        },
      });
      if (error) throw error;
      prompt = (data as { prompt?: string })?.prompt?.trim() || '';
      if (!prompt) throw new Error('Empty prompt from AI builder');
    } catch (e) {
      console.error('build prompt failed', e);
      toast({ title: 'AI prompt builder failed', description: 'Using a basic prompt instead.', variant: 'destructive' });
      prompt = buildFallbackPrompt({
        title: task.title,
        description: task.description,
        priority: task.priority,
        dueDate: task.dueDate ? new Date(task.dueDate).toLocaleDateString() : undefined,
        projectName,
        userContext,
        imageUrls,
      });
    } finally {
      setIsBuilding(false);
    }

    setPreviewPrompt(prompt);

    // Persist defaults if user picked something new
    onPersistDefaults?.({
      provider: provider,
      imageMode,
    });

    // Open the provider
    const { copied } = await openProviderWithPrompt(provider, prompt);
    if (copied) {
      toast({ title: 'Prompt copied to clipboard', description: 'Paste it into the chat that just opened (Ctrl/Cmd+V).' });
    } else {
      toast({ title: `Opened ${PROVIDERS[provider].label}`, description: 'Your prompt is ready to send.' });
    }

    // Clipboard image flow
    if (imageMode === 'clipboard') {
      const includedUrls = (task.images || []).filter((img) => includedImages[img]).map(getImageDisplayUrl);
      if (includedUrls.length) {
        await chainCopyImages(includedUrls);
      }
    }
  };

  const chainCopyImages = async (urls: string[]) => {
    for (let i = 0; i < urls.length; i++) {
      try {
        await copyImageUrlToClipboard(urls[i]);
        toast({
          title: `Image ${i + 1}/${urls.length} copied`,
          description: i + 1 < urls.length
            ? 'Paste into chat, then come back for the next one.'
            : 'Last image — paste into chat.',
        });
        if (i + 1 < urls.length) {
          // Wait for user — we can't truly wait, but small delay between toasts
          await new Promise((r) => setTimeout(r, 4000));
        }
      } catch (e) {
        console.error('image clipboard copy failed', e);
        toast({ title: `Image ${i + 1} failed to copy`, variant: 'destructive' });
      }
    }
  };

  const copyPromptOnly = async () => {
    if (!previewPrompt) return;
    await navigator.clipboard.writeText(previewPrompt);
    toast({ title: 'Prompt copied' });
  };

  const taskImages = task.images || [];
  const recordingBusy = isRecording || isTranscribing || isCleaningUp;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <HandToAI variant="full" className="h-5 w-auto text-primary" strokeWidth={2} />
            Hand off to AI
          </DialogTitle>
          <DialogDescription>
            Send this task as a high-quality prompt to your favorite AI assistant.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 overflow-y-auto flex-1 pr-2 py-2">
          {/* Task preview */}
          <div className="rounded-md border bg-muted/40 p-3">
            <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Task</div>
            <div className="text-sm font-semibold">{task.title}</div>
            {task.description && (
              <div className="text-xs text-muted-foreground mt-1 line-clamp-3 whitespace-pre-wrap">
                {task.description}
              </div>
            )}
          </div>

          {/* Context field */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="ai-context">What are you trying to accomplish? <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Button
                type="button"
                variant={isRecording ? 'destructive' : 'outline'}
                size="sm"
                onClick={toggleRecording}
                disabled={isTranscribing || isCleaningUp}
                className="h-8"
              >
                {isRecording ? (
                  <><Square className="h-3 w-3 mr-1 fill-current" /> Stop</>
                ) : isTranscribing ? (
                  <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Transcribing</>
                ) : isCleaningUp ? (
                  <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Cleaning up</>
                ) : (
                  <><Mic className="h-3 w-3 mr-1" /> Dictate</>
                )}
              </Button>
            </div>
            <Textarea
              id="ai-context"
              placeholder="e.g. I'm preparing a Q3 report for the board and need help drafting the executive summary."
              value={userContext}
              onChange={(e) => setUserContext(e.target.value)}
              rows={4}
              disabled={recordingBusy}
            />
          </div>

          {/* Images */}
          {taskImages.length > 0 && (
            <>
              <Separator />
              <div className="space-y-2">
                <Label className="flex items-center gap-2"><ImageIcon className="h-4 w-4" /> Images ({taskImages.length})</Label>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {taskImages.map((img) => {
                    const src = getImageDisplayUrl(img);
                    const included = includedImages[img] ?? true;
                    return (
                      <button
                        key={img}
                        type="button"
                        onClick={() => setIncludedImages((s) => ({ ...s, [img]: !included }))}
                        className={cn(
                          'relative h-16 w-16 flex-shrink-0 rounded-md overflow-hidden border-2 transition',
                          included ? 'border-primary' : 'border-muted opacity-40'
                        )}
                        title={included ? 'Click to exclude' : 'Click to include'}
                      >
                        <img src={src} alt="task" className="w-full h-full object-cover" />
                      </button>
                    );
                  })}
                </div>
                <RadioGroup value={imageMode} onValueChange={(v) => setImageMode(v as ImageMode)} className="grid grid-cols-1 gap-1 pt-1">
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="public_link" id="img-public" />
                    <Label htmlFor="img-public" className="font-normal cursor-pointer text-xs">Embed image links in prompt (ChatGPT/Gemini will see them)</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="clipboard" id="img-clip" />
                    <Label htmlFor="img-clip" className="font-normal cursor-pointer text-xs">Copy images to clipboard one-by-one (paste manually)</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="skip" id="img-skip" />
                    <Label htmlFor="img-skip" className="font-normal cursor-pointer text-xs">Skip images</Label>
                  </div>
                </RadioGroup>
              </div>
            </>
          )}

          <Separator />

          {/* Provider picker */}
          <div className="space-y-2">
            <Label>Send to {!defaultProvider && <span className="text-xs text-muted-foreground font-normal">(pick once — we'll remember)</span>}</Label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {(Object.keys(PROVIDERS) as AIProvider[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setProvider(p)}
                  className={cn(
                    'flex flex-col items-center justify-center gap-1 rounded-md border-2 p-3 transition text-sm',
                    provider === p
                      ? 'border-primary bg-primary/10 text-primary font-semibold'
                      : 'border-border hover:border-primary/50 hover:bg-muted'
                  )}
                >
                  <span className="text-base font-bold">{PROVIDERS[p].short}</span>
                  <span className="text-xs">{PROVIDERS[p].label}</span>
                </button>
              ))}
            </div>
          </div>

          {previewPrompt && (
            <>
              <Separator />
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Generated prompt</Label>
                  <Button variant="ghost" size="sm" onClick={copyPromptOnly} className="h-7 text-xs">
                    <Copy className="h-3 w-3 mr-1" /> Copy
                  </Button>
                </div>
                <Textarea readOnly value={previewPrompt} rows={8} className="text-xs font-mono" />
              </div>
            </>
          )}
        </div>

        <DialogFooter className="flex-shrink-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isBuilding}>
            Cancel
          </Button>
          <Button onClick={buildAndOpen} disabled={isBuilding || recordingBusy || !provider}>
            {isBuilding ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Building prompt…</>
            ) : (
              <><ExternalLink className="h-4 w-4 mr-2" /> {previewPrompt ? 'Re-open in' : 'Hand off to'} {provider ? PROVIDERS[provider].label : 'AI'}</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};