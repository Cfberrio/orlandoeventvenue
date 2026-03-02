import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { CalendarCheck } from "lucide-react";
import scheduleTourBg from "@/assets/schedule-tour-bg.jpg";

const ScheduleTourCTA = () => {
  return (
    <section id="tour" className="py-12 md:py-16 relative overflow-hidden">
      {/* Background Image */}
      <div
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: `url(${scheduleTourBg})` }}
      />
      <div className="absolute inset-0 bg-gradient-to-b from-background/80 via-background/70 to-background/60" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,hsl(var(--primary)/0.15),transparent_50%)]" />
      {/* Fade out at top and bottom */}
      <div className="absolute top-0 left-0 right-0 h-24 bg-gradient-to-b from-background to-transparent" />
      <div className="absolute bottom-0 left-0 right-0 h-24 bg-gradient-to-b from-transparent to-background" />

      <div className="container mx-auto px-4 text-center relative z-10">
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
