import { useState } from "react";
import { Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import oevLogoIcon from "@/assets/oev-logo-icon.png";

const Navigation = () => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const goToHome = () => {
    window.location.href = "/";
  };

  const scrollToSection = (id: string) => {
    if (id === "book-now") {
      window.location.href = "/book";
      return;
    }
    const element = document.getElementById(id);
    if (element) {
      element.scrollIntoView({ behavior: "smooth" });
      setIsMenuOpen(false);
    }
  };

  return (
    <nav className="sticky top-0 z-50 bg-card/95 backdrop-blur-sm border-b border-border shadow-sm transition-all duration-300">
      <div className="container mx-auto px-4">
        <div className="flex items-center justify-between h-20">
          <div className="flex items-center gap-3 cursor-pointer" onClick={goToHome}>
            <img src={oevLogoIcon} alt="OEV" className="h-16 w-auto transition-transform duration-300 hover:scale-110" />
            <span className="font-bold text-xl text-foreground transition-colors duration-300 hover:text-primary">Orlando Event Venue</span>
          </div>

          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center gap-6">
            <button
              onClick={() => scrollToSection("gallery")}
              className="text-muted hover:text-foreground transition-all duration-300 hover:scale-105 relative after:absolute after:bottom-0 after:left-0 after:h-0.5 after:w-0 after:bg-primary after:transition-all after:duration-300 hover:after:w-full"
            >
              Gallery
            </button>
            <button
              onClick={() => scrollToSection("pricing")}
              className="text-muted hover:text-foreground transition-all duration-300 hover:scale-105 relative after:absolute after:bottom-0 after:left-0 after:h-0.5 after:w-0 after:bg-primary after:transition-all after:duration-300 hover:after:w-full"
            >
              Pricing
            </button>
            <button
              onClick={() => scrollToSection("production")}
              className="text-muted hover:text-foreground transition-all duration-300 hover:scale-105 relative after:absolute after:bottom-0 after:left-0 after:h-0.5 after:w-0 after:bg-primary after:transition-all after:duration-300 hover:after:w-full"
            >
              Production
            </button>
            <button
              onClick={() => scrollToSection("how-it-works")}
              className="text-muted hover:text-foreground transition-all duration-300 hover:scale-105 relative after:absolute after:bottom-0 after:left-0 after:h-0.5 after:w-0 after:bg-primary after:transition-all after:duration-300 hover:after:w-full"
            >
              How It Works
            </button>
            <button
              onClick={() => scrollToSection("faq")}
              className="text-muted hover:text-foreground transition-all duration-300 hover:scale-105 relative after:absolute after:bottom-0 after:left-0 after:h-0.5 after:w-0 after:bg-primary after:transition-all after:duration-300 hover:after:w-full"
            >
              FAQ
            </button>
            <button
              onClick={() => window.location.href = "/contact"}
              className="text-muted hover:text-foreground transition-all duration-300 hover:scale-105 relative after:absolute after:bottom-0 after:left-0 after:h-0.5 after:w-0 after:bg-primary after:transition-all after:duration-300 hover:after:w-full"
            >
              Contact
            </button>
            <Button onClick={() => scrollToSection("book-now")} className="hover:scale-105 transition-all duration-300">
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
          <div className="md:hidden py-4 border-t border-border animate-fade-in">
            <div className="flex flex-col gap-4">
              <button
                onClick={() => scrollToSection("gallery")}
                className="text-left text-muted hover:text-foreground transition-colors py-2 hover:translate-x-2 transition-all duration-300"
              >
                Gallery
              </button>
              <button
                onClick={() => scrollToSection("pricing")}
                className="text-left text-muted hover:text-foreground transition-colors py-2 hover:translate-x-2 transition-all duration-300"
              >
                Pricing
              </button>
              <button
                onClick={() => scrollToSection("production")}
                className="text-left text-muted hover:text-foreground transition-colors py-2 hover:translate-x-2 transition-all duration-300"
              >
                Production
              </button>
              <button
                onClick={() => scrollToSection("how-it-works")}
                className="text-left text-muted hover:text-foreground transition-colors py-2 hover:translate-x-2 transition-all duration-300"
              >
                How It Works
              </button>
              <button
                onClick={() => scrollToSection("faq")}
                className="text-left text-muted hover:text-foreground transition-colors py-2 hover:translate-x-2 transition-all duration-300"
              >
                FAQ
              </button>
              <button
                onClick={() => window.location.href = "/contact"}
                className="text-left text-muted hover:text-foreground transition-colors py-2 hover:translate-x-2 transition-all duration-300"
              >
                Contact
              </button>
              <Button onClick={() => scrollToSection("book-now")} className="w-full hover:scale-105 transition-all duration-300">
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
