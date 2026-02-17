import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";

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
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-4" />
        <p className="text-muted-foreground">Redirecting to contact form...</p>
      </div>
    </div>
  );
};

export default Contact;
