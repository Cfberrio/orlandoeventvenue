import { useState, useEffect, useRef } from "react";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel";
import gallery1 from "@/assets/gallery-1.jpg";
import gallery2 from "@/assets/gallery-2.jpg";
import gallery3 from "@/assets/gallery-3.jpg";
import gallery4 from "@/assets/gallery-4.jpg";
import gallery5 from "@/assets/gallery-5.jpg";
import gallery6 from "@/assets/gallery-6.jpg";

const Gallery = () => {
  const [selectedImage, setSelectedImage] = useState<{ url: string; title: string } | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const sectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setIsVisible(true);
          }
        });
      },
      { threshold: 0.1 }
    );

    if (sectionRef.current) {
      observer.observe(sectionRef.current);
    }

    return () => observer.disconnect();
  }, []);

  const images = [
    {
      url: gallery1,
      title: "Welcome Area",
    },
    {
      url: gallery2,
      title: "Main Entrance",
    },
    {
      url: gallery3,
      title: "Presentation Setup",
    },
    {
      url: gallery4,
      title: "Event Space",
    },
    {
      url: gallery5,
      title: "Storage Area",
    },
    {
      url: gallery6,
      title: "Restroom Facilities",
    },
  ];

  return (
    <>
      <section 
        ref={sectionRef}
        id="gallery" 
        className="py-16 md:py-24 bg-gradient-to-b from-background to-accent overflow-hidden"
      >
        <div className="container mx-auto px-4">
          <div className="max-w-7xl mx-auto">
            <h2 className={`text-3xl md:text-4xl font-bold text-center mb-4 text-foreground transition-all duration-1000 ${
              isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-10'
            }`}>
              Gallery
            </h2>
            <p className={`text-center text-muted mb-12 max-w-2xl mx-auto transition-all duration-1000 delay-150 ${
              isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-10'
            }`}>
              Take a look at our modern venue space
            </p>

            <div className={`transition-all duration-1000 delay-300 ${
              isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-10'
            }`}>
              <Carousel
                opts={{
                  align: "start",
                  loop: true,
                }}
                className="w-full"
              >
                <CarouselContent className="-ml-2 md:-ml-4">
                  {images.map((image, index) => (
                    <CarouselItem key={index} className="pl-2 md:pl-4 md:basis-1/2 lg:basis-1/3">
                      <Card 
                        className="overflow-hidden border-border hover:shadow-2xl transition-all duration-500 hover:-translate-y-2 group cursor-pointer"
                        onClick={() => setSelectedImage(image)}
                      >
                        <div className="relative h-80 md:h-96 overflow-hidden">
                          <img
                            src={image.url}
                            alt={image.title}
                            className="w-full h-full object-cover transition-all duration-700 group-hover:scale-110"
                          />
                          <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500">
                            <div className="absolute bottom-4 left-4 right-4">
                              <h3 className="text-white font-semibold text-lg">{image.title}</h3>
                            </div>
                          </div>
                        </div>
                      </Card>
                    </CarouselItem>
                  ))}
                </CarouselContent>
                <CarouselPrevious className="-left-4 md:-left-12 hover:scale-110 transition-transform duration-300 bg-background/80 backdrop-blur-sm" />
                <CarouselNext className="-right-4 md:-right-12 hover:scale-110 transition-transform duration-300 bg-background/80 backdrop-blur-sm" />
              </Carousel>
            </div>
          </div>
        </div>
      </section>

      <Dialog open={!!selectedImage} onOpenChange={() => setSelectedImage(null)}>
        <DialogContent className="max-w-7xl w-[95vw] h-[90vh] p-0 overflow-hidden">
          {selectedImage && (
            <div className="relative w-full h-full flex items-center justify-center bg-background/95">
              <img
                src={selectedImage.url}
                alt={selectedImage.title}
                className="max-w-full max-h-full object-contain"
              />
              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-6">
                <h3 className="text-white font-semibold text-2xl text-center">{selectedImage.title}</h3>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
};

export default Gallery;
