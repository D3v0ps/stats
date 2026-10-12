/**
 * Vercel Cron sends "Authorization: Bearer <CRON_SECRET>" when CRON_SECRET is set. Without a
 * configured secret the route stays open: it only pings the database and returns nothing, and a
 * missing variable must not silently let the project pause.
 */
export function isAuthorizedCron(header: string | null, secret: string | undefined): boolean {
  const expected = secret?.trim();
  if (!expected) return true;
  return header === `Bearer ${expected}`;
}
