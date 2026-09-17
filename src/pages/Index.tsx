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
/* Every section below the hero sits on one of two venue photos, alternating
 * A/B/A/B down the page (ClickUp 86e3ac6kr). The hero is photo A, so the first
 * band is B; each band fades to white at both ends so the photos hand off to
 * each other without a seam. */
import PhotoBand from "@/components/PhotoBand";

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
      <PhotoBand photo="b" className="photo-band-included" position="center 85%">
        <PromoBand />
      </PhotoBand>
      <PhotoBand photo="a">
        <WhyCards />
      </PhotoBand>
      <PhotoBand photo="b">
        <PricingSection />
      </PhotoBand>
      <PhotoBand photo="a">
        <AddonsSection />
      </PhotoBand>
      <PhotoBand photo="b">
        <GalleryTours />
      </PhotoBand>
      <PhotoBand photo="a">
        <HowItWorksSection />
      </PhotoBand>
      <PhotoBand photo="b">
        <FaqSection />
      </PhotoBand>
      <PhotoBand photo="a">
        <FinalBand />
      </PhotoBand>
      <PhotoBand photo="b">
        <ContactForm />
      </PhotoBand>
      <OevFooter />
      <MobileBar />
    </div>
  );
};

export default Index;
