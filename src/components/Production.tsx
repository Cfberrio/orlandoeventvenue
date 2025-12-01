import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Mic, Monitor, Video, Wrench } from "lucide-react";
import { useScrollAnimation } from "@/hooks/useScrollAnimation";

const Production = () => {
  const { ref, isVisible } = useScrollAnimation();

  const packages = [
    {
      icon: Mic,
      name: "Basic",
      price: "$79/hr",
      features: [
        "AV System",
        "Microphones",
        "Speakers",
        "Projectors",
        "Tech Assistant",
      ],
    },
    {
      icon: Monitor,
      name: "LED",
      price: "$99/hr",
      features: [
        "Includes Basic +",
        "Stage LED Wall Screen",
        "For presentations",
        "Immersive environments",
      ],
    },
    {
      icon: Video,
      name: "Workshop",
      price: "$149/hr",
      features: [
        "Includes Basic & LED +",
        "Streaming Equipment",
        "Streaming Tech",
        "Live streaming & recording",
        "Virtual conferencing",
      ],
    },
  ];

  const addOns = [
    { name: "Setup & breakdown", price: "$100" },
    { name: "Tablecloth", price: "$5/ea + $25 cleaning" },
  ];

  const scrollToBooking = () => {
    const element = document.getElementById("book-now");
    if (element) {
      element.scrollIntoView({ behavior: "smooth" });
    }
  };

  return (
    <section ref={ref as any} id="production" className="py-8 md:py-12 bg-background">
      <div className="container mx-auto px-4">
        <div className="max-w-6xl mx-auto">
          <h2 className={`text-3xl md:text-4xl font-bold text-center mb-4 text-foreground transition-all duration-1000 ${
            isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-10'
          }`}>
            Production Packages
          </h2>
          <p className={`text-center text-muted mb-12 max-w-2xl mx-auto transition-all duration-1000 delay-150 ${
            isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-10'
          }`}>
            Choose the level of support you need. Prices are per hour and added to your rental.
          </p>

          <div className={`grid md:grid-cols-3 gap-6 mb-12 transition-all duration-1000 delay-300 ${
            isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-10'
          }`}>
            {packages.map((pkg, index) => (
              <Card key={index} className="border-border hover:shadow-xl transition-all duration-300 hover:-translate-y-1">
                <CardHeader>
                  <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                    <pkg.icon className="w-6 h-6 text-primary" />
                  </div>
                  <CardTitle>{pkg.name}</CardTitle>
                  <CardDescription className="text-2xl font-bold text-foreground">
                    {pkg.price}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2">
                    {pkg.features.map((feature, idx) => (
                      <li key={idx} className="text-sm text-muted flex items-start gap-2">
                        <span className="text-primary mt-1">✓</span>
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card className="border-border bg-card mb-8">
            <CardHeader>
              <div className="flex items-center gap-2">
                <Wrench className="w-5 h-5 text-primary" />
                <CardTitle>Optional Add-Ons</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid md:grid-cols-2 gap-4">
                {addOns.map((addon, index) => (
                  <div key={index} className="flex items-center justify-between p-4 bg-accent rounded-lg">
                    <span className="text-sm font-medium text-foreground">{addon.name}</span>
                    <span className="text-sm font-bold text-primary">{addon.price}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <div className="text-center">
            <Button size="lg" onClick={scrollToBooking}>
              Add to My Booking
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
};

export default Production;
