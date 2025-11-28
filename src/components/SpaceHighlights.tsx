import { Card, CardContent } from "@/components/ui/card";
import { Car, Star, Clock, MapPin, ChefHat, Grid3x3 } from "lucide-react";

const SpaceHighlights = () => {
  const highlights = [
    { icon: Car, label: "Free parking", link: null },
    { icon: Star, label: "⭐️ 5.0 Reviews", link: "https://www.google.com/maps?q=Orlando+Event+Venue,+3847+E+Colonial+Dr,+Orlando,+FL+32803&ftid=0x88e7658349956c29:0x14dd97040d50b24f&entry=gps&lucs=,94275415,94284463,94224825,94227247,94227248,94231188,94280568,47071704,47069508,94218641,94282134,94203019,47084304,94286869&g_ep=CAISEjI1LjQ3LjAuODMzNTQyOTMwMBgAIIgnKn4sOTQyNzU0MTUsOTQyODQ0NjMsOTQyMjQ4MjUsOTQyMjcyNDcsOTQyMjcyNDgsOTQyMzExODgsOTQyODA1NjgsNDcwNzE3MDQsNDcwNjk1MDgsOTQyMTg2NDEsOTQyODIxMzQsOTQyMDMwMTksNDcwODQzMDQsOTQyODY4NjlCAlVT&skid=d985b2d1-525a-4aaf-b447-cd75ebff9886&g_st=ipc" },
    { icon: Clock, label: "24/7 Availability", link: null },
    { icon: MapPin, label: "3847 E Colonial Dr, Orlando, FL 32803", link: null },
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
          <h2 className="text-3xl md:text-4xl font-bold text-center mb-4 text-foreground animate-fade-in">
            Orlando Event Venue
          </h2>
          <p className="text-center text-muted mb-12 max-w-2xl mx-auto">
            Everything you need for a successful event in one place
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-16 animate-fade-in">
            {highlights.map((item, index) => (
              <Card key={index} className="border-border hover:shadow-lg transition-all duration-300 hover:-translate-y-1">
                <CardContent className="p-6 text-center">
                  <item.icon className="w-8 h-8 mx-auto mb-3 text-primary transition-transform duration-300 hover:scale-110" />
                  {item.link ? (
                    <a 
                      href={item.link} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="text-sm font-medium text-foreground hover:text-primary transition-colors duration-300 underline decoration-primary/30 hover:decoration-primary"
                    >
                      {item.label}
                    </a>
                  ) : (
                    <p className="text-sm font-medium text-foreground">{item.label}</p>
                  )}
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
