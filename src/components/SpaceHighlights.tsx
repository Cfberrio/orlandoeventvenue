import { Card, CardContent } from "@/components/ui/card";
import { Car, Star, Clock, MapPin, ChefHat, Grid3x3 } from "lucide-react";

const SpaceHighlights = () => {
  const highlights = [
    { icon: Car, label: "Free parking" },
    { icon: Star, label: "⭐️ 5.0 Reviews" },
    { icon: Clock, label: "24/7 Availability" },
    { icon: MapPin, label: "3847 E Colonial Dr, Orlando, FL 32803" },
  ];

  const included = [
    { icon: Grid3x3, label: "90 chairs" },
    { icon: Grid3x3, label: "10 tables" },
    { icon: ChefHat, label: "Prep kitchen" },
    { icon: Grid3x3, label: "Two bathrooms" },
  ];

  return (
    <section className="py-16 md:py-24 bg-background">
      <div className="container mx-auto px-4">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold text-center mb-4 text-foreground">
            Flexible for your event
          </h2>
          <p className="text-center text-muted mb-12 max-w-2xl mx-auto">
            Everything you need for a successful event in one place
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-16 animate-fade-in">
            {highlights.map((item, index) => (
              <Card key={index} className="border-border hover:shadow-lg transition-all duration-300 hover:-translate-y-1">
                <CardContent className="p-6 text-center">
                  <item.icon className="w-8 h-8 mx-auto mb-3 text-primary" />
                  <p className="text-sm font-medium text-foreground">{item.label}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="bg-card border border-border rounded-lg p-8">
            <h3 className="text-2xl font-bold mb-6 text-center text-foreground">
              What's Included
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
              {included.map((item, index) => (
                <div key={index} className="text-center">
                  <item.icon className="w-6 h-6 mx-auto mb-2 text-primary" />
                  <p className="text-sm text-muted">{item.label}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default SpaceHighlights;
