import Navigation from "@/components/Navigation";
import Hero from "@/components/Hero";
import SpaceHighlights from "@/components/SpaceHighlights";
import Pricing from "@/components/Pricing";
import Production from "@/components/Production";
import HowItWorks from "@/components/HowItWorks";
import FAQ from "@/components/FAQ";
import FinalCTA from "@/components/FinalCTA";
import Footer from "@/components/Footer";

const Index = () => {
  return (
    <div className="min-h-screen">
      <Navigation />
      <Hero />
      <SpaceHighlights />
      <Pricing />
      <Production />
      <HowItWorks />
      <FAQ />
      <FinalCTA />
      <Footer />
    </div>
  );
};

export default Index;
