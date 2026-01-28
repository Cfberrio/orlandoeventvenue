import Navigation from "@/components/Navigation";
import Hero from "@/components/Hero";
import SpaceHighlights from "@/components/SpaceHighlights";
import Gallery from "@/components/Gallery";
import Pricing from "@/components/Pricing";
import Production from "@/components/Production";
import HowItWorks from "@/components/HowItWorks";
import FAQ from "@/components/FAQ";
import FinalCTA from "@/components/FinalCTA";
import ContactForm from "@/components/ContactForm";
import Footer from "@/components/Footer";
import { useEffect } from "react";

const Index = () => {
  useEffect(() => {
    const script = document.createElement('script');
    script.src = 'https://link.msgsndr.com/js/form_embed.js';
    script.async = true;
    document.body.appendChild(script);

    return () => {
      document.body.removeChild(script);
    };
  }, []);

  return (
    <div className="min-h-screen">
      <Navigation />
      <Hero />
      <SpaceHighlights />
      <Gallery />
      <Pricing />
      <Production />
      <HowItWorks />
      <FAQ />
      <FinalCTA />
      <ContactForm />
      
      <section className="py-12 bg-background">
        <div className="container mx-auto px-4">
          <div className="max-w-4xl mx-auto">
            <iframe
              src="https://api.leadconnectorhq.com/widget/form/3xxV974KCddZUdCeh8BT"
              style={{ width: '100%', height: '100%', border: 'none', borderRadius: '3px' }}
              id="inline-3xxV974KCddZUdCeh8BT"
              data-layout="{'id':'INLINE'}"
              data-trigger-type="alwaysShow"
              data-trigger-value=""
              data-activation-type="alwaysActivated"
              data-activation-value=""
              data-deactivation-type="neverDeactivate"
              data-deactivation-value=""
              data-form-name="Form 0"
              data-height="769"
              data-layout-iframe-id="inline-3xxV974KCddZUdCeh8BT"
              data-form-id="3xxV974KCddZUdCeh8BT"
              title="Form 0"
            />
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
};

export default Index;
