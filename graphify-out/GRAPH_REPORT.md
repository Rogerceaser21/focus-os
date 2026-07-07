# Graph Report - connect-your-code  (2026-07-07)

## Corpus Check
- 249 files · ~346,779 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1039 nodes · 2059 edges · 101 communities (72 shown, 29 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 1 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `1551af53`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 34|Community 34]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 36|Community 36]]
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 42|Community 42]]
- [[_COMMUNITY_Community 43|Community 43]]
- [[_COMMUNITY_Community 44|Community 44]]
- [[_COMMUNITY_Community 45|Community 45]]
- [[_COMMUNITY_Community 46|Community 46]]
- [[_COMMUNITY_Community 47|Community 47]]
- [[_COMMUNITY_Community 48|Community 48]]
- [[_COMMUNITY_Community 49|Community 49]]
- [[_COMMUNITY_Community 50|Community 50]]
- [[_COMMUNITY_Community 51|Community 51]]
- [[_COMMUNITY_Community 52|Community 52]]
- [[_COMMUNITY_Community 53|Community 53]]
- [[_COMMUNITY_Community 54|Community 54]]
- [[_COMMUNITY_Community 55|Community 55]]
- [[_COMMUNITY_Community 56|Community 56]]
- [[_COMMUNITY_Community 58|Community 58]]
- [[_COMMUNITY_Community 59|Community 59]]
- [[_COMMUNITY_Community 60|Community 60]]
- [[_COMMUNITY_Community 61|Community 61]]
- [[_COMMUNITY_Community 62|Community 62]]
- [[_COMMUNITY_Community 63|Community 63]]
- [[_COMMUNITY_Community 64|Community 64]]
- [[_COMMUNITY_Community 65|Community 65]]
- [[_COMMUNITY_Community 66|Community 66]]
- [[_COMMUNITY_Community 67|Community 67]]
- [[_COMMUNITY_Community 68|Community 68]]
- [[_COMMUNITY_Community 69|Community 69]]
- [[_COMMUNITY_Community 70|Community 70]]
- [[_COMMUNITY_Community 71|Community 71]]
- [[_COMMUNITY_Community 72|Community 72]]
- [[_COMMUNITY_Community 73|Community 73]]
- [[_COMMUNITY_Community 77|Community 77]]
- [[_COMMUNITY_Community 78|Community 78]]
- [[_COMMUNITY_Community 79|Community 79]]
- [[_COMMUNITY_Community 80|Community 80]]
- [[_COMMUNITY_Community 81|Community 81]]
- [[_COMMUNITY_Community 82|Community 82]]
- [[_COMMUNITY_Community 83|Community 83]]
- [[_COMMUNITY_Community 84|Community 84]]
- [[_COMMUNITY_Community 85|Community 85]]
- [[_COMMUNITY_Community 86|Community 86]]
- [[_COMMUNITY_Community 87|Community 87]]
- [[_COMMUNITY_Community 88|Community 88]]
- [[_COMMUNITY_Community 89|Community 89]]
- [[_COMMUNITY_Community 90|Community 90]]
- [[_COMMUNITY_Community 97|Community 97]]
- [[_COMMUNITY_Community 98|Community 98]]
- [[_COMMUNITY_Community 99|Community 99]]
- [[_COMMUNITY_Community 100|Community 100]]

## God Nodes (most connected - your core abstractions)
1. `cn()` - 80 edges
2. `Button` - 42 edges
3. `supabase` - 36 edges
4. `Task` - 29 edges
5. `useIsMobile()` - 22 edges
6. `useAuth()` - 21 edges
7. `Input` - 20 edges
8. `DialogContent` - 19 edges
9. `DialogHeader()` - 19 edges
10. `DialogTitle` - 18 edges

## Surprising Connections (you probably didn't know these)
- `MeetingDetail()` --calls--> `parseSummary()`  [INFERRED]
  src/pages/MeetingDetail.tsx → supabase/functions/focusos-poll-stuck-meetings/index.ts
- `ExtractedTask` --references--> `TaskPriority`  [EXTRACTED]
  src/components/TaskOnlyBrainDumpDialog.tsx → src/types/task.ts
- `BreadcrumbSeparator()` --calls--> `cn()`  [EXTRACTED]
  src/components/ui/breadcrumb.tsx → src/lib/utils.ts
- `BreadcrumbEllipsis()` --calls--> `cn()`  [EXTRACTED]
  src/components/ui/breadcrumb.tsx → src/lib/utils.ts
- `CommandShortcut()` --calls--> `cn()`  [EXTRACTED]
  src/components/ui/command.tsx → src/lib/utils.ts

## Import Cycles
- None detected.

## Communities (101 total, 29 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.19
Nodes (13): CreateProjectDialogProps, PRESET_COLORS, SendMeetingSummaryDialog(), SendMeetingSummaryDialogProps, Contact, ShareItemDialogProps, ShareItemType, Checkbox (+5 more)

### Community 1 - "Community 1"
Cohesion: 0.03
Nodes (58): dependencies, class-variance-authority, clsx, cmdk, date-fns, @dnd-kit/core, @dnd-kit/sortable, @dnd-kit/utilities (+50 more)

### Community 2 - "Community 2"
Cohesion: 0.11
Nodes (25): ApiTokensSection(), Action, ActionType, actionTypes, addToRemoveQueue(), dispatch(), genId(), listeners (+17 more)

### Community 3 - "Community 3"
Cohesion: 0.08
Nodes (25): Sidebar, SidebarContent, SidebarContext, SidebarFooter, SidebarGroup, SidebarGroupAction, SidebarGroupContent, SidebarGroupLabel (+17 more)

### Community 4 - "Community 4"
Cohesion: 0.15
Nodes (20): HomeTour(), HomeTourProps, TourStep, tourSteps, MeetingsTour(), MeetingsTourProps, meetingsTourSteps, TourStep (+12 more)

### Community 5 - "Community 5"
Cohesion: 0.17
Nodes (4): Result, queryClient, Toaster(), ToasterProps

### Community 6 - "Community 6"
Cohesion: 0.13
Nodes (19): SidebarScrollArea(), SidebarScrollAreaProps, SidePanel(), SidePanelProps, cn(), ButtonProps, buttonVariants, Calendar() (+11 more)

### Community 7 - "Community 7"
Cohesion: 0.17
Nodes (9): FormControl, FormDescription, FormFieldContext, FormFieldContextValue, FormItem, FormItemContext, FormItemContextValue, FormLabel (+1 more)

### Community 8 - "Community 8"
Cohesion: 0.18
Nodes (9): AttendeeChip, AttendeePicker(), ProfileHit, Props, roundToNextHalfHour(), toTimeValue(), PushArgs, useGoogleCalendar() (+1 more)

### Community 9 - "Community 9"
Cohesion: 0.09
Nodes (10): admin, ALLOWED_MIME, app, corsHeaders, httpHandler, JWKS, mcp, resolveUserIdFromToken() (+2 more)

### Community 10 - "Community 10"
Cohesion: 0.21
Nodes (8): HelpButtonProps, ProjectMember, ProjectMembersBar(), ProjectMembersBarProps, Avatar, AvatarFallback, AvatarImage, TooltipContent

### Community 11 - "Community 11"
Cohesion: 0.10
Nodes (20): compilerOptions, allowImportingTsExtensions, isolatedModules, jsx, lib, module, moduleDetection, moduleResolution (+12 more)

### Community 12 - "Community 12"
Cohesion: 0.16
Nodes (17): AddTaskDialogProps, AssignTaskDialogProps, DraggableTaskList(), DraggableTaskListProps, PRIORITY_LABELS, PRIORITY_ORDER, SortableTaskItemProps, EditTaskDialogProps (+9 more)

### Community 13 - "Community 13"
Cohesion: 0.16
Nodes (14): Project, ImageViewer(), ImageViewerProps, InviteProjectMemberDialog(), InviteProjectMemberDialogProps, Project, Button, SelectContent (+6 more)

### Community 15 - "Community 15"
Cohesion: 0.12
Nodes (12): LinkifiedText(), LinkifiedTextProps, LinkPart, parseLinks(), AccordionContent, AccordionItem, AccordionTrigger, HoverCardContent (+4 more)

### Community 16 - "Community 16"
Cohesion: 0.11
Nodes (18): devDependencies, autoprefixer, eslint, @eslint/js, eslint-plugin-react-hooks, eslint-plugin-react-refresh, globals, lovable-tagger (+10 more)

### Community 17 - "Community 17"
Cohesion: 0.12
Nodes (16): aliases, components, hooks, lib, ui, utils, rsc, $schema (+8 more)

### Community 18 - "Community 18"
Cohesion: 0.12
Nodes (16): 1. Share Dialog (replaces `AssignTaskDialog`), 2. "Shared Items" Section in Sidebar, 3. Sender Attribution on Shared Items, 4. Sharing from Projects & Meetings pages, Database, Decisions (Confirmed), Edge Function: `focusos-accept-shared-item`, Edge Function: `focusos-decline-shared-item` (+8 more)

### Community 19 - "Community 19"
Cohesion: 0.16
Nodes (13): greeting(), MOCK_TASKS, Preview(), STREAM, PRIORITY_ORDER, PROJECTS, Task, TASKS (+5 more)

### Community 20 - "Community 20"
Cohesion: 0.12
Nodes (15): compilerOptions, allowImportingTsExtensions, isolatedModules, lib, module, moduleDetection, moduleResolution, noEmit (+7 more)

### Community 21 - "Community 21"
Cohesion: 0.05
Nodes (79): AddTaskDialog(), BottomNav(), BottomNavProps, BrainDumpLiveDialog(), EditTaskDialog(), GanttChart(), GoogleCalendarButton(), HandoffToAIDialog() (+71 more)

### Community 22 - "Community 22"
Cohesion: 0.31
Nodes (7): ExtractedTask, BrainDumpLiveDialogProps, BrainDumpTask, ConnectionState, ProjectInfo, useBrainDumpLive(), TaskPriority

### Community 23 - "Community 23"
Cohesion: 0.08
Nodes (19): Carousel, CarouselApi, CarouselContent, CarouselContext, CarouselContextProps, CarouselItem, CarouselNext, CarouselOptions (+11 more)

### Community 24 - "Community 24"
Cohesion: 0.19
Nodes (11): BrainDumpDialog(), BrainDumpDialogProps, ExtractedData, ExtractedTask, TaskOnlyBrainDumpDialog(), TaskOnlyBrainDumpDialogProps, ExtractedTask, TodayBrainDumpDialog() (+3 more)

### Community 25 - "Community 25"
Cohesion: 0.26
Nodes (10): corsHeaders, doTranscription(), DoTranscriptionArgs, generateSummary(), getGcsAccessToken(), getSummaryPrompt(), parseGeminiSummaryResponse(), ServiceAccount (+2 more)

### Community 26 - "Community 26"
Cohesion: 0.17
Nodes (11): compilerOptions, allowJs, noImplicitAny, noUnusedLocals, noUnusedParameters, paths, skipLibCheck, strictNullChecks (+3 more)

### Community 27 - "Community 27"
Cohesion: 0.17
Nodes (11): Menubar, MenubarCheckboxItem, MenubarContent, MenubarItem, MenubarLabel, MenubarRadioItem, MenubarSeparator, MenubarShortcut() (+3 more)

### Community 28 - "Community 28"
Cohesion: 0.27
Nodes (8): corsHeaders, generateSummary(), getGcsAccessToken(), getSummaryPrompt(), handleResummarize(), parseGeminiSummaryResponse(), ServiceAccount, stripMarkdown()

### Community 29 - "Community 29"
Cohesion: 0.33
Nodes (5): ToggleGroup, ToggleGroupContext, ToggleGroupItem, Toggle, toggleVariants

### Community 30 - "Community 30"
Cohesion: 0.18
Nodes (10): CompositeTypes, Constants, Database, DatabaseWithoutInternals, DefaultSchema, Enums, Json, Tables (+2 more)

### Community 31 - "Community 31"
Cohesion: 0.18
Nodes (9): Command, CommandDialogProps, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator (+1 more)

### Community 32 - "Community 32"
Cohesion: 0.24
Nodes (5): CreateProjectDialog(), ProjectSidebarProps, SharedRecipient, TourLoadingOverlay(), TourLoadingOverlayProps

### Community 33 - "Community 33"
Cohesion: 0.20
Nodes (9): ContextMenuCheckboxItem, ContextMenuContent, ContextMenuItem, ContextMenuLabel, ContextMenuRadioItem, ContextMenuSeparator, ContextMenuShortcut(), ContextMenuSubContent (+1 more)

### Community 34 - "Community 34"
Cohesion: 0.21
Nodes (5): ApiToken, TokenRow, Label, labelVariants, Separator

### Community 35 - "Community 35"
Cohesion: 0.22
Nodes (4): DockIconProps, DockItemProps, DockLabelProps, DockProps

### Community 36 - "Community 36"
Cohesion: 0.22
Nodes (3): CalendarPlacement, corsHeaders, TokenRow

### Community 37 - "Community 37"
Cohesion: 0.22
Nodes (8): FocusOS Migration Plan, Migrating from `ujwmqwmsqklocvzlqpbm` → `mshlbsgsyzzfxyxramjj`, Notes, Phase 1: Set up new project ✅, Phase 2: Migrate data ⬜, Phase 3: Google OAuth ⬜ (user does this), Phase 4: Edge function secrets ⬜ (user does this), Phase 5: Verify ⬜ (both)

### Community 38 - "Community 38"
Cohesion: 0.22
Nodes (10): formatTimer(), RecipientTaskData, RecipientWorkModal(), RecipientWorkModalProps, compressImage(), deleteTaskImage(), getImageDisplayUrl(), isBase64Image() (+2 more)

### Community 39 - "Community 39"
Cohesion: 0.22
Nodes (8): Table, TableBody, TableCaption, TableCell, TableFooter, TableHead, TableHeader, TableRow

### Community 40 - "Community 40"
Cohesion: 0.28
Nodes (10): HandoffToAIDialogProps, RECOMMENDED_IMAGE_MODE, AIProvider, buildFallbackPrompt(), copyImageUrlToClipboard(), ImageMode, openProviderWithPrompt(), PROVIDERS (+2 more)

### Community 41 - "Community 41"
Cohesion: 0.25
Nodes (7): Build order (when approved), Decisions locked, Edge functions (new), Frontend changes, Google Calendar Integration — Implementation Plan, Schema additions, Sync rules (v1)

### Community 42 - "Community 42"
Cohesion: 0.25
Nodes (7): Architecture, Build order (after Google Calendar ships), Client setup, MCP Server Plan — Focus OS, MCP Tools (v1), Out of scope v1, Schema

### Community 43 - "Community 43"
Cohesion: 0.25
Nodes (7): Elements, Future, Navigation, Overview, Routes, Settings, Welcome / Home Screen — Implementation Plan

### Community 44 - "Community 44"
Cohesion: 0.25
Nodes (7): Breadcrumb, BreadcrumbEllipsis(), BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator()

### Community 45 - "Community 45"
Cohesion: 0.25
Nodes (6): DrawerContent, DrawerDescription, DrawerFooter(), DrawerHeader(), DrawerOverlay, DrawerTitle

### Community 46 - "Community 46"
Cohesion: 0.25
Nodes (7): NavigationMenu, NavigationMenuContent, NavigationMenuIndicator, NavigationMenuList, NavigationMenuTrigger, navigationMenuTriggerStyle, NavigationMenuViewport

### Community 47 - "Community 47"
Cohesion: 0.26
Nodes (8): AvailabilityScheduler(), formatHourLabel(), Props, sameLocalDay(), toLocalDateString(), Args, FreeBusyResponse, useFreeBusy()

### Community 48 - "Community 48"
Cohesion: 0.29
Nodes (6): imports, hono, jose, mcp-lite, @supabase/supabase-js, zod

### Community 49 - "Community 49"
Cohesion: 0.29
Nodes (6): Can I connect a custom domain to my Lovable project?, How can I deploy this project?, How can I edit this code?, Project info, Welcome to your Lovable project, What technologies are used for this project?

### Community 50 - "Community 50"
Cohesion: 0.53
Nodes (5): corsHeaders, generateSummary(), getSummaryPrompt(), parseSummary(), stripMarkdown()

### Community 51 - "Community 51"
Cohesion: 0.67
Nodes (3): buildTaskEmailHtml(), corsHeaders, escapeHtml()

### Community 54 - "Community 54"
Cohesion: 0.29
Nodes (6): 1. Shared helper, 2. `handleUpdateTask` in `src/pages/Index.tsx`, 3. `handleSavedTaskUpdate` in `src/pages/MeetingDetail.tsx`, Move-to-top on project change, Out of scope (unchanged), Verification

### Community 55 - "Community 55"
Cohesion: 0.40
Nodes (4): Alert, AlertDescription, AlertTitle, alertVariants

### Community 56 - "Community 56"
Cohesion: 0.40
Nodes (4): InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot

### Community 58 - "Community 58"
Cohesion: 0.50
Nodes (3): corsHeaders, RequestBody, TaskInput

### Community 64 - "Community 64"
Cohesion: 0.67
Nodes (3): buildMeetingEmailHtml(), corsHeaders, escapeHtml()

### Community 65 - "Community 65"
Cohesion: 0.60
Nodes (4): buildShareEmailHtml(), corsHeaders, escapeHtml(), fmtDate()

### Community 68 - "Community 68"
Cohesion: 0.21
Nodes (10): DropdownMenuItem, SheetContent, SheetContentProps, SheetDescription, SheetFooter(), SheetHeader(), SheetOverlay, SheetOverlayProps (+2 more)

### Community 73 - "Community 73"
Cohesion: 0.18
Nodes (10): name, private, scripts, build, build:dev, dev, lint, preview (+2 more)

### Community 97 - "Community 97"
Cohesion: 0.29
Nodes (7): CardContent, CardDescription, CardFooter, CardHeader, CardProps, CardTitle, cardVariants

### Community 98 - "Community 98"
Cohesion: 0.22
Nodes (8): DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuShortcut(), DropdownMenuSubContent, DropdownMenuSubTrigger

### Community 99 - "Community 99"
Cohesion: 0.32
Nodes (4): useWallpaper(), WallpaperController(), WallpaperId, WALLPAPERS

## Knowledge Gaps
- **502 isolated node(s):** `$schema`, `style`, `rsc`, `tsx`, `config` (+497 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **29 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `cn()` connect `Community 6` to `Community 0`, `Community 2`, `Community 3`, `Community 7`, `Community 8`, `Community 10`, `Community 13`, `Community 15`, `Community 21`, `Community 23`, `Community 27`, `Community 29`, `Community 31`, `Community 33`, `Community 34`, `Community 39`, `Community 40`, `Community 44`, `Community 45`, `Community 46`, `Community 47`, `Community 55`, `Community 56`, `Community 68`, `Community 97`, `Community 98`, `Community 100`?**
  _High betweenness centrality (0.077) - this node is a cross-community bridge._
- **Why does `Button` connect `Community 13` to `Community 0`, `Community 32`, `Community 34`, `Community 97`, `Community 68`, `Community 4`, `Community 6`, `Community 100`, `Community 8`, `Community 40`, `Community 10`, `Community 3`, `Community 47`, `Community 21`, `Community 22`, `Community 23`, `Community 24`?**
  _High betweenness centrality (0.023) - this node is a cross-community bridge._
- **Why does `supabase` connect `Community 8` to `Community 0`, `Community 32`, `Community 34`, `Community 97`, `Community 100`, `Community 5`, `Community 38`, `Community 40`, `Community 10`, `Community 13`, `Community 47`, `Community 21`, `Community 22`, `Community 24`?**
  _High betweenness centrality (0.011) - this node is a cross-community bridge._
- **What connects `$schema`, `style`, `rsc` to the rest of the system?**
  _502 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.034482758620689655 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.10837438423645321 - nodes in this community are weakly interconnected._
- **Should `Community 3` be split into smaller, more focused modules?**
  _Cohesion score 0.07692307692307693 - nodes in this community are weakly interconnected._