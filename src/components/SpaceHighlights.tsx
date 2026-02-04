import { Card, CardContent } from "@/components/ui/card";
import { Car, Star, Clock, MapPin, Users, KeyRound, Sparkles } from "lucide-react";
import { useScrollAnimation } from "@/hooks/useScrollAnimation";

const SpaceHighlights = () => {
  const { ref, isVisible } = useScrollAnimation();

  const highlights = [
    { icon: Car, label: "Free parking", link: null },
    {
      icon: Star,
      label: "⭐️ See our 5-star reviews",
      link: "https://g.page/r/CU-yUA0El90UEAE/review",
    },
    { icon: Clock, label: "Day + Night Events", link: null },
    {
      icon: MapPin,
      label: "3847 E Colonial Dr, Orlando, FL 32803",
      link: "https://www.google.com/maps/dir//3847+E+Colonial+Dr,+Orlando,+FL+32803/@28.5442048,-81.1597824,13z/data=!4m8!4m7!1m0!1m5!1m1!1s0x88e7658349956c29:0x14dd97040d50b24f!2m2!1d-81.3365053!2d28.5546946?entry=ttu&g_ep=EgoyMDI2MDExMy4wIKXMDSoASAFQAw%3D%3D",
    },
  ];

  const included = [
    { icon: Users, label: "90 Guest Capacity" },
    { icon: KeyRound, label: "24/7 Access" },
    { icon: MapPin, label: "Near Downtown Orlando" },
    { icon: Sparkles, label: "High Level Production A/V" },
  ];

  return (
    <section ref={ref as any} className="py-8 md:py-12 bg-background">
      <div className="container mx-auto px-4">
        <div className="max-w-6xl mx-auto">
          <h2
            className={`text-3xl md:text-4xl font-bold text-center mb-4 text-foreground transition-all duration-1000 ${
              isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-10"
            }`}
          >
            Orlando Event Venue
          </h2>
          <p
            className={`text-center text-muted mb-12 max-w-2xl mx-auto transition-all duration-1000 delay-150 ${
              isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-10"
            }`}
          >
            Everything you need for a successful event in one place
          </p>

          <div
            className={`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-16 transition-all duration-1000 delay-300 ${
              isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-10"
            }`}
          >
            {highlights.map((item, index) => (
              <Card
                key={index}
                className="border-border bg-gradient-to-br from-card to-card/80 hover:shadow-xl hover:shadow-primary/10 transition-all duration-300 hover:-translate-y-2 group"
              >
                <CardContent className="p-6 text-center">
                  <item.icon className="w-8 h-8 mx-auto mb-3 text-primary transition-all duration-300 group-hover:scale-125 group-hover:rotate-6" />
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

          <div className="bg-gradient-to-br from-card via-card to-accent border border-border rounded-lg p-8 shadow-lg">
            <h3 className="text-2xl font-bold mb-6 text-center text-foreground">What's Included</h3>
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
