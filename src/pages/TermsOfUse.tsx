import { useEffect } from "react";

const TermsOfUse = () => {
  useEffect(() => {
    window.location.href = "/documents/terms-of-use.pdf";
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <p className="text-muted-foreground">Redirecting to Terms of Use...</p>
    </div>
  );
};

export default TermsOfUse;


