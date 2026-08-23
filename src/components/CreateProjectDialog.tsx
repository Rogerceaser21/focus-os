import { useState } from 'react';
import { DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { TouchDialog, TouchDialogContent } from '@/components/ui/touch-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { Project } from '@/types/task';

const PRESET_COLORS = [
  '#ef4444', '#f97316', '#f59e0b', '#84cc16', '#10b981',
  '#14b8a6', '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6',
  '#a855f7', '#ec4899', '#f43f5e'
];

// Radix Select has no empty-string value, so "no parent" needs a sentinel.
const NO_PARENT = 'none';

interface CreateProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (name: string, color: string, parentProjectId: string | null) => void;
  /**
   * Projects offered in the "Parent project" select: the user's OWN active
   * TOP-LEVEL projects. A sub-project is never an option (one level only), and
   * the caller does that filtering, so this component stays presentational.
   * Omitted/empty = the select is not rendered at all and every project created
   * here is top level, exactly as before P3.
   */
  parentOptions?: Project[];
  /** Preselected parent when the dialog opens (the onebar's "New sub-project"). */
  defaultParentId?: string | null;
}

export const CreateProjectDialog = ({
  open,
  onOpenChange,
  onCreate,
  parentOptions = [],
  defaultParentId = null,
}: CreateProjectDialogProps) => {
  const [name, setName] = useState('');
  const [color, setColor] = useState('#3b82f6');
  const [parentId, setParentId] = useState<string>(defaultParentId ?? NO_PARENT);

  // Seed the parent select on the closed -> open transition, DURING RENDER via a
  // state latch (never a post-paint effect, and never a ref: a ref mutation
  // survives a discarded render while the queued state update dies). Without
  // this, reopening the dialog from the onebar's "New sub-project" row would
  // keep whatever the previous open left behind.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setParentId(defaultParentId ?? NO_PARENT);
  }

  const handleSubmit = () => {
    if (!name.trim()) return;
    onCreate(name, color, parentId === NO_PARENT ? null : parentId);
    setName('');
    setColor('#3b82f6');
    setParentId(NO_PARENT);
  };

  return (
    <TouchDialog open={open} onOpenChange={onOpenChange}>
      <TouchDialogContent>
        <DialogHeader>
          <DialogTitle>Create New Project</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="project-name">Project Name</Label>
            <Input
              id="project-name"
              placeholder="e.g., Website Redesign"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          {parentOptions.length > 0 && (
            <div className="space-y-2">
              <Label htmlFor="project-parent">Parent project</Label>
              <Select value={parentId} onValueChange={setParentId}>
                <SelectTrigger id="project-parent" data-testid="create-project-parent">
                  <SelectValue placeholder="None (top level)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_PARENT}>None (top level)</SelectItem>
                  {parentOptions.map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: project.color }} />
                        <span className="truncate">{project.name}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-2">
            <Label>Project Color</Label>
            <div className="grid grid-cols-7 gap-2" data-projects-tour-step="color-picker">
              {PRESET_COLORS.map((presetColor) => (
                <button
                  key={presetColor}
                  className="w-8 h-8 rounded-full border-2 transition-all"
                  style={{
                    backgroundColor: presetColor,
                    borderColor: color === presetColor ? '#fff' : 'transparent',
                    boxShadow: color === presetColor ? '0 0 0 2px currentColor' : 'none'
                  }}
                  onClick={() => setColor(presetColor)}
                />
              ))}
            </div>
          </div>

          <div className="flex gap-2 justify-end pt-4">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={!name.trim()}>
              Create Project
            </Button>
          </div>
        </div>
      </TouchDialogContent>
    </TouchDialog>
  );
};
