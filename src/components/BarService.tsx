import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Wine, GlassWater, Martini, Sparkles } from "lucide-react";
import { useScrollAnimation } from "@/hooks/useScrollAnimation";
import { useBarPackages, BarPackage } from "@/hooks/useBarPackages";

const ICONS: Record<string, typeof Wine> = {
  house_beer_wine: Wine,
  essential_bar: GlassWater,
  signature_bar: Martini,
  bespoke_bar: Sparkles,
};

const formatPrice = (n: number) => {
  return n % 1 === 0 ? `$${n.toFixed(0)}` : `$${n.toFixed(2)}`;
};

const BarService = () => {
  const { ref, isVisible } = useScrollAnimation();
  const { packages } = useBarPackages();

  return (
    <section ref={ref as any} id="bar-service" className="scroll-mt-24 py-8 md:py-12 bg-accent">
      <div className="container mx-auto px-4">
        <div className="max-w-6xl mx-auto">
          <h2
            className={`text-3xl md:text-4xl font-bold text-center mb-4 text-foreground transition-all duration-1000 ${
              isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-10"
            }`}
          >
            Bar Service, Handled.
          </h2>
          <p
            className={`text-center text-muted mb-12 max-w-2xl mx-auto transition-all duration-1000 delay-150 ${
              isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-10"
            }`}
          >
            Choose your bar package, pay online, and we take care of the rest. No vendor hunting,
            no logistics juggling — just a fully coordinated bar experience for your guests.
            Available for all private events.
          </p>

          <div
            className={`grid sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-8 transition-all duration-1000 delay-300 ${
              isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-10"
            }`}
          >
            {packages.map((pkg: BarPackage) => {
              const Icon = ICONS[pkg.key] || Wine;
              const isPopular = pkg.badge === "Most Popular";
              return (
                <Card
                  key={pkg.key}
                  className={`border-border hover:shadow-xl transition-all duration-300 hover:-translate-y-1 relative ${
                    isPopular ? "border-2 border-primary pt-6" : ""
                  }`}
                >
                  {isPopular && (
                    <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 bg-gradient-to-r from-primary via-primary to-primary/80 text-primary-foreground shadow-lg z-20">
                      Most Popular
                    </Badge>
                  )}
                  <CardHeader>
                    <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                      <Icon className="w-6 h-6 text-primary" />
                    </div>
                    <CardTitle>{pkg.label}</CardTitle>
                    <CardDescription className="text-2xl font-bold text-foreground">
                      {formatPrice(pkg.ratePerGuest)}
                      <span className="text-sm font-normal text-muted">/guest</span>
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted">
                      Fully coordinated bar service. Vendor sourcing, setup, and execution handled
                      for you.
                    </p>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          <p className="text-center text-sm text-muted">
            Add bar service when you book online, or reach out and we'll walk you through the options.
          </p>
        </div>
      </div>
    </section>
  );
};

export default BarService;
