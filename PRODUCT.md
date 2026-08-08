# Focus OS — product truth

Voice-first task, project and meeting manager. Web app (React + Vite + Tailwind +
shadcn/ui, Supabase backend), installable as an icon app; lives at focusos.tech.

**Audience:** busy people drowning in scattered todos: freelancers, team leads,
anyone who thinks faster than they type.

**Mechanism in one line:** you speak, and your work organises itself.

**The five features, in the promo film's order and voice (the canonical pitch):**

1. **Brain Dump** — press a button, speak your todo list into existence: tasks
   appear on screen as you talk, in order, grouped into projects.
2. **AI Handoff** — hand a task to your AI of choice: one press transfers it with
   a prompt that already knows exactly what to do.
3. **Meetings** — record it, get the transcript and the summary, send it to the
   team; any action item becomes a task.
4. **Sharing** — share tasks or whole projects with anyone by email or calendar
   invite; when the task is complete you get notified.
5. **Calendar** — one tap puts the plan on a dedicated calendar with real
   invites and a free/busy availability picker.

**Claims that are true:** free to start, no credit card required.
**Standing directives:** no school or institution branding anywhere; no em dashes
in copy; British/Australian English.

**Brand:** the locked liquid-glass design system (see the hub's
LIQUID-GLASS-TOKENS.md): wallpaper-driven materials (frost / smoke / solid),
deep teal `#0f7490` accent on the wave world, system font stack, radius scale
26/20/999. The promo film (`public/media/`) is the canonical brand voice; its
dark bookends and light product act are the two grounds of the marketing surface.

**Platform truth:** GitHub Pages hosting under `/focus-os/` (deployed) and
`/focus-os/preview/` (preview) base paths: all public asset URLs must go through
`import.meta.env.BASE_URL`. CTA route: `/auth`.
