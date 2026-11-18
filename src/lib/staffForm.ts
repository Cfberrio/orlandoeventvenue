// C-9: staff email is the portal login and is unique in the DB
// (staff_members_email_unique). Turn DB errors into something the office can act on.
export function staffSaveErrorMessage(e: unknown): string | undefined {
  const err = (e ?? {}) as { code?: string; message?: string };
  if (err.code === "23505" || /staff_members_email_unique/.test(err.message ?? "")) {
    return "That email is already used by another staff member. Each person needs their own email to sign in.";
  }
  if (e instanceof Error) return e.message;
  return err.message;
}
