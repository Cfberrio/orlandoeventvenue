import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Calendar, FileText, CreditCard, PartyPopper } from "lucide-react";

const HowItWorks = () => {
  const steps = [
    {
      icon: Calendar,
      title: "Enter Event Date",
      description: "Share your date and time requirements.",
      cta: "Book Now",
    },
    {
      icon: FileText,
      title: "Payment & Agreement",
      description: "Clear invoice with e-signature.",
    },
    {
      icon: CreditCard,
      title: "Confirm with Payment",
      description: "Pay 50% of total to lock your date and add any packages.",
    },
    {
      icon: PartyPopper,
      title: "Show Up & Enjoy",
      description: "Get access instructions and on-site support.",
    },
  ];

  const scrollToBooking = () => {
    const element = document.getElementById("book-now");
    if (element) {
      element.scrollIntoView({ behavior: "smooth" });
    }
  };

  return (
    <section id="how-it-works" className="py-16 md:py-24 bg-accent">
      <div className="container mx-auto px-4">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold text-center mb-4 text-foreground">
            How It Works
          </h2>
          <p className="text-center text-muted mb-12 max-w-2xl mx-auto">
            Simple booking process in 4 easy steps
          </p>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            {steps.map((step, index) => (
              <Card key={index} className="border-border relative hover:shadow-xl transition-shadow">
                <div className="absolute -top-4 -left-4 w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold">
                  {index + 1}
                </div>
                <CardContent className="pt-8 pb-6">
                  <step.icon className="w-10 h-10 text-primary mb-4" />
                  <h3 className="text-lg font-bold mb-2 text-foreground">{step.title}</h3>
                  <p className="text-sm text-muted mb-4">{step.description}</p>
                  {step.cta && (
                    <Button variant="link" className="p-0 h-auto text-primary" onClick={scrollToBooking}>
                      {step.cta} →
                    </Button>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};

export default HowItWorks;
