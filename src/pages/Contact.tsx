import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";

const Contact = () => {
  const navigate = useNavigate();

  useEffect(() => {
    // Redirect to home page with #contact anchor
    navigate("/#contact", { replace: true });
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
