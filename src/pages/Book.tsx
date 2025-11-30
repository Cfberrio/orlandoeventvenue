import { useState } from "react";
import Navigation from "@/components/Navigation";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import BookingTypeStep from "@/components/booking/BookingTypeStep";
import GuestsEventStep from "@/components/booking/GuestsEventStep";
import AddOnsStep from "@/components/booking/AddOnsStep";
import SummaryStep from "@/components/booking/SummaryStep";
import ContactPoliciesStep from "@/components/booking/ContactPoliciesStep";
import PaymentStep from "@/components/booking/PaymentStep";

export interface BookingFormData {
  // Step 1
  bookingType: "hourly" | "daily";
  date: Date | undefined;
  startTime: string;
  endTime: string;
  
  // Step 2
  numberOfGuests: number;
  eventType: string;
  eventTypeOther?: string;
  notes?: string;
  
  // Step 3
  package: "none" | "basic" | "led" | "workshop";
  setupBreakdown: boolean;
  tablecloths: boolean;
  tableclothQuantity: number;
  
  // Step 4 (calculated)
  pricing: {
    baseRental: number;
    cleaningFee: number;
    packageCost: number;
    optionalServices: number;
    taxes: number;
    total: number;
    deposit: number;
    balance: number;
  };
  
  // Step 5
  fullName: string;
  email: string;
  phone: string;
  company?: string;
  agreeToRules: boolean;
  initials: string;
  signerName: string;
  signature: string;
  signatureDate: string;
  
  // Step 6
  paymentStatus: "pending" | "paid";
}

const Book = () => {
  const [currentStep, setCurrentStep] = useState(1);
  const [formData, setFormData] = useState<Partial<BookingFormData>>({
    bookingType: "hourly",
    numberOfGuests: 1,
    eventType: "",
    package: "none",
    setupBreakdown: false,
    tablecloths: false,
    tableclothQuantity: 0,
    agreeToRules: false,
  });

  const totalSteps = 6;
  const progress = (currentStep / totalSteps) * 100;

  const updateFormData = (data: Partial<BookingFormData>) => {
    setFormData((prev) => ({ ...prev, ...data }));
  };

  const goToStep = (step: number) => {
    setCurrentStep(step);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const nextStep = () => {
    if (currentStep < totalSteps) {
      goToStep(currentStep + 1);
    }
  };

  const previousStep = () => {
    if (currentStep > 1) {
      goToStep(currentStep - 1);
    }
  };

  const stepTitles = [
    "Booking Type",
    "Guests & Event",
    "Add-Ons",
    "Summary & Pricing",
    "Contact & Policies",
    "Payment",
  ];

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-accent/10">
      <Navigation />
      
      <div className="container mx-auto px-4 py-12 md:py-20">
        <div className="max-w-4xl mx-auto">
          {/* Header */}
          <div className="text-center mb-8">
            <h1 className="text-4xl md:text-5xl font-bold mb-4">
              Book Your Event
            </h1>
            <p className="text-lg text-muted-foreground">
              Step {currentStep} of {totalSteps}: {stepTitles[currentStep - 1]}
            </p>
          </div>

          {/* Progress Bar */}
          <div className="mb-8">
            <Progress value={progress} className="h-3" />
            <div className="flex justify-between mt-2 text-sm text-muted-foreground">
              {stepTitles.map((title, index) => (
                <button
                  key={index}
                  onClick={() => goToStep(index + 1)}
                  className={`text-xs md:text-sm hover:text-foreground transition-colors ${
                    currentStep === index + 1 ? "text-primary font-semibold" : ""
                  } ${currentStep > index + 1 ? "text-foreground" : ""}`}
                >
                  {index + 1}. {title}
                </button>
              ))}
            </div>
          </div>

          {/* Step Content */}
          <Card className="p-6 md:p-8">
            {currentStep === 1 && (
              <BookingTypeStep
                data={formData}
                updateData={updateFormData}
                onNext={nextStep}
              />
            )}
            {currentStep === 2 && (
              <GuestsEventStep
                data={formData}
                updateData={updateFormData}
                onNext={nextStep}
                onBack={previousStep}
              />
            )}
            {currentStep === 3 && (
              <AddOnsStep
                data={formData}
                updateData={updateFormData}
                onNext={nextStep}
                onBack={previousStep}
              />
            )}
            {currentStep === 4 && (
              <SummaryStep
                data={formData}
                updateData={updateFormData}
                onNext={nextStep}
                onBack={previousStep}
                goToStep={goToStep}
              />
            )}
            {currentStep === 5 && (
              <ContactPoliciesStep
                data={formData}
                updateData={updateFormData}
                onNext={nextStep}
                onBack={previousStep}
              />
            )}
            {currentStep === 6 && (
              <PaymentStep
                data={formData}
                updateData={updateFormData}
                onBack={previousStep}
              />
            )}
          </Card>
        </div>
      </div>
    </div>
  );
};

export default Book;
