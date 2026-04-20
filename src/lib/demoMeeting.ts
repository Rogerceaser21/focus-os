// Hardcoded demo meeting used by the Meetings tour.
// Intercepted in MeetingDetail.tsx — never hits the database.

export const DEMO_MEETING_ID = 'demo-meeting-tour';

const DEMO_SUMMARY = JSON.stringify({
  overview:
    "The team aligned on Q3 priorities, agreed to ship the new analytics dashboard by August 15, and assigned owners for the marketing launch and customer onboarding revamp.",
  outline: [
    {
      heading: 'Q3 Priorities',
      points: [
        'Analytics dashboard is the top engineering priority for the quarter.',
        'Customer onboarding revamp slated for late August after dashboard ships.',
        'Marketing launch campaign to start two weeks before public release.',
      ],
    },
    {
      heading: 'Decisions Made',
      points: [
        'Ship analytics dashboard by August 15.',
        'Sarah owns the marketing launch end-to-end.',
        'Weekly check-ins moved to Tuesdays at 10am.',
      ],
    },
    {
      heading: 'Open Questions',
      points: [
        'Final pricing tiers for the new dashboard still TBD.',
        'Need to confirm whether existing customers get auto-upgraded.',
      ],
    },
  ],
});

export const DEMO_MEETING = {
  id: DEMO_MEETING_ID,
  title: 'Q3 Roadmap Sync (Demo)',
  duration_seconds: 32 * 60 + 14,
  summary: DEMO_SUMMARY,
  action_items: [
    { title: 'Finalize dashboard scope doc', assignee: 'Alex' },
    { title: 'Draft marketing launch plan', assignee: 'Sarah' },
    { title: 'Schedule pricing review meeting', assignee: 'Jordan' },
  ],
  participants: [
    { name: 'Alex Chen', email: 'alex@example.com' },
    { name: 'Sarah Patel', email: 'sarah@example.com' },
    { name: 'Jordan Lee', email: 'jordan@example.com' },
  ],
  project_id: null,
  created_at: new Date().toISOString(),
  transcript_gcs_path: null,
  recording_gcs_path: null,
};

export const DEMO_TRANSCRIPT =
  "Alex: Thanks everyone for joining. Let's lock in Q3 priorities.\n\nSarah: I think the analytics dashboard has to be number one — customers have been asking for months.\n\nAlex: Agreed. Let's commit to August 15. Jordan, can engineering hit that?\n\nJordan: Tight, but yes — assuming we don't expand the scope.\n\nSarah: I'll own the marketing launch. We'll start the campaign two weeks before release.\n\nAlex: Perfect. Let's also revamp customer onboarding right after the dashboard ships.\n\n[... transcript continues ...]";
