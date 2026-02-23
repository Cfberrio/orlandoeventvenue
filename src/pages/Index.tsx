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
import ScheduleTourCTA from "@/components/ScheduleTourCTA";
import Footer from "@/components/Footer";
import DiscountPopup from "@/components/DiscountPopup";
const Index = () => {
  return (
    <div className="min-h-screen">
      <DiscountPopup />
      <Navigation />
      <Hero />
      <SpaceHighlights />
      <Pricing />
      <Gallery />
      <ScheduleTourCTA />
      <HowItWorks />
      <Production />
      <FAQ />
      <FinalCTA />
      <ContactForm />
      <Footer />
    </div>
  );
};

export default Index;
