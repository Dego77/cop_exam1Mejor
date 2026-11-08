export const USER_AVATAR_COLORS = ['#00d4ff', '#a855f7', '#ec4899', '#22c55e', '#f59e0b', '#3b82f6', '#10b981'];

export function colorForUser(idOrEmail: any): string {
  const str = String(idOrEmail || '');
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return USER_AVATAR_COLORS[Math.abs(hash) % USER_AVATAR_COLORS.length];
}
