import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";
import oevLogoIcon from "@/assets/oev-logo-icon.png";

const NAV_ITEMS = [
  { href: "#pricing", label: "Pricing" },
  { href: "#add-ons", label: "Add-ons" },
  { href: "#gallery", label: "Gallery" },
  { href: "#tour", label: "Tour" },
  { href: "#how-it-works", label: "How It Works" },
  { href: "#faq", label: "FAQ" },
  { href: "#contact", label: "Contact" },
];

const OevNav = () => {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <nav className={`oev-nav${scrolled ? " scrolled" : ""}`}>
      <div className="wrap oev-nav-in">
        <a href="#top" className="brand" aria-label="Orlando Event Venue — top">
          <img src={oevLogoIcon} alt="" />
          <span>Orlando Event Venue</span>
        </a>

        <div className="nav-links" aria-label="Section navigation">
          {NAV_ITEMS.map((item) => (
            <a key={item.href} href={item.href} onClick={() => setOpen(false)}>
              {item.label}
            </a>
          ))}
          <a className="btn btn-primary btn-nav" href="/book">
            Book Now
          </a>
        </div>

        <button
          className="nav-burger"
          onClick={() => setOpen(!open)}
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
        >
          {open ? <X size={24} /> : <Menu size={24} />}
        </button>
      </div>

      {open && (
        <div className="nav-mobile">
          {NAV_ITEMS.map((item) => (
            <a key={item.href} href={item.href} onClick={() => setOpen(false)}>
              {item.label}
            </a>
          ))}
          <a className="btn btn-primary" href="/book" onClick={() => setOpen(false)}>
            Book Now
          </a>
        </div>
      )}
    </nav>
  );
};

export default OevNav;
