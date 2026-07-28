/**
 * Naming for external (partner) bookings.
 *
 * The real client name MUST come first: GHL splits the contact `name` on the
 * first space to derive firstName, and firstName feeds customer-facing
 * automations ({{contact.first_name}} in SMS/email). A leading "External - "
 * prefix made every automated message say "Hi External".
 * The " - External" suffix keeps the marker visible in admin UI and the GHL
 * calendar title without contaminating firstName.
 */
export const buildExternalFullName = (clientName: string): string =>
  `${clientName.trim()} - External`;
