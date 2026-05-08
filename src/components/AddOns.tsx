import Production from "./Production";
import BarService from "./BarService";
import { Button } from "@/components/ui/button";

const AddOns = () => {
  const handleBooking = () => {
    window.location.href = "/book";
  };

  return (
    <section id="add-ons" className="scroll-mt-24 py-10 md:py-14 bg-accent/30">
      <div className="container mx-auto px-4">
        <div className="max-w-6xl mx-auto text-center mb-8">
          <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-3">
            Optional Add-Ons
          </h2>
          <p className="text-muted max-w-2xl mx-auto">
            Enhance your event with production support and bar service. Mix and match to fit your needs.
          </p>
        </div>

        <div className="max-w-6xl mx-auto bg-background rounded-2xl shadow-sm border border-border p-6 md:p-10 space-y-10">
          <Production embedded />
          <div className="border-t border-border" />
          <BarService embedded />
        </div>

        <div className="text-center mt-8">
          <Button size="lg" onClick={handleBooking}>
            Add to My Booking
          </Button>
        </div>
      </div>
    </section>
  );
};

export default AddOns;
