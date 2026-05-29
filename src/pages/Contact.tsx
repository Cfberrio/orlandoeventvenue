import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import contactBg1 from "@/assets/contact-bg-1.jpg";
import contactBg2 from "@/assets/contact-bg-2.jpg";
import contactBg3 from "@/assets/contact-bg-3.jpg";

const Contact = () => {
  const navigate = useNavigate();

  useEffect(() => {
    navigate("/", { replace: true });

    const scrollToContact = () => {
      const contactSection = document.getElementById("contact");
      if (contactSection) {
        contactSection.scrollIntoView({ behavior: "smooth" });
        return true;
      }
      return false;
    };

    if (!scrollToContact()) {
      const observer = new MutationObserver(() => {
        if (scrollToContact()) {
          observer.disconnect();
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });

      const OBSERVER_TIMEOUT_MS = 3000;
      setTimeout(() => observer.disconnect(), OBSERVER_TIMEOUT_MS);
    }
  }, [navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden">
      {/* Background images side by side */}
      <div className="absolute inset-0 flex">
        <div
          className="flex-1 bg-cover bg-center"
          style={{ backgroundImage: `url(${contactBg1})` }}
        />
        <div
          className="flex-1 bg-cover bg-center"
          style={{ backgroundImage: `url(${contactBg2})` }}
        />
        <div
          className="flex-1 bg-cover bg-center"
          style={{ backgroundImage: `url(${contactBg3})` }}
        />
      </div>

      {/* Blur + fade overlay */}
      <div className="absolute inset-0 backdrop-blur-sm" />
      <div className="absolute inset-0 bg-gradient-to-b from-background/80 via-background/70 to-background/60" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,hsl(var(--primary)/0.15),transparent_50%)]" />

      {/* Content */}
      <div className="text-center relative z-10">
        <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-4" />
        <p className="text-muted-foreground">Redirecting to contact form...</p>
      </div>
    </div>
  );
};

export default Contact;
