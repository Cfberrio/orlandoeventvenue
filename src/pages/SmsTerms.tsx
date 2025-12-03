import { useEffect } from "react";

const SmsTerms = () => {
  useEffect(() => {
    window.location.href = "/documents/sms-terms.pdf";
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <p className="text-muted-foreground">Redirecting to SMS Terms...</p>
    </div>
  );
};

export default SmsTerms;
