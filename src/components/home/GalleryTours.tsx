import { useState } from "react";
import { Link } from "react-router-dom";
import { Rotate3d } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel";
import Autoplay from "embla-carousel-autoplay";
import gallery1 from "@/assets/gallery-1.png";
import gallery2 from "@/assets/gallery-2.png";
import gallery3 from "@/assets/gallery-3.png";
import gallery4 from "@/assets/gallery-4.png";
import gallery5 from "@/assets/gallery-5.png";
import gallery6 from "@/assets/gallery-6.png";
import gallery7 from "@/assets/gallery-7.png";
import gallery8 from "@/assets/gallery-8.png";
import gallery9 from "@/assets/gallery-9.png";
import galleryConferences from "@/assets/gallery-conferences.jpg";
import galleryEvents from "@/assets/gallery-events.jpg";
import tourPhoto from "@/assets/schedule-tour-bg.jpg";

const IMAGES = [
  { url: gallery1, title: "Welcome Area" },
  { url: gallery2, title: "Main Entrance" },
  { url: gallery3, title: "Presentation Setup" },
  { url: gallery4, title: "Event Space" },
  { url: gallery5, title: "Storage Area" },
  { url: gallery6, title: "Restroom Facilities" },
  { url: gallery7, title: "Event Setup" },
  { url: gallery8, title: "Venue Exterior" },
  { url: gallery9, title: "Prep Kitchen" },
  { url: galleryConferences, title: "Conference" },
  { url: galleryEvents, title: "Events" },
];

const GalleryTours = () => {
  const [selected, setSelected] = useState<{ url: string; title: string } | null>(null);

  return (
    <>
      <section className="band-soft" id="gallery">
        <div className="wrap">
          <div className="shead">
            <h2 data-rv>Take a look around.</h2>
            <p className="lead" data-rv>
              A modern, flexible space that adapts to your event.
            </p>
          </div>

          <div data-rv>
            <Carousel
              opts={{ align: "start", loop: true }}
              plugins={[Autoplay({ delay: 4000 })]}
              className="gal"
            >
              <CarouselContent>
                {IMAGES.map((image) => (
                  <CarouselItem key={image.title} className="gal-item">
                    <button
                      type="button"
                      className="gcard"
                      onClick={() => setSelected(image)}
                      aria-label={`Open ${image.title}`}
                    >
                      <img src={image.url} alt={image.title} loading="lazy" />
                      <span className="gcap">{image.title}</span>
                    </button>
                  </CarouselItem>
                ))}
              </CarouselContent>
              <CarouselPrevious className="gal-arrow gal-prev" />
              <CarouselNext className="gal-arrow gal-next" />
            </Carousel>
          </div>
        </div>
      </section>

      <section id="tour" style={{ paddingTop: 40 }}>
        <div className="wrap">
          <div className="hcard" data-rv>
            <div className="h-bubble" aria-hidden data-float>
              See it
              <br />
              in person
            </div>
            <div className="h-img" data-parallax>
              <img src={tourPhoto} alt="The venue ready for a walkthrough tour" loading="lazy" />
            </div>
            <div className="h-copy">
              <h2>Walk the space before you book.</h2>
              <p>
                Explore the venue in 3D right now, or schedule a free in-person tour and see how we
                can bring your event to life.
              </p>
              <div className="h-cta-row">
                <Link to="/schedule-tour" className="btn btn-primary">
                  Schedule a Tour
                </Link>
                <Link to="/tour" className="btn btn-ghost">
                  <Rotate3d size={18} aria-hidden /> 3D Virtual Tour
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      <Dialog open={!!selected} onOpenChange={() => setSelected(null)}>
        <DialogContent className="oev max-w-7xl w-[95vw] h-[90vh] p-0 overflow-hidden">
          {selected && (
            <div className="lightbox">
              <DialogTitle className="sr-only">{selected.title}</DialogTitle>
              <img src={selected.url} alt={selected.title} />
              <p>{selected.title}</p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
};

export default GalleryTours;
