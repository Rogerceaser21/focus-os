import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { UserPreferences } from '@/hooks/useUserPreferences';
import { PROVIDERS, AIProvider, ImageMode } from '@/lib/aiHandoff';
import { WALLPAPERS, useWallpaper, usePlainColor, type WallpaperId } from '@/lib/wallpaper';
import GoogleCalendarIntegration from '@/components/GoogleCalendarIntegration';
import ApiTokensSection from '@/components/ApiTokensSection';
import { IS_SHELL } from '@/lib/shell';

interface Project {
  id: string;
  name: string;
  color: string;
}

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projects: Project[];
  preferences: UserPreferences | null;
  loading: boolean;
  onSave: (updates: Partial<UserPreferences>) => Promise<void>;
}

export default function SettingsDialog({
  open,
  onOpenChange,
  projects,
  preferences,
  loading,
  onSave,
}: SettingsDialogProps) {
  const [wallpaper, setWallpaperChoice] = useWallpaper();
  const [plainColor, setPlainColorChoice] = usePlainColor();
  const [defaultView, setDefaultView] = useState<string>('today');
  const [displayMode, setDisplayMode] = useState<'list' | 'grid' | 'gantt' | 'time'>('list');
  const [taskFilter, setTaskFilter] = useState<'all' | 'todo' | 'in-progress' | 'completed'>('all');
  const [taskCardView, setTaskCardView] = useState<'full' | 'compact' | 'minimal'>('compact');
  const [taskCardViewMobile, setTaskCardViewMobile] = useState<'full' | 'compact' | 'minimal'>('compact');
  const [saving, setSaving] = useState(false);
  const [aiProvider, setAiProvider] = useState<AIProvider | 'none'>('none');
  const [aiImageMode, setAiImageMode] = useState<ImageMode>('public_link');

  // Initialize form with preferences when they load
  useEffect(() => {
    if (preferences) {
      setDefaultView(preferences.default_view);
      setDisplayMode(preferences.default_display_mode);
      setTaskFilter(preferences.default_task_filter);
      setTaskCardView(preferences.default_task_card_view || 'compact');
      setTaskCardViewMobile(preferences.default_task_card_view_mobile || 'compact');
      setAiProvider((preferences.ai_handoff_default_provider as AIProvider | null) ?? 'none');
      setAiImageMode((preferences.ai_handoff_image_mode as ImageMode | undefined) ?? 'public_link');
    }
  }, [preferences]);

  const handleSave = async () => {
    setSaving(true);
    await onSave({
      default_view: defaultView,
      default_display_mode: displayMode,
      default_task_filter: taskFilter,
      default_task_card_view: taskCardView,
      default_task_card_view_mobile: taskCardViewMobile,
      ai_handoff_default_provider: aiProvider === 'none' ? null : aiProvider,
      ai_handoff_image_mode: aiImageMode,
    });
    setSaving(false);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] max-h-[85vh] flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Customize your default view preferences
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="space-y-6 py-4 overflow-y-auto flex-1">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : (
          <div className="space-y-6 py-4 overflow-y-auto flex-1 pr-2">
            {/* Background Selection */}
            <div className="space-y-3">
              <Label className="text-base font-semibold">Background</Label>
              <p className="text-sm text-muted-foreground">
                Pick a wallpaper, or Plain with your own colour
              </p>
              <div className="flex flex-wrap gap-2">
                {(Object.keys(WALLPAPERS) as WallpaperId[]).map((id) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setWallpaperChoice(id)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                      wallpaper === id
                        ? 'bg-primary text-primary-foreground border-transparent'
                        : 'bg-secondary/50 text-muted-foreground border-border hover:bg-secondary'
                    }`}
                  >
                    {WALLPAPERS[id].name}
                  </button>
                ))}
              </div>
              {wallpaper === 'plain' && (
                <div className="flex items-center gap-3 pt-1">
                  <input
                    type="color"
                    value={plainColor}
                    onChange={(e) => setPlainColorChoice(e.target.value)}
                    aria-label="Plain background colour"
                    className="h-9 w-14 cursor-pointer rounded-lg border border-border bg-transparent p-1"
                  />
                  <span className="text-sm text-muted-foreground">Background colour</span>
                </div>
              )}
            </div>

            <Separator />

            {/* Default View Selection */}
            <div className="space-y-3">
              <Label htmlFor="default-view" className="text-base font-semibold">
                Default Project/List View
              </Label>
              <p className="text-sm text-muted-foreground">
                Choose which view to load when you first log in
              </p>
              <Select value={defaultView} onValueChange={setDefaultView}>
                <SelectTrigger id="default-view">
                  <SelectValue placeholder="Select default view" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="home">Home</SelectItem>
                  <SelectItem value="today">Today's To-Do</SelectItem>
                  <SelectItem value="unassigned">Unassigned</SelectItem>
                  {projects.length > 0 && (
                    <>
                      <Separator className="my-2" />
                      {projects.map((project) => (
                        <SelectItem key={project.id} value={project.id}>
                          <div className="flex items-center gap-2">
                            <div
                              className="w-3 h-3 rounded-full"
                              style={{ backgroundColor: project.color }}
                            />
                            {project.name}
                          </div>
                        </SelectItem>
                      ))}
                    </>
                  )}
                </SelectContent>
              </Select>
            </div>

            <Separator />

            {/* Display Mode Selection */}
            <div className="space-y-3">
              <Label className="text-base font-semibold">Default Task Display Mode</Label>
              <p className="text-sm text-muted-foreground">
                How do you want tasks to be displayed?
              </p>
              <RadioGroup value={displayMode} onValueChange={(value) => setDisplayMode(value as any)}>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="list" id="list" />
                  <Label htmlFor="list" className="font-normal cursor-pointer">
                    List
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="grid" id="grid" />
                  <Label htmlFor="grid" className="font-normal cursor-pointer">
                    Grid
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="gantt" id="gantt" />
                  <Label htmlFor="gantt" className="font-normal cursor-pointer">
                    Gantt
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="time" id="time" />
                  <Label htmlFor="time" className="font-normal cursor-pointer">
                    Time
                  </Label>
                </div>
              </RadioGroup>
            </div>

            <Separator />

            {/* Task Filter Selection */}
            <div className="space-y-3">
              <Label className="text-base font-semibold">Default Task Filter</Label>
              <p className="text-sm text-muted-foreground">
                Which tasks do you want to see by default?
              </p>
              <RadioGroup value={taskFilter} onValueChange={(value) => setTaskFilter(value as any)}>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="all" id="all" />
                  <Label htmlFor="all" className="font-normal cursor-pointer">
                    All
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="todo" id="todo" />
                  <Label htmlFor="todo" className="font-normal cursor-pointer">
                    To Do
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="in-progress" id="in-progress" />
                  <Label htmlFor="in-progress" className="font-normal cursor-pointer">
                    In Progress
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="completed" id="completed" />
                  <Label htmlFor="completed" className="font-normal cursor-pointer">
                    Done
                  </Label>
                </div>
              </RadioGroup>
            </div>

            <Separator />

            {/* Task Card View - Mobile */}
            <div className="space-y-3">
              <Label className="text-base font-semibold">Mobile Task Card View</Label>
              <p className="text-sm text-muted-foreground">
                Default card detail level on mobile devices
              </p>
              <RadioGroup value={taskCardViewMobile} onValueChange={(value) => setTaskCardViewMobile(value as 'full' | 'compact' | 'minimal')}>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="full" id="mobile-full-view" />
                  <Label htmlFor="mobile-full-view" className="font-normal cursor-pointer">
                    Full View (show all details)
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="compact" id="mobile-compact-view" />
                  <Label htmlFor="mobile-compact-view" className="font-normal cursor-pointer">
                    Compact View (hide metadata by default)
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="minimal" id="mobile-minimal-view" />
                  <Label htmlFor="mobile-minimal-view" className="font-normal cursor-pointer">
                    Minimal View (title + shared badge only)
                  </Label>
                </div>
              </RadioGroup>
            </div>

            <Separator />

            {/* Task Card View - Desktop/Tablet */}
            <div className="space-y-3">
              <Label className="text-base font-semibold">Desktop/Tablet Task Card View</Label>
              <p className="text-sm text-muted-foreground">
                Default card detail level on larger screens
              </p>
              <RadioGroup value={taskCardView} onValueChange={(value) => setTaskCardView(value as 'full' | 'compact' | 'minimal')}>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="full" id="desktop-full-view" />
                  <Label htmlFor="desktop-full-view" className="font-normal cursor-pointer">
                    Full View (show all details)
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="compact" id="desktop-compact-view" />
                  <Label htmlFor="desktop-compact-view" className="font-normal cursor-pointer">
                    Compact View (hide metadata by default)
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="minimal" id="desktop-minimal-view" />
                  <Label htmlFor="desktop-minimal-view" className="font-normal cursor-pointer">
                    Minimal View (title + shared badge only)
                  </Label>
                </div>
              </RadioGroup>
            </div>

            <Separator />

            {/* AI Hand-off */}
            <div className="space-y-3">
              <Label className="text-base font-semibold">AI Hand-off</Label>
              <p className="text-sm text-muted-foreground">
                Default AI assistant when handing off a task
              </p>
              <Select value={aiProvider} onValueChange={(v) => setAiProvider(v as AIProvider | 'none')}>
                <SelectTrigger>
                  <SelectValue placeholder="Ask each time" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Ask each time</SelectItem>
                  {(Object.keys(PROVIDERS) as AIProvider[]).map((p) => (
                    <SelectItem key={p} value={p}>{PROVIDERS[p].label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <p className="text-sm text-muted-foreground pt-2">How to send task images</p>
              <RadioGroup value={aiImageMode} onValueChange={(v) => setAiImageMode(v as ImageMode)}>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="public_link" id="ai-img-link" />
                  <Label htmlFor="ai-img-link" className="font-normal cursor-pointer">Embed image links in prompt</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="clipboard" id="ai-img-clip" />
                  <Label htmlFor="ai-img-clip" className="font-normal cursor-pointer">Copy to clipboard one-by-one</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="skip" id="ai-img-skip" />
                  <Label htmlFor="ai-img-skip" className="font-normal cursor-pointer">Skip images</Label>
                </div>
              </RadioGroup>
            </div>

            <Separator />

            {/* Integrations. Google's OAuth consent cannot complete inside the
                shell's WKWebView, so the connect flow lives on the web only —
                calendar data still shows here once connected there. */}
            {IS_SHELL ? (
              <div className="space-y-1">
                <Label>Google Calendar</Label>
                <p className="text-sm text-muted-foreground">
                  Connect Google Calendar from focusos.tech in a web browser.
                  Once connected there, your calendar shows up here too.
                </p>
              </div>
            ) : (
              <GoogleCalendarIntegration />
            )}

            <Separator />

            <ApiTokensSection />

            <Separator />

            <p className="text-xs text-muted-foreground">
              <a
                href={`${import.meta.env.BASE_URL}privacy.html`}
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-4 hover:text-foreground"
              >
                Privacy Policy<span className="sr-only"> (opens in new tab)</span>
              </a>
            </p>
          </div>
        )}

        <DialogFooter className="flex-shrink-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={loading || saving}>
            {saving ? 'Saving...' : 'Save Preferences'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}