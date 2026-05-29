import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import finalCtaBg from "@/assets/finalcta-bg.jpg";

const FinalCTA = () => {
  const handleBooking = () => {
    window.location.href = "/book";
  };

  return (
    <section id="book-now" className="py-8 md:py-12 relative overflow-hidden">
      {/* Background image */}
      <div
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: `url(${finalCtaBg})` }}
      />
      {/* Fade overlay matching other sections */}
      <div className="absolute inset-0 bg-gradient-to-b from-background/80 via-background/70 to-background/80" />
      {/* Bottom fade to background */}
      <div className="absolute bottom-0 left-0 right-0 h-24 bg-gradient-to-b from-transparent to-background" />

      <div className="container mx-auto px-4 relative z-10">
        <Card className="max-w-4xl mx-auto border-border shadow-2xl animate-fade-in hover:shadow-[0_20px_60px_-15px_rgba(0,0,0,0.3)] transition-all duration-500 bg-card/60 backdrop-blur-md border-border/50">
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
