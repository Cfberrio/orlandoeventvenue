import Navigation from "@/components/Navigation";
import Footer from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";

const PDF_PATH = "/documents/privacy-policy.pdf";

const PrivacyPolicy = () => {
  return (
    <div className="min-h-screen flex flex-col">
      <Navigation />

      <main className="flex-1 bg-muted/30">
        <div className="container mx-auto px-4 py-12">
          <div className="max-w-4xl mx-auto space-y-6">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <h1 className="text-3xl font-bold">Privacy Policy</h1>
              <Button asChild variant="outline" size="sm">
                <a href={PDF_PATH} download="Orlando-Event-Venue-Privacy-Policy.pdf">
                  <Download className="h-4 w-4 mr-2" />
                  Download PDF
                </a>
              </Button>
            </div>

            <div className="rounded-lg border bg-background shadow-sm overflow-hidden">
              <iframe
                src={PDF_PATH}
                title="Privacy Policy"
                className="w-full"
                style={{ height: "80vh" }}
              />
            </div>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
};

export default PrivacyPolicy;
