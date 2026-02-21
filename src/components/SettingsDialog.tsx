import { useState, useEffect } from 'react';
import { useTheme } from 'next-themes';
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
import { PushNotificationSettings } from '@/components/PushNotificationSettings';

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
  const { setTheme } = useTheme();
  const [selectedTheme, setSelectedTheme] = useState<'dark' | 'light'>('dark');
  const [defaultView, setDefaultView] = useState<string>('today');
  const [displayMode, setDisplayMode] = useState<'list' | 'grid' | 'gantt' | 'time'>('list');
  const [taskFilter, setTaskFilter] = useState<'all' | 'todo' | 'in-progress' | 'completed'>('all');
  const [taskCardView, setTaskCardView] = useState<'full' | 'compact'>('full');
  const [saving, setSaving] = useState(false);

  // Initialize form with preferences when they load
  useEffect(() => {
    if (preferences) {
      setDefaultView(preferences.default_view);
      setDisplayMode(preferences.default_display_mode);
      setTaskFilter(preferences.default_task_filter);
      setTaskCardView(preferences.default_task_card_view || 'full');
      setSelectedTheme(preferences.theme || 'dark');
    }
  }, [preferences]);

  // Apply theme immediately when changed
  const handleThemeChange = (value: string) => {
    const newTheme = value as 'dark' | 'light';
    setSelectedTheme(newTheme);
    setTheme(newTheme);
  };

  const handleSave = async () => {
    setSaving(true);
    await onSave({
      default_view: defaultView,
      default_display_mode: displayMode,
      default_task_filter: taskFilter,
      default_task_card_view: taskCardView,
      theme: selectedTheme,
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
            {/* Push Notifications */}
            <PushNotificationSettings preferences={preferences} onSave={onSave} />

            <Separator />

            {/* Theme Selection */}
            <div className="space-y-3">
              <Label className="text-base font-semibold">Theme</Label>
              <p className="text-sm text-muted-foreground">
                Choose your preferred color theme
              </p>
              <RadioGroup value={selectedTheme} onValueChange={handleThemeChange}>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="dark" id="theme-dark" />
                  <Label htmlFor="theme-dark" className="font-normal cursor-pointer">
                    Dark
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="light" id="theme-light" />
                  <Label htmlFor="theme-light" className="font-normal cursor-pointer">
                    Light
                  </Label>
                </div>
              </RadioGroup>
            </div>

            <Separator />

            {/* Default View Selection */}
            <div className="space-y-3">
              <Label htmlFor="default-view" className="text-base font-semibold">
                Default View
              </Label>
              <p className="text-sm text-muted-foreground">
                Choose which view to load when you first log in
              </p>
              <Select value={defaultView} onValueChange={setDefaultView}>
                <SelectTrigger id="default-view">
                  <SelectValue placeholder="Select default view" />
                </SelectTrigger>
                <SelectContent>
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
              <Label className="text-base font-semibold">Default Display Mode</Label>
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

            {/* Task Card View Selection */}
            <div className="space-y-3">
              <Label className="text-base font-semibold">Default Task Card View</Label>
              <p className="text-sm text-muted-foreground">
                Choose how much detail to show in task cards by default
              </p>
              <RadioGroup value={taskCardView} onValueChange={(value) => setTaskCardView(value as 'full' | 'compact')}>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="full" id="full-view" />
                  <Label htmlFor="full-view" className="font-normal cursor-pointer">
                    Full View (show all details)
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="compact" id="compact-view" />
                  <Label htmlFor="compact-view" className="font-normal cursor-pointer">
                    Compact View (hide metadata by default)
                  </Label>
                </div>
              </RadioGroup>
            </div>
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