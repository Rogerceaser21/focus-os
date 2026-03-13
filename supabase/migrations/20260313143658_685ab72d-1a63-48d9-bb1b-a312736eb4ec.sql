-- Backfill recipient_task_id for existing accepted meeting shares
UPDATE focusos_shared_items SET recipient_task_id = '0350362d-4a43-4afb-b248-56b50b4fb9e0' WHERE id = '75bec6bf-3ca8-4fe8-8ffe-7bf838092337';
UPDATE focusos_shared_items SET recipient_task_id = 'ebc7e106-0b14-475d-ba73-4f562a4fb869' WHERE id = 'f453a5dd-fcef-4d26-8441-bca49f74d064';