
-- Sync Ava's RCF PROJECT tasks to match the original sender's data

-- 1. Mark "Check shock absorbers" as completed
UPDATE focusos_tasks SET status = 'completed', completed_at = '2025-11-09 17:24:52.017695+00'
WHERE id = 'dbfe2d18-6a65-4a73-add8-8f401cc3bdbf';

-- 2. Mark "Botttom line..." as completed
UPDATE focusos_tasks SET status = 'completed', completed_at = '2025-11-09 17:24:52.017695+00'
WHERE id = 'ed3b1884-e665-4ac0-877f-9cdd20267a20';

-- 3. Mark "Default Priority..." as completed
UPDATE focusos_tasks SET status = 'completed', completed_at = '2025-11-18 05:26:08.760125+00'
WHERE id = 'a8052119-f36d-4de1-85cc-d0653d744dba';

-- 4. Mark "Install Apple CarPlay" as completed with sort_order 6
UPDATE focusos_tasks SET status = 'completed', completed_at = '2026-02-27 14:08:30.599976+00', sort_order = 6
WHERE id = 'df4cd871-3218-4a4a-bda7-14f2c5342f2f';

-- 5. Copy images from original "Seat sensor" task to Ava's copy
UPDATE focusos_tasks SET images = (
  SELECT images FROM focusos_tasks WHERE id = '33dc7206-a835-4a8a-8f0b-d76619bb47d5'
)
WHERE id = 'c53f69a1-1b45-46ec-b7c4-10cfae7350aa';
