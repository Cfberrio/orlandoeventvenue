import { MapPin, Phone } from "lucide-react";
import { Link } from "react-router-dom";
import oevLogoFull from "@/assets/oev-logo-full.png";

const OevFooter = () => (
  <footer className="oev-footer">
    <div className="wrap">
      <div className="f-grid">
        <div>
          <img src={oevLogoFull} alt="Orlando Event Venue" />
          <p>Modern venue for corporate events, celebrations, and presentations.</p>
        </div>
        <div>
          <h3>Location</h3>
          <p className="f-line">
            <MapPin size={16} aria-hidden />
            <span>
              3847 E Colonial Dr
              <br />
              Orlando, FL 32803
            </span>
          </p>
        </div>
        <div>
          <h3>Contact</h3>
          <p className="f-line">
            <Phone size={16} aria-hidden />
            <span>407-974-5979</span>
          </p>
          <p className="f-note">
            <strong>Bar Service</strong>
            <br />
            Available as a paid add-on. No outside alcohol or outside bartenders permitted.
          </p>
        </div>
      </div>
      <div className="f-legal">
        <p>
          <Link to="/privacy-policy">Privacy Policy</Link>
          <span> | </span>
          <Link to="/terms-of-use">Terms of Use</Link>
        </p>
        <p>Copyright © 2026 Orlando Event Venue. All rights reserved.</p>
      </div>
    </div>
  </footer>
);

export default OevFooter;
