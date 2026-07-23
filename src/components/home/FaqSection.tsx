import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { usePricing } from "@/hooks/usePricing";

const FaqSection = () => {
  const { pricing: p } = usePricing();
  const faqs = [
    {
      question: "Can we have alcohol at our event?",
      answer:
        "Yes, bar service is available as a paid add-on for all private events. We coordinate the vendor; you select your package and pay online when you book. Packages start at $18/guest. No outside alcohol or outside bartenders are permitted.",
    },
    {
      question: "Can I bring my own caterer?",
      answer: "Yes! Any licensed caterer is welcome. We have a prep kitchen available for your use.",
    },
    {
      question: "Is setup and teardown included?",
      answer: `Basic setup and teardown is your responsibility. However, we offer an optional $${p.setup_breakdown} flat rate service if you'd like assistance.`,
    },
    {
      question: "Are tablecloths available?",
      answer: `Yes, tablecloths are available for $${p.tablecloth_rental} each, plus a $${p.tablecloth_cleaning_fee} cleaning fee.`,
    },
    {
      question: "What about parking and load-in?",
      answer:
        "Free parking is available on-site with convenient load-in access for your equipment and supplies.",
    },
  ];

  return (
    <section id="faq">
      <div className="wrap faq-wrap">
        <div className="shead">
          <h2 data-rv>Everything hosts ask us, answered.</h2>
        </div>
        <div data-rv>
          <Accordion type="single" collapsible className="faq-acc">
            {faqs.map((faq, index) => (
              <AccordionItem key={index} value={`item-${index}`}>
                <AccordionTrigger>{faq.question}</AccordionTrigger>
                <AccordionContent>{faq.answer}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </div>
    </section>
  );
};

export default FaqSection;
