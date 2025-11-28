import { Card } from "@/components/ui/card";
import { useState } from "react";

const Gallery = () => {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const images = [
    {
      url: "https://images.unsplash.com/photo-1540575467063-178a50c2df87",
      title: "Main Event Space",
    },
    {
      url: "https://images.unsplash.com/photo-1511578314322-379afb476865",
      title: "Setup Configuration",
    },
    {
      url: "https://images.unsplash.com/photo-1519167758481-83f29da8c6c7",
      title: "Professional Events",
    },
    {
      url: "https://images.unsplash.com/photo-1464047736614-af63643285bf",
      title: "Presentation Setup",
    },
    {
      url: "https://images.unsplash.com/photo-1505236858219-8359eb29e329",
      title: "Corporate Meetings",
    },
    {
      url: "https://images.unsplash.com/photo-1478146896981-b80fe463b330",
      title: "Event Details",
    },
  ];

  return (
    <section id="gallery" className="py-16 md:py-24 bg-gradient-to-b from-background to-accent">
      <div className="container mx-auto px-4">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold text-center mb-4 text-foreground animate-fade-in">
            Gallery
          </h2>
          <p className="text-center text-muted mb-12 max-w-2xl mx-auto animate-fade-in">
            Take a look at our modern venue space
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 animate-fade-in">
            {images.map((image, index) => (
              <Card
                key={index}
                className="overflow-hidden border-border hover:shadow-2xl transition-all duration-500 hover:-translate-y-2 cursor-pointer group"
                onMouseEnter={() => setHoveredIndex(index)}
                onMouseLeave={() => setHoveredIndex(null)}
              >
                <div className="relative h-64 overflow-hidden">
                  <img
                    src={image.url}
                    alt={image.title}
                    className={`w-full h-full object-cover transition-all duration-700 ${
                      hoveredIndex === index ? "scale-110" : "scale-100"
                    }`}
                  />
                  <div
                    className={`absolute inset-0 bg-gradient-to-t from-black/70 to-transparent transition-opacity duration-500 ${
                      hoveredIndex === index ? "opacity-100" : "opacity-0"
                    }`}
                  >
                    <div className="absolute bottom-4 left-4 right-4">
                      <h3 className="text-white font-semibold text-lg">{image.title}</h3>
                    </div>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};

export default Gallery;
