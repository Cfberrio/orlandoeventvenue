import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";

const PricingPage = () => {
  const navigate = useNavigate();

  useEffect(() => {
    navigate("/", { replace: true });

    const scrollToSection = () => {
      const section = document.getElementById("pricing");
      if (section) {
        const nav = document.querySelector("nav");
        const navHeight = nav ? nav.getBoundingClientRect().height : 80;
        const pos = section.getBoundingClientRect().top + window.scrollY;
        window.scrollTo({ top: pos - navHeight - 8, behavior: "smooth" });
        return true;
      }
      return false;
    };

    if (!scrollToSection()) {
      const observer = new MutationObserver(() => {
        if (scrollToSection()) observer.disconnect();
      });
      observer.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => observer.disconnect(), 3000);
    }
  }, [navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-4" />
        <p className="text-muted-foreground">Redirecting to pricing...</p>
      </div>
    </div>
  );
};

export default PricingPage;
