import { useEffect } from "react";
import Navigation from "@/components/Navigation";
import Footer from "@/components/Footer";
import heroBg from "@/assets/hero-bg-new.jpg";

const IFRAME_SRC = "https://api.leadconnectorhq.com/widget/booking/nKkpf3RwImy548hvYGr7";
const EMBED_SCRIPT_SRC = "https://link.msgsndr.com/js/form_embed.js";

const ScheduleTour = () => {
  useEffect(() => {
    const existingScript = document.querySelector(`script[src="${EMBED_SCRIPT_SRC}"]`);
    if (existingScript) return;

    const script = document.createElement("script");
    script.src = EMBED_SCRIPT_SRC;
    script.type = "text/javascript";
    script.async = true;
    document.body.appendChild(script);

    return () => {
      script.remove();
    };
  }, []);

  return (
    <div className="min-h-screen flex flex-col">
      <Navigation />

      <main className="flex-1 relative overflow-hidden">
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: `url(${heroBg})` }}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-background/80 via-background/70 to-background/60" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,hsl(var(--primary)/0.15),transparent_50%)]" />
        <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-b from-transparent to-background" />

        <div className="container mx-auto px-4 py-12 relative z-10">
          <div className="max-w-4xl mx-auto space-y-6">
            <h1 className="text-3xl font-bold text-center">Schedule Your Tour</h1>
            <p className="text-center text-muted-foreground text-lg">
              Pick a date and time that works best for you. We look forward to showing you around!
            </p>

            <div className="rounded-lg border bg-background shadow-sm overflow-hidden">
              <iframe
                src={IFRAME_SRC}
                title="Schedule a Tour"
                className="w-full"
                style={{ height: "80vh", border: "none" }}
                scrolling="no"
                id="nKkpf3RwImy548hvYGr7_1771551481209"
              />
            </div>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
};

export default ScheduleTour;
