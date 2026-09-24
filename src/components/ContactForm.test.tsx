import type { ButtonHTMLAttributes, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { invokeMock, mintMock, trackLeadMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  mintMock: vi.fn(() => "evt_lead_test"),
  trackLeadMock: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: invokeMock } },
}));
vi.mock("@/lib/tracking/funnel", () => ({
  createContactFormLeadEventId: mintMock,
  trackContactFormLead: trackLeadMock,
}));
vi.mock("@/lib/tracking/consent", () => ({
  getConsent: () => ({ advertising: true }),
}));
vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    variant: _variant,
    size: _size,
    asChild: _asChild,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: string;
    size?: string;
    asChild?: boolean;
  }) => <button {...props}>{children}</button>,
}));
vi.mock("@/components/ui/calendar", () => ({
  Calendar: ({ onSelect }: { onSelect: (date: Date) => void }) => (
    <button type="button" onClick={() => onSelect(new Date("2027-01-10T12:00:00"))}>
      Choose test date
    </button>
  ),
}));
vi.mock("@/components/ui/select", () => ({
  Select: ({ onValueChange, children }: { onValueChange: (value: string) => void; children: ReactNode }) => (
    <div>
      {children}
      <button type="button" onClick={() => onValueChange("General Question")}>Choose topic</button>
    </div>
  ),
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: () => null,
  SelectTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectValue: () => null,
}));

import ContactForm from "./ContactForm";

async function completeForm() {
  render(<ContactForm />);
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(/your name/i), "Test Guest");
  await user.type(screen.getByLabelText(/email address/i), "guest@example.com");
  await user.type(screen.getByLabelText(/phone number/i), "4075551212");
  await user.click(screen.getByRole("button", { name: /choose topic/i }));
  await user.click(screen.getByRole("button", { name: /select your event date/i }));
  await user.click(screen.getByRole("button", { name: /choose test date/i }));
  await user.type(screen.getByLabelText(/message/i), "Please send availability.");
  await user.click(screen.getByLabelText(/booking-related sms/i));
  await user.click(screen.getByLabelText(/offers, discounts/i));
  return user;
}

describe("ContactForm Meta Lead", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not fire the browser Lead when send-contact-form fails", async () => {
    invokeMock.mockResolvedValueOnce({ data: null, error: { message: "failed" } });
    const failedUser = await completeForm();
    await failedUser.click(screen.getByRole("button", { name: /send message/i }));
    expect(mintMock).toHaveBeenCalledTimes(1);
    expect(trackLeadMock).not.toHaveBeenCalled();
  });

  it("fires the browser Lead after send-contact-form succeeds", async () => {
    invokeMock.mockResolvedValueOnce({ data: { ok: true, tracked: true }, error: null });
    const successUser = await completeForm();
    await successUser.click(screen.getByRole("button", { name: /send message/i }));
    expect(trackLeadMock).toHaveBeenCalledWith(
      "evt_lead_test",
      "guest@example.com",
      "General Question",
    );
  });

  it("does not fire the browser Lead for a honeypot success response", async () => {
    invokeMock.mockResolvedValueOnce({
      data: { ok: true, message: "Message received" },
      error: null,
    });
    const honeypotUser = await completeForm();
    const honeypot = document.querySelector<HTMLInputElement>('input[name="website"]');
    expect(honeypot).not.toBeNull();
    fireEvent.change(honeypot!, { target: { value: "https://spam.example" } });

    await honeypotUser.click(screen.getByRole("button", { name: /send message/i }));

    expect(invokeMock).toHaveBeenCalledWith(
      "send-contact-form",
      expect.objectContaining({
        body: expect.objectContaining({ website: "https://spam.example" }),
      }),
    );
    expect(trackLeadMock).not.toHaveBeenCalled();
  });
});
