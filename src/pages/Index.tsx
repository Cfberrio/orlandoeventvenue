import { useEffect } from "react";
import "@/oev-marketing.css";
import { useMarketingMotion } from "@/lib/marketingMotion";
import OevNav from "@/components/home/OevNav";
import OevHero from "@/components/home/OevHero";
import PromoBand from "@/components/home/PromoBand";
import WhyCards from "@/components/home/WhyCards";
import PricingSection from "@/components/home/PricingSection";
import AddonsSection from "@/components/home/AddonsSection";
import GalleryTours from "@/components/home/GalleryTours";
import HowItWorksSection from "@/components/home/HowItWorksSection";
import FaqSection from "@/components/home/FaqSection";
import FinalBand from "@/components/home/FinalBand";
import OevFooter from "@/components/home/OevFooter";
import MobileBar from "@/components/home/MobileBar";
import ContactForm from "@/components/ContactForm";
import DiscountPopup from "@/components/DiscountPopup";

const Index = () => {
  const scope = useMarketingMotion<HTMLDivElement>();

  /* Deep links from redirects (/#pricing etc.): scroll once layout settles. */
  useEffect(() => {
    const hash = window.location.hash.replace("#", "");
    if (!hash) return;
    const t = setTimeout(() => {
      document.getElementById(hash)?.scrollIntoView({ behavior: "smooth" });
    }, 100);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="oev" ref={scope}>
      <DiscountPopup />
      <OevNav />
      <OevHero />
      <PromoBand />
      <WhyCards />
      <PricingSection />
      <AddonsSection />
      <GalleryTours />
      <HowItWorksSection />
      <FaqSection />
      <FinalBand />
      <ContactForm />
      <OevFooter />
      <MobileBar />
    </div>
  );
};

export default Index;
