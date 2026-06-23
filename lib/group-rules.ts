// Group action rules. LINE-synced groups (lineGroupId set) are managed by LINE:
// you can't invite into, leave, or delete them from the app. Manually-created
// groups allow all actions. Shared by the client (hide buttons) and server (403 guard).
export interface GroupLike {
  lineGroupId?: string | null;
}

export function isLineGroup(group: GroupLike): boolean {
  return !!group.lineGroupId;
}

export function canInvite(group: GroupLike): boolean {
  return !isLineGroup(group);
}

export function canLeave(group: GroupLike): boolean {
  return !isLineGroup(group);
}

export function canDelete(group: GroupLike): boolean {
  return !isLineGroup(group);
}
