import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Clock, Calendar, Sparkles } from "lucide-react";

const Pricing = () => {
  const scrollToBooking = () => {
    const element = document.getElementById("book-now");
    if (element) {
      element.scrollIntoView({ behavior: "smooth" });
    }
  };

  return (
    <section id="pricing" className="py-16 md:py-24 bg-accent">
      <div className="container mx-auto px-4">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold text-center mb-4 text-foreground">
            Simple, Transparent Pricing
          </h2>
          <p className="text-center text-muted mb-12 max-w-2xl mx-auto">
            No hidden fees. Choose what works for your event.
          </p>

          <div className="grid md:grid-cols-2 gap-6 mb-8">
            <Card className="border-border hover:shadow-xl transition-shadow">
              <CardHeader>
                <div className="flex items-center gap-2 mb-2">
                  <Clock className="w-5 h-5 text-primary" />
                  <CardTitle>Hourly Rate</CardTitle>
                </div>
                <CardDescription>Perfect for shorter events</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="mb-4">
                  <span className="text-4xl font-bold text-foreground">$140</span>
                  <span className="text-muted">/hour</span>
                </div>
                <p className="text-sm text-muted mb-4">4-hour minimum</p>
                <ul className="space-y-2 text-sm text-muted mb-6">
                  <li>✓ All venue amenities included</li>
                  <li>✓ Flexible scheduling</li>
                  <li>✓ Great for meetings & workshops</li>
                </ul>
              </CardContent>
            </Card>

            <Card className="border-2 border-primary relative hover:shadow-xl transition-shadow">
              <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground">
                Most Popular
              </Badge>
              <CardHeader>
                <div className="flex items-center gap-2 mb-2">
                  <Calendar className="w-5 h-5 text-primary" />
                  <CardTitle>Daily Special</CardTitle>
                </div>
                <CardDescription>Best value for all-day events</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="mb-4">
                  <span className="text-4xl font-bold text-foreground">$899</span>
                  <span className="text-muted">/day</span>
                </div>
                <p className="text-sm text-muted mb-4">24-hour access</p>
                <ul className="space-y-2 text-sm text-muted mb-6">
                  <li>✓ Full 24-hour access</li>
                  <li>✓ All venue amenities included</li>
                  <li>✓ Perfect for full-day events</li>
                  <li>✓ Setup & breakdown time included</li>
                </ul>
              </CardContent>
            </Card>
          </div>

          <Card className="border-border bg-card">
            <CardHeader>
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-primary" />
                <CardTitle>Cleaning Fee</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between flex-wrap gap-4">
                <div>
                  <p className="text-2xl font-bold text-foreground">$199</p>
                  <p className="text-sm text-muted">Per reservation</p>
                </div>
                <p className="text-sm text-muted">
                  One-time fee added to all bookings
                </p>
              </div>
            </CardContent>
          </Card>

          <p className="text-center text-sm text-muted mt-8">
            Transparent pricing. Taxes/permits not included where applicable.
          </p>

          <div className="text-center mt-8">
            <Button size="lg" onClick={scrollToBooking}>
              Book Now
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
};

export default Pricing;
