import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

const FinalCTA = () => {
  const handleBooking = () => {
    // In production, this would link to a booking form or calendar
    alert("Booking system would be integrated here. Contact: [Your Twilio Number]");
  };

  return (
    <section id="book-now" className="py-16 md:py-24 bg-gradient-to-b from-accent to-background">
      <div className="container mx-auto px-4">
        <Card className="max-w-4xl mx-auto border-border shadow-2xl animate-fade-in hover:shadow-[0_20px_60px_-15px_rgba(0,0,0,0.3)] transition-all duration-500">
          <div className="p-8 md:p-12 text-center">
            <h2 className="text-3xl md:text-5xl font-bold mb-4 text-foreground">
              Ready to host an effortless event?
            </h2>
            <p className="text-lg text-muted mb-8 max-w-2xl mx-auto">
              Transparent pricing, production add-ons, and a beautiful space designed for results.
            </p>
            <Button size="lg" onClick={handleBooking} className="text-lg px-8 hover:scale-105 transition-all duration-300">
              Book Now
            </Button>
          </div>
        </Card>
      </div>
    </section>
  );
};

export default FinalCTA;
