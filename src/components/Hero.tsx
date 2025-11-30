import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { MapPin, Sparkles } from "lucide-react";
import heroBg from "@/assets/hero-bg.jpg";

const Hero = () => {
  const scrollToSection = (id: string) => {
    const element = document.getElementById(id);
    if (element) {
      element.scrollIntoView({ behavior: "smooth" });
    }
  };

  return (
    <section className="relative py-20 md:py-32 overflow-hidden">
      {/* Background Image with Overlay */}
      <div 
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: `url(${heroBg})` }}
      />
      <div className="absolute inset-0 bg-background/70" />
      
      {/* Content */}
      <div className="container mx-auto px-4 relative z-10">
        <div className="max-w-4xl mx-auto text-center animate-fade-in">
          <h1 className="text-4xl md:text-6xl font-bold text-foreground mb-6 leading-tight animate-fade-in">
            Modern venue for corporate events, celebrations, and presentations.
          </h1>
          
          <Card className="mb-8 max-w-5xl mx-auto bg-card/50 backdrop-blur-sm border-border/50 animate-float">
            <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-border/30">
              <div className="flex flex-col items-center justify-center gap-3 p-6 h-36">
                <div className="text-4xl md:text-5xl font-bold text-primary">90</div>
                <div className="text-sm md:text-base text-foreground/70 text-center">Capacity</div>
              </div>
              
              <div className="flex flex-col items-center justify-center gap-3 p-6 h-36">
                <div className="text-4xl md:text-5xl font-bold text-primary">24/7</div>
                <div className="text-sm md:text-base text-foreground/70 text-center">Access</div>
              </div>
              
              <div className="flex flex-col items-center justify-center gap-3 p-6 h-36">
                <MapPin size={40} className="text-primary" />
                <div className="text-sm md:text-base text-foreground/70 text-center">Near Downtown Orlando</div>
              </div>
              
              <div className="flex flex-col items-center justify-center gap-3 p-6 h-36">
                <Sparkles size={40} className="text-primary" />
                <div className="text-sm md:text-base text-foreground/70 text-center">High Level Production A/V</div>
              </div>
            </div>
          </Card>

          <div className="flex flex-wrap justify-center gap-3 mb-8">
            <Badge variant="secondary" className="px-4 py-2 text-sm animate-float" style={{ animationDelay: '0.8s' }}>
              No catering restrictions
            </Badge>
          </div>

          <div className="flex flex-wrap justify-center gap-4 mb-6 animate-fade-in">
            <Button size="lg" onClick={() => scrollToSection("book-now")} className="hover:scale-105 transition-all duration-300">
              Book Now
            </Button>
            <Button size="lg" variant="outline" onClick={() => scrollToSection("pricing")} className="hover:scale-105 transition-all duration-300">
              See Pricing
            </Button>
          </div>

          <p className="text-sm text-foreground/80 font-medium">
            Flat pricing + Flexibility
          </p>
        </div>
      </div>
    </section>
  );
};

export default Hero;
