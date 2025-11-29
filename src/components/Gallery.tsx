import { Card } from "@/components/ui/card";
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
    <section id="gallery" className="py-16 md:py-24 bg-gradient-to-b from-background to-accent">
      <div className="container mx-auto px-4">
        <div className="max-w-7xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold text-center mb-4 text-foreground animate-fade-in">
            Gallery
          </h2>
          <p className="text-center text-muted mb-12 max-w-2xl mx-auto animate-fade-in">
            Take a look at our modern venue space
          </p>

          <Carousel
            opts={{
              align: "start",
              loop: true,
            }}
            className="w-full animate-fade-in"
          >
            <CarouselContent className="-ml-2 md:-ml-4">
              {images.map((image, index) => (
                <CarouselItem key={index} className="pl-2 md:pl-4 md:basis-1/2 lg:basis-1/3">
                  <Card className="overflow-hidden border-border hover:shadow-2xl transition-all duration-500 hover:-translate-y-2 group">
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
    </section>
  );
};

export default Gallery;
