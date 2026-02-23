import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { CalendarCheck } from "lucide-react";

const ScheduleTourCTA = () => {
  return (
    <section id="tour" className="py-12 md:py-16 bg-muted/30">
      <div className="container mx-auto px-4 text-center">
        <div className="max-w-2xl mx-auto space-y-6">
          <CalendarCheck className="h-12 w-12 mx-auto text-primary" />
          <h2 className="text-3xl md:text-4xl font-bold">
            Schedule Your Tour Now
          </h2>
          <p className="text-lg text-muted-foreground">
            Visit our venue in person and see how we can bring your event to life. Book a free tour at a time that works for you.
          </p>
          <Button asChild size="lg" className="text-lg px-8 hover:scale-105 transition-all duration-300">
            <Link to="/schedule-tour">Schedule Now</Link>
          </Button>
        </div>
      </div>
    </section>
  );
};

export default ScheduleTourCTA;
