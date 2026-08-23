// Pure map-building half of Index.tsx's buildSharedMaps (O3, 2026-08-23).
// Turns raw focusos_shared_items rows + a resolved profiles map into the
// per-task / per-project recipient maps the share-status pill reads. Kept
// pure (no fetching) so Home's useQuery can call it too, without a second
// copy of the loop. Index.tsx still owns the impure half: the
// focusos_shared_items select and the focusos_profiles name lookup.

export interface RawSharedItemRow {
  id: string;
  item_id: string;
  item_type: string;
  recipient_email: string;
  recipient_user_id: string | null;
  recipient_task_id?: string | null;
  status: string;
}

export interface SenderSharedRecipient {
  email: string;
  name: string;
  status: string;
  sharedItemId?: string;
}

export type SenderSharedMap = Record<string, SenderSharedRecipient[]>;

export interface SenderSharedMaps {
  taskMap: SenderSharedMap;
  projectMap: SenderSharedMap;
}

/**
 * Groups shared_items rows (where the current user is sender) into a
 * taskMap and projectMap keyed by item_id, resolving each recipient's
 * display name from profilesMap (recipient_user_id -> "First Last") when
 * available, falling back to the raw recipient_email otherwise.
 */
export function buildSenderSharedMaps(
  sharedItems: RawSharedItemRow[],
  profilesMap: Record<string, string>
): SenderSharedMaps {
  const taskMap: SenderSharedMap = {};
  const projectMap: SenderSharedMap = {};

  for (const si of sharedItems) {
    const name = si.recipient_user_id && profilesMap[si.recipient_user_id]
      ? profilesMap[si.recipient_user_id]
      : si.recipient_email;
    const entry: SenderSharedRecipient = { email: si.recipient_email, name, status: si.status, sharedItemId: si.id };
    if (si.item_type === 'task') {
      if (!taskMap[si.item_id]) taskMap[si.item_id] = [];
      taskMap[si.item_id].push(entry);
    } else if (si.item_type === 'project') {
      if (!projectMap[si.item_id]) projectMap[si.item_id] = [];
      projectMap[si.item_id].push(entry);
    }
  }

  return { taskMap, projectMap };
}
