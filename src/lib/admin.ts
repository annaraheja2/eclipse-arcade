// UI-GATING ONLY. This client-side list exists so the interface can show or
// hide admin affordances (badges, future admin pages). It is NOT security:
// anyone can edit the bundle in devtools. Real enforcement lives server-side
// in firestore.rules, which independently checks the same emails AND requires
// email_verified. Never make an authorization decision from this check alone.
//
// NOTE: because email_verified is required and email/password sign-up never
// sends a verification email (see lib/auth.tsx), admin access is effectively
// GOOGLE-SIGN-IN-ONLY for now — accepted for this phase, not a bug to "fix"
// by loosening the emailVerified check.
export const ADMIN_EMAILS = ['annaraheja2@gmail.com', 'alexleyvalp@gmail.com'] as const

export function isAdminEmail(email: string): boolean {
  return (ADMIN_EMAILS as readonly string[]).includes(email)
}
