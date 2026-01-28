import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Armchair, Table2, ChefHat, MapPin } from "lucide-react";
import heroBg from "@/assets/hero-bg-new.jpg";

const Hero = () => {
  const scrollToSection = (id: string) => {
    const element = document.getElementById(id);
    if (element) {
      element.scrollIntoView({ behavior: "smooth" });
    }
  };

  const handleBooking = () => {
    window.location.href = "/book";
  };

  return (
    <section className="relative pt-32 md:pt-48 pb-12 md:pb-16 overflow-hidden">
      {/* Background Image with Overlay */}
      <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url(${heroBg})` }} />
      <div className="absolute inset-0 bg-gradient-to-b from-background/80 via-background/70 to-background/60" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,hsl(var(--primary)/0.15),transparent_50%)]" />

      {/* Fade out effect at bottom */}
      <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-b from-transparent to-background" />

      {/* Content */}
      <div className="container mx-auto px-4 relative z-10">
        <div className="max-w-4xl mx-auto text-center animate-fade-in">
          <h1 className="text-4xl md:text-6xl font-bold text-foreground mb-6 leading-tight animate-fade-in">
            Modern venue for corporate events, celebrations, and presentations.
          </h1>

          <Card className="mb-8 max-w-5xl mx-auto bg-card/60 backdrop-blur-md border-border/50 shadow-xl hover:shadow-2xl transition-all duration-500 hover:scale-[1.02]">
            <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-border/30">
              <div
                className="flex flex-col items-center justify-center gap-3 p-8 h-40 animate-wave"
                style={{ animationDelay: "0s" }}
              >
                <Armchair size={48} strokeWidth={2.5} className="text-primary" />
                <div className="text-sm text-foreground/70 text-center font-medium">90 chairs</div>
              </div>

              <div
                className="flex flex-col items-center justify-center gap-3 p-8 h-40 animate-wave"
                style={{ animationDelay: "0.2s" }}
              >
                <Table2 size={48} strokeWidth={2.5} className="text-primary" />
                <div className="text-sm text-foreground/70 text-center font-medium">10 tables</div>
              </div>

              <div
                className="flex flex-col items-center justify-center gap-3 p-8 h-40 animate-wave"
                style={{ animationDelay: "0.4s" }}
              >
                <ChefHat size={48} strokeWidth={2.5} className="text-primary" />
                <div className="text-sm text-foreground/70 text-center font-medium">Prep kitchen</div>
              </div>

              <div
                className="flex flex-col items-center justify-center gap-3 p-8 h-40 animate-wave"
                style={{ animationDelay: "0.6s" }}
              >
                <MapPin size={48} strokeWidth={2.5} className="text-primary" />
                <div className="text-sm text-foreground/70 text-center font-medium">Near Downtown Orlando</div>
              </div>
            </div>
          </Card>

          <div className="flex flex-col items-center gap-6 mb-6">
            <Button
              size="lg"
              onClick={handleBooking}
              className="text-lg px-8 py-6 hover:scale-105 transition-all duration-300 shadow-lg animate-enter animate-pulse-glow"
              style={{ animationDuration: "0.8s" }}
            >
              Book Now
            </Button>

            <div className="flex flex-wrap justify-center gap-3">
              <Badge variant="secondary" className="px-4 py-2 text-sm">
                No catering restrictions
              </Badge>
              <Badge
                variant="secondary"
                className="px-4 py-2 text-sm cursor-pointer hover:scale-105 transition-all duration-300"
                onClick={() => scrollToSection("pricing")}
              >
                See Pricing
              </Badge>
            </div>
          </div>

          <p className="text-sm text-foreground/80 font-medium">Flat pricing + Flexibility</p>
        </div>
      </div>
    </section>
  );
};

export default Hero;
