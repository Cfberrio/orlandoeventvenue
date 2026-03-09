import { useState, useCallback } from "react";
import { Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import oevLogoIcon from "@/assets/oev-logo-icon.png";

const NAV_ITEMS = [
  { id: "pricing", label: "Pricing" },
  { id: "gallery", label: "Gallery" },
  { id: "tour", label: "Tour" },
  { id: "how-it-works", label: "How It Works" },
  { id: "production", label: "Production" },
  { id: "faq", label: "FAQ" },
  { id: "contact", label: "Contact" },
];

const Navigation = () => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const goToHome = () => {
    window.location.href = "/";
  };

  const scrollToElement = useCallback((id: string) => {
    const element = document.getElementById(id);
    if (element) {
      // Get the sticky nav height to offset the scroll
      const nav = document.querySelector("nav");
      const navHeight = nav ? nav.getBoundingClientRect().height : 80;
      const elementPosition = element.getBoundingClientRect().top + window.scrollY;
      window.scrollTo({
        top: elementPosition - navHeight - 8,
        behavior: "smooth",
      });
    }
  }, []);

  const scrollToSection = useCallback((id: string) => {
    if (id === "book-now") {
      window.location.href = "/book";
      return;
    }

    // If on the home page, scroll directly
    if (window.location.pathname === "/") {
      // Close menu first, then scroll after a brief delay to let layout settle
      setIsMenuOpen(false);
      requestAnimationFrame(() => {
        setTimeout(() => scrollToElement(id), 50);
      });
    } else {
      window.location.href = `/#${id}`;
    }
  }, [scrollToElement]);

  return (
    <nav className="sticky top-0 z-50 bg-card/95 backdrop-blur-sm border-b border-border shadow-sm transition-all duration-300">
      <div className="container mx-auto px-4">
        <div className="flex items-center justify-between h-16 sm:h-20">
          <div className="flex items-center gap-2 sm:gap-3 cursor-pointer min-w-0" onClick={goToHome}>
            <img
              src={oevLogoIcon}
              alt="OEV"
              className="h-10 sm:h-16 w-auto flex-shrink-0 transition-transform duration-300 hover:scale-110"
            />
            <span className="font-bold text-base sm:text-xl text-foreground transition-colors duration-300 hover:text-primary truncate">
              Orlando Event Venue
            </span>
          </div>

          {/* Desktop Navigation */}
          <div className="hidden lg:flex items-center gap-4 xl:gap-6">
            {NAV_ITEMS.map((item) => (
              <button
                key={item.id}
                onClick={() => scrollToSection(item.id)}
                className="text-muted hover:text-foreground transition-all duration-300 hover:scale-105 relative after:absolute after:bottom-0 after:left-0 after:h-0.5 after:w-0 after:bg-primary after:transition-all after:duration-300 hover:after:w-full whitespace-nowrap text-sm xl:text-base"
              >
                {item.label}
              </button>
            ))}
            <Button
              onClick={() => scrollToSection("book-now")}
              className="hover:scale-105 transition-all duration-300"
            >
              Book Now
            </Button>
          </div>

          {/* Mobile Menu Button */}
          <button
            className="lg:hidden text-foreground p-2 -mr-2"
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            aria-label={isMenuOpen ? "Close menu" : "Open menu"}
          >
            {isMenuOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
        </div>

        {/* Mobile Navigation */}
        {isMenuOpen && (
          <div className="lg:hidden py-4 border-t border-border animate-fade-in">
            <div className="flex flex-col gap-1">
              {NAV_ITEMS.map((item) => (
                <button
                  key={item.id}
                  onClick={() => scrollToSection(item.id)}
                  className="text-left text-muted hover:text-foreground hover:bg-accent/50 transition-all duration-300 py-3 px-3 rounded-md text-base"
                >
                  {item.label}
                </button>
              ))}
              <Button
                onClick={() => scrollToSection("book-now")}
                className="w-full mt-2 hover:scale-[1.02] transition-all duration-300"
              >
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
