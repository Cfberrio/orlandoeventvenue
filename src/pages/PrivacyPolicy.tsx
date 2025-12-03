import { useEffect } from "react";

const PrivacyPolicy = () => {
  useEffect(() => {
    window.location.href = "/documents/privacy-policy.pdf";
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <p className="text-muted-foreground">Redirecting to Privacy Policy...</p>
    </div>
  );
};

export default PrivacyPolicy;
