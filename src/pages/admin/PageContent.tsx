import VenueContentAdminCard from "@/components/admin/VenueContentAdminCard";

export default function PageContent() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Page Content</h1>
        <p className="text-sm text-muted-foreground">
          Editable content shown on public-facing pages.
        </p>
      </div>
      <VenueContentAdminCard />
    </div>
  );
}
