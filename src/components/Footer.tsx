import { MapPin, Phone } from "lucide-react";
import { Link } from "react-router-dom";
import oevLogoFull from "@/assets/oev-logo-full.png";
const Footer = () => {
  return <footer className="bg-black text-white py-12">
      <div className="container mx-auto px-4">
        <div className="max-w-6xl mx-auto">
          <div className="grid md:grid-cols-3 gap-8 mb-8">
            <div>
              <img src={oevLogoFull} alt="Orlando Event Venue" className="h-20 mb-4" />
              <p className="text-sm opacity-90">
                Modern venue for corporate events, celebrations, and presentations.
              </p>
            </div>

            <div>
              <h3 className="font-bold mb-4">Location</h3>
              <div className="flex items-start gap-2 text-sm opacity-90">
                <MapPin className="w-4 h-4 mt-1 flex-shrink-0" />
                <span>3847 E Colonial Dr<br />Orlando, FL 32803</span>
              </div>
            </div>

            <div>
              <h3 className="font-bold mb-4">Contact</h3>
              <div className="flex items-center gap-2 text-sm opacity-90 mb-4">
                <Phone className="w-4 h-4 flex-shrink-0" />
                <span>(407) 276-3234
              </span>
              </div>
              <div className="text-sm opacity-90">
                <p className="font-semibold mb-2">Alcohol Policy</p>
                <p>No hard liquor allowed</p>
              </div>
            </div>
          </div>

          <div className="border-t border-white/20 pt-8 text-center text-sm opacity-75 space-y-2">
            <div className="flex items-center justify-center gap-4">
              <Link to="/privacy-policy" className="hover:underline hover:opacity-100 transition-opacity">
                Privacy Policy
              </Link>
              <span>|</span>
              <Link to="/terms-of-use" className="hover:underline hover:opacity-100 transition-opacity">
                Terms of Use
              </Link>
            </div>
            <p>Copyright © 2026 Orlando Event Venue. All rights reserved.</p>
          </div>
        </div>
      </div>
    </footer>;
};
export default Footer;