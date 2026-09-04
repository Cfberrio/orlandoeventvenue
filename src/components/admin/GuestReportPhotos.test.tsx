import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    storage: {
      from: () => ({
        getPublicUrl: (path: string) => ({
          data: { publicUrl: `https://cdn.test/cleaning-media/${path}` },
        }),
      }),
    },
  },
}));

import GuestReportPhotos from "./GuestReportPhotos";
import type { BookingAttachment } from "@/hooks/useAdminData";

function attachment(overrides: Partial<BookingAttachment> = {}): BookingAttachment {
  return {
    id: "att-1",
    booking_id: "bk-1",
    filename: "photo.jpg",
    content_type: "image/jpeg",
    size_bytes: 1024,
    storage_path: "bk-1/guest_main_area_media/1.jpg",
    category: "host_post_event",
    description: "guest_main_area_media",
    created_at: "2026-08-30T15:00:00Z",
    ...overrides,
  };
}

describe("GuestReportPhotos", () => {
  it("renders each guest photo with its public URL and a readable label", () => {
    render(
      <GuestReportPhotos
        attachments={[
          attachment(),
          attachment({
            id: "att-2",
            description: "guest_front_door_media",
            storage_path: "bk-1/guest_front_door_media/2.jpg",
          }),
        ]}
      />,
    );

    expect(screen.getByText(/Guest Photos \(2\)/)).toBeInTheDocument();

    const main = screen.getByAltText("Main venue space");
    expect(main).toHaveAttribute(
      "src",
      "https://cdn.test/cleaning-media/bk-1/guest_main_area_media/1.jpg",
    );
    expect(screen.getByAltText("Locked entrance")).toBeInTheDocument();
  });

  it("orders the known photo fields and pushes unknown ones to the end", () => {
    render(
      <GuestReportPhotos
        attachments={[
          attachment({ id: "a", description: "something_new" }),
          attachment({ id: "b", description: "guest_front_door_media" }),
          attachment({ id: "c", description: "guest_main_area_media" }),
        ]}
      />,
    );

    const labels = screen.getAllByRole("img").map((img) => img.getAttribute("alt"));
    expect(labels).toEqual(["Main venue space", "Locked entrance", "something_new"]);
  });

  it("flags maintenance photos as issue photos", () => {
    render(
      <GuestReportPhotos
        attachments={[attachment({ category: "maintenance", description: "guest_issue_media" })]}
      />,
    );

    expect(screen.getByAltText("Reported issue")).toBeInTheDocument();
    expect(screen.getByText("Issue photo")).toBeInTheDocument();
  });

  it("ignores attachments from other categories", () => {
    render(<GuestReportPhotos attachments={[attachment({ category: "contract" })]} />);

    expect(screen.getByText(/submitted the report without photos/i)).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("shows an empty state when there are no photos at all", () => {
    render(<GuestReportPhotos attachments={undefined} />);

    expect(screen.getByText(/submitted the report without photos/i)).toBeInTheDocument();
  });
});
