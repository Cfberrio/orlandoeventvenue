import { useState } from "react";
import { Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import oevLogoIcon from "@/assets/oev-logo-icon.png";

const Navigation = () => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const scrollToSection = (id: string) => {
    const element = document.getElementById(id);
    if (element) {
      element.scrollIntoView({ behavior: "smooth" });
      setIsMenuOpen(false);
    }
  };

  return (
    <nav className="sticky top-0 z-50 bg-card/95 backdrop-blur-sm border-b border-border shadow-sm">
      <div className="container mx-auto px-4">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center gap-3">
            <img src={oevLogoIcon} alt="OEV" className="h-10 w-auto" />
            <span className="font-bold text-xl text-foreground">OEV</span>
          </div>

          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center gap-6">
            <button
              onClick={() => scrollToSection("pricing")}
              className="text-muted hover:text-foreground transition-colors"
            >
              Pricing
            </button>
            <button
              onClick={() => scrollToSection("production")}
              className="text-muted hover:text-foreground transition-colors"
            >
              Production
            </button>
            <button
              onClick={() => scrollToSection("how-it-works")}
              className="text-muted hover:text-foreground transition-colors"
            >
              How It Works
            </button>
            <button
              onClick={() => scrollToSection("faq")}
              className="text-muted hover:text-foreground transition-colors"
            >
              FAQ
            </button>
            <Button onClick={() => scrollToSection("book-now")}>
              Book Now
            </Button>
          </div>

          {/* Mobile Menu Button */}
          <button
            className="md:hidden text-foreground"
            onClick={() => setIsMenuOpen(!isMenuOpen)}
          >
            {isMenuOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
        </div>

        {/* Mobile Navigation */}
        {isMenuOpen && (
          <div className="md:hidden py-4 border-t border-border">
            <div className="flex flex-col gap-4">
              <button
                onClick={() => scrollToSection("pricing")}
                className="text-left text-muted hover:text-foreground transition-colors py-2"
              >
                Pricing
              </button>
              <button
                onClick={() => scrollToSection("production")}
                className="text-left text-muted hover:text-foreground transition-colors py-2"
              >
                Production
              </button>
              <button
                onClick={() => scrollToSection("how-it-works")}
                className="text-left text-muted hover:text-foreground transition-colors py-2"
              >
                How It Works
              </button>
              <button
                onClick={() => scrollToSection("faq")}
                className="text-left text-muted hover:text-foreground transition-colors py-2"
              >
                FAQ
              </button>
              <Button onClick={() => scrollToSection("book-now")} className="w-full">
                Book Now
              </Button>
            </div>
          </div>
        )}
      </div>
    </nav>
  );
};

export default Navigation;
