// Build a LIFF deep-link. Appending ?invite=<code> makes the app open directly
// into that group (the client reads ?invite= on boot). Used by the summon Flex
// button and the reminder Flex button so taps land in the caller's group.
export function buildInviteUrl(liffId: string, inviteCode: string): string {
  return `https://liff.line.me/${liffId}?invite=${inviteCode}`;
}
