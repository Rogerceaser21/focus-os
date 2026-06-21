## Plan: Dismiss Sonner Toast when Acknowledging Shared Item

### Understanding of Requirements
1. **Goal:** Dismissing an accepted shared item from the sidebar card should immediately dismiss the matching bottom-right toast notification, and vice versa.
2. **Current state:**
   - Toasts are opened with a stable ID format: `accept-notify-${first.id}`.
   - When the user clicks "Dismiss" on the toast itself, it invokes `handleAcknowledgeSharedItem(first.id)` which marks the item as acknowledged, hiding the card in the sidebar. This flow works.
   - However, when the user clicks the neutral "Dismiss" (`EyeOff`) button on the sidebar card itself, it calls `handleAcknowledgeSharedItem(item.id)` directly but does not close the active sonner toast.
3. **Requirement:** Modify `handleAcknowledgeSharedItem` so that when the item is marked as acknowledged in the database/UI, any matching active toast is explicitly dismissed using `toast.dismiss(id)`.

---

### Implementation Details
We will edit `src/components/ProjectSidebar.tsx`:

1. Update `handleAcknowledgeSharedItem` (around lines 514-524):
   ```typescript
   const handleAcknowledgeSharedItem = async (sharedItemId: string) => {
     try {
       // Dismiss the matching toast immediately to ensure congruence
       toast.dismiss(`accept-notify-${sharedItemId}`);
       
       await (supabase as any)
         .from('focusos_shared_items')
         .update({ sender_acknowledged: true })
         .eq('id', sharedItemId);
       fetchSharedItems();
     } catch (err) {
       console.error('Acknowledge error:', err);
     }
   };
   ```

2. This guarantees that either click source triggers the dismissal of both the DB record (removing the card) and the sonner toast instance.

---

### Verification Strategy
- We will double-check that the code compiles.
- No other styles, icons, or visual constraints will be touched.
