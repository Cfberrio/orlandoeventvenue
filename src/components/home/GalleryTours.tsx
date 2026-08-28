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
import gallery5 from "@/assets/gallery-5.png";
import gallery6 from "@/assets/gallery-6.png";
import gallery8 from "@/assets/gallery-8.png";
import gallery9 from "@/assets/gallery-9.png";
import galleryConferences from "@/assets/gallery-conferences.jpg";
import galleryEvents from "@/assets/gallery-events.jpg";
import tourPhoto from "@/assets/schedule-tour-bg.jpg";
import welcomeDetail from "@/assets/venue/welcome-detail-portrait.webp";
import welcomeDetail2x from "@/assets/venue/welcome-detail-portrait-2x.webp";
import mainEntrance from "@/assets/venue/main-entrance-2048.webp";
import mainEntrance2x from "@/assets/venue/main-entrance-4096.webp";
import eventStage01 from "@/assets/venue/event-stage-01-2048.webp";
import eventStage01_2x from "@/assets/venue/event-stage-01-4096.webp";
import eventStage02 from "@/assets/venue/event-stage-02-2048.webp";
import eventStage02_2x from "@/assets/venue/event-stage-02-4096.webp";
import eventAcoustic01 from "@/assets/venue/event-acoustic-01-2048.webp";
import eventAcoustic01_2x from "@/assets/venue/event-acoustic-01-4096.webp";
import eventBackWall from "@/assets/venue/event-back-wall-2048.webp";
import eventBackWall2x from "@/assets/venue/event-back-wall-4096.webp";

/* Renovated areas first, then the rooms the renovation did not touch, then the
 * event photography. `full` feeds the lightbox and wide screens; `position`
 * tunes the fixed-height card crop so the subject survives object-fit: cover
 * instead of us cropping the photograph itself. */
const IMAGES: {
  url: string;
  full: string;
  title: string;
  position?: string;
}[] = [
  { url: welcomeDetail, full: welcomeDetail2x, title: "Welcome Area", position: "center 32%" },
  { url: mainEntrance, full: mainEntrance2x, title: "Main Entrance" },
  { url: eventStage01, full: eventStage01_2x, title: "Presentation Setup" },
  { url: eventStage02, full: eventStage02_2x, title: "Event Space" },
  { url: eventAcoustic01, full: eventAcoustic01_2x, title: "Acoustic Wall" },
  { url: eventBackWall, full: eventBackWall2x, title: "Open Floor" },
  { url: gallery9, full: gallery9, title: "Prep Kitchen" },
  { url: gallery6, full: gallery6, title: "Restroom Facilities" },
  { url: gallery5, full: gallery5, title: "Storage Area" },
  { url: gallery8, full: gallery8, title: "Venue Exterior" },
  { url: galleryConferences, full: galleryConferences, title: "Conference" },
  { url: galleryEvents, full: galleryEvents, title: "Events" },
];

const GalleryTours = () => {
  const [selected, setSelected] = useState<(typeof IMAGES)[number] | null>(null);

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
                      <img
                        src={image.url}
                        srcSet={
                          image.full === image.url
                            ? undefined
                            : `${image.url} 2048w, ${image.full} 4096w`
                        }
                        sizes="(max-width: 960px) 78vw, 33vw"
                        style={image.position ? { objectPosition: image.position } : undefined}
                        alt={`${image.title} at Orlando Event Venue`}
                        loading="lazy"
                      />
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
              <img src={selected.full} alt={`${selected.title} at Orlando Event Venue`} />
              <p>{selected.title}</p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
};

export default GalleryTours;
