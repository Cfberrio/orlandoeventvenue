import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MapPin, Users, Sparkles } from "lucide-react";
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
          
          <div className="flex flex-wrap justify-center gap-3 mb-6 text-foreground/90 font-medium">
            <div className="flex items-center gap-2">
              <Users size={20} />
              <span>Capacity 90</span>
            </div>
            <span>•</span>
            <div className="flex items-center gap-2">
              <MapPin size={20} />
              <span>Near Downtown Orlando</span>
            </div>
            <span>•</span>
            <div className="flex items-center gap-2">
              <Sparkles size={20} />
              <span>High Level Production A/V</span>
            </div>
          </div>

          <div className="flex flex-wrap justify-center gap-3 mb-8">
            <Badge variant="secondary" className="px-4 py-2 text-sm">
              No catering restrictions
            </Badge>
            <Badge variant="secondary" className="px-4 py-2 text-sm">
              24-hr Access
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
