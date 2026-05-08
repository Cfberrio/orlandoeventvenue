import Production from "./Production";
import BarService from "./BarService";

const AddOns = () => {
  return (
    <section id="add-ons" className="scroll-mt-24 py-12 md:py-16 bg-background">
      <div className="container mx-auto px-4">
        <div className="max-w-6xl mx-auto text-center mb-12">
          <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
            Add-Ons
          </h2>
          <p className="text-muted max-w-2xl mx-auto">
            Enhance your event with production support and bar service. Mix and match to fit your needs.
          </p>
        </div>

        <div className="space-y-16">
          <Production embedded />
          <BarService embedded />
        </div>
      </div>
    </section>
  );
};

export default AddOns;
