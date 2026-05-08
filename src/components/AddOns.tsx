import Production from "./Production";
import BarService from "./BarService";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { usePricing } from "@/hooks/usePricing";

const AddOns = () => {
  const { pricing: p, isLoading } = usePricing();

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
            Enhance your event with production support, bar service, and extras. Mix and match to fit your needs.
          </p>
        </div>

        <div className="max-w-6xl mx-auto bg-background rounded-2xl shadow-sm border border-border p-6 md:p-10 space-y-10">
          <Production embedded />
          <div className="border-t border-border" />
          <BarService embedded />
          <div className="border-t border-border" />

          <div>
            <h3 className="text-2xl md:text-3xl font-bold text-center text-foreground mb-2">
              Extras
            </h3>
            <p className="text-center text-muted text-sm mb-6 max-w-2xl mx-auto">
              Small add-ons you can include with your booking.
            </p>
            <div className="grid md:grid-cols-2 gap-4 max-w-3xl mx-auto">
              <div className="flex items-center justify-between p-4 bg-accent rounded-lg">
                <span className="text-sm font-medium text-foreground">Setup & breakdown</span>
                <span className="text-sm font-bold text-primary">
                  {isLoading ? <Loader2 className="h-4 w-4 animate-spin inline" /> : `$${p.setup_breakdown}`}
                </span>
              </div>
              <div className="flex items-center justify-between p-4 bg-accent rounded-lg">
                <span className="text-sm font-medium text-foreground">Tablecloth</span>
                <span className="text-sm font-bold text-primary">
                  {isLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin inline" />
                  ) : (
                    `$${p.tablecloth_rental}/ea + $${p.tablecloth_cleaning_fee} cleaning`
                  )}
                </span>
              </div>
            </div>
          </div>
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
