// Shared opaque loading/error surfaces (fix 4, task 190c5048). The old loaders
// (transparent spinner screens, three 14px dots) were invisible against the
// wallpaper; these are deliberately OPAQUE (--background at full alpha).

// Opaque loading surfaces. The old loaders (48px spinner on a 20%-alpha screen, three
// 14px dots) were invisible against the wallpaper — login read as seconds of dead-air
// (07-24 bug 2). These panels are deliberately OPAQUE (--background at full alpha).
export const TaskListSkeleton = () => (
  <div className="mt-2 flex flex-col gap-2.5 flex-1 min-h-0" aria-label="Loading tasks">
    {[0, 1, 2, 3, 4, 5].map((i) => (
      <div
        key={i}
        className="animate-pulse rounded-2xl h-16 shrink-0"
        style={{ background: 'hsl(var(--background))', opacity: 0.9 - i * 0.12 }}
      />
    ))}
  </div>
);

// Full-screen boot skeleton for the auth/preferences gates — an app-shaped shell instead
// of a transparent spinner, so something visibly loads from the first paint.
export const AppBootSkeleton = () => (
  <div className="min-h-screen flex flex-col gap-2.5 p-3 pt-4">
    <div className="animate-pulse rounded-2xl h-11 shrink-0" style={{ background: 'hsl(var(--background))' }} />
    <div className="animate-pulse rounded-2xl h-9 w-3/4 shrink-0" style={{ background: 'hsl(var(--background))', opacity: 0.85 }} />
    <TaskListSkeleton />
  </div>
);

// Shown when a load failed or a known-populated account came back empty (the 07-24
// vanish): named error + retry instead of a silent void.
export const LoadErrorPanel = ({ onRetry }: { onRetry: () => void }) => (
  <div
    className="mt-6 rounded-2xl flex flex-col items-center justify-center gap-3 py-14 px-6 text-center"
    style={{ background: 'hsl(var(--background))' }}
  >
    <p className="font-semibold">Couldn't load your tasks</p>
    <p className="text-sm text-muted-foreground">Check your connection and try again.</p>
    <button type="button" className="lg-btn acc mt-1" onClick={onRetry}>
      Retry
    </button>
  </div>
);

