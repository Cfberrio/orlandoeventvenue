import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

const FAQ = () => {
  const faqs = [
    {
      question: "What is your alcohol policy?",
      answer: "No hard liquor is allowed at the venue. Beer and wine are permitted.",
    },
    {
      question: "Can I bring my own caterer?",
      answer: "Yes! Any licensed caterer is welcome. We have a prep kitchen available for your use.",
    },
    {
      question: "Is setup and teardown included?",
      answer: "Basic setup and teardown is your responsibility. However, we offer an optional $100 flat rate service if you'd like assistance.",
    },
    {
      question: "Are tablecloths available?",
      answer: "Yes, tablecloths are available for $5 each, plus a $25 cleaning fee.",
    },
    {
      question: "What about parking and load-in?",
      answer: "Free parking is available on-site with convenient load-in access for your equipment and supplies.",
    },
  ];

  return (
    <section id="faq" className="py-8 md:py-12 bg-background">
      <div className="container mx-auto px-4">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold text-center mb-4 text-foreground">
            Frequently Asked Questions
          </h2>
          <p className="text-center text-muted mb-12">
            Everything you need to know about booking our venue
          </p>

          <Accordion type="single" collapsible className="w-full animate-fade-in">
            {faqs.map((faq, index) => (
              <AccordionItem key={index} value={`item-${index}`}>
                <AccordionTrigger className="text-left text-foreground hover:text-primary transition-colors duration-300">
                  {faq.question}
                </AccordionTrigger>
                <AccordionContent className="text-muted">
                  {faq.answer}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </div>
    </section>
  );
};

export default FAQ;
