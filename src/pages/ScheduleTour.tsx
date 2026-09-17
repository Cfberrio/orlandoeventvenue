import { useEffect } from "react";
import Navigation from "@/components/Navigation";
import Footer from "@/components/Footer";
import { PhotoBackdrop } from "@/components/PhotoBand";
import { trackTourPageViewed } from "@/lib/tracking/funnel";

const IFRAME_SRC = "https://api.leadconnectorhq.com/widget/bookings/oev-tour";
const EMBED_SCRIPT_SRC = "https://link.msgsndr.com/js/form_embed.js";

const ScheduleTour = () => {
  // Named milestone on top of the generic page_viewed: booking a tour is a
  // distinct intent signal and deserves its own row in the funnel. The GHL
  // iframe owns the submission itself, so this is the last thing we can see.
  useEffect(() => {
    trackTourPageViewed();
  }, []);

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

  /* photo-page on the outermost wrapper: a fixed backdrop inside <main> would
   * paint over the footer's black background (positioned box vs. in-flow
   * sibling), so the stacking context has to contain the footer too. */
  return (
    <div className="min-h-screen flex flex-col photo-page">
      <PhotoBackdrop photo="b" variant="page" />
      <Navigation />

      <main className="flex-1 relative overflow-hidden">

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
                style={{ height: "80vh", border: "none", overflow: "hidden" }}
                scrolling="no"
                id="oev-tour"
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
