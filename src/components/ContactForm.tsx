import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Loader2, Send, CheckCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

const ContactForm = () => {
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    phone: "",
    subject: "",
    message: "",
    website: "", // Honeypot field
    transactionalConsent: false,
    marketingConsent: false,
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitStatus, setSubmitStatus] = useState<"idle" | "success" | "error">("idle");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Client-side validation
    if (!formData.name || !formData.email || !formData.subject || !formData.message) {
      return;
    }

    setIsSubmitting(true);
    setSubmitStatus("idle");

    try {
      const { error } = await supabase.functions.invoke("send-contact-form", {
        body: {
          name: formData.name,
          email: formData.email,
          phone: formData.phone,
          subject: formData.subject,
          message: formData.message,
          website: formData.website, // Honeypot
          transactionalConsent: formData.transactionalConsent,
          marketingConsent: formData.marketingConsent,
          timestamp: new Date().toISOString(),
        },
      });

      if (error) {
        console.error("Error sending contact form:", error);
        setSubmitStatus("error");
      } else {
        setSubmitStatus("success");
        // Clear form
        setFormData({
          name: "",
          email: "",
          phone: "",
          subject: "",
          message: "",
          website: "",
          transactionalConsent: false,
          marketingConsent: false,
        });

        // Clear success message after 5 seconds
        setTimeout(() => {
          setSubmitStatus("idle");
        }, 5000);
      }
    } catch (error) {
      console.error("Error:", error);
      setSubmitStatus("error");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section id="contact" className="py-24 bg-muted/30">
      <div className="container mx-auto px-4">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">Send us a message</h2>
            <p className="text-muted-foreground text-lg">
              Have questions? We're here to help. Fill out the form below and we'll get back to you soon.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6 bg-background p-8 rounded-xl shadow-sm border">
            {/* Honeypot field - hidden */}
            <input
              type="text"
              name="website"
              value={formData.website}
              onChange={(e) => setFormData({ ...formData, website: e.target.value })}
              style={{ display: "none" }}
              tabIndex={-1}
              autoComplete="off"
            />

            <div className="grid md:grid-cols-2 gap-6">
              {/* Name */}
              <div className="space-y-2">
                <Label htmlFor="name">
                  Your name <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="name"
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="John Doe"
                />
              </div>

              {/* Email */}
              <div className="space-y-2">
                <Label htmlFor="email">
                  Email address <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="email"
                  type="email"
                  required
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  placeholder="john@example.com"
                />
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-6">
              {/* Phone */}
              <div className="space-y-2">
                <Label htmlFor="phone">Phone number</Label>
                <Input
                  id="phone"
                  type="tel"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  placeholder="(407) 123-4567"
                />
              </div>

              {/* Subject */}
              <div className="space-y-2">
                <Label htmlFor="subject">
                  Subject <span className="text-destructive">*</span>
                </Label>
                <Select
                  required
                  value={formData.subject}
                  onValueChange={(value) => setFormData({ ...formData, subject: value })}
                >
                  <SelectTrigger id="subject">
                    <SelectValue placeholder="Select a topic" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Pricing & Availability">Pricing & Availability</SelectItem>
                    <SelectItem value="Tours / Walkthroughs">Tours / Walkthroughs</SelectItem>
                    <SelectItem value="Add-ons & Production">Add-ons & Production</SelectItem>
                    <SelectItem value="General Question">General Question</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Message */}
            <div className="space-y-2">
              <Label htmlFor="message">
                Message <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="message"
                required
                rows={6}
                value={formData.message}
                onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                placeholder="Tell us about your event or ask us a question..."
                className="resize-none"
              />
            </div>

            {/* Consent Checkboxes */}
            <div className="space-y-4 pt-4">
              {/* Transactional Consent */}
              <div className="flex items-start space-x-3 border rounded-lg p-4 bg-background">
                <Checkbox
                  id="transactional"
                  checked={formData.transactionalConsent}
                  onCheckedChange={(checked) =>
                    setFormData({ ...formData, transactionalConsent: checked as boolean })
                  }
                />
                <div className="flex-1">
                  <Label htmlFor="transactional" className="text-sm font-normal cursor-pointer leading-relaxed">
                    By checking this box, I consent to receive SMS messages from Global Ministries Orlando Inc (d/b/a Orlando Event Venue) related to my venue booking, including payment confirmations (deposit/balance), booking status updates, reminders, access/arrival instructions, and day-of-event notifications. Message frequency may vary. Message & data rates may apply. Reply HELP for help or STOP to opt-out.
                  </Label>
                </div>
              </div>

              {/* Marketing Consent */}
              <div className="flex items-start space-x-3 border rounded-lg p-4 bg-background">
                <Checkbox
                  id="marketing"
                  checked={formData.marketingConsent}
                  onCheckedChange={(checked) =>
                    setFormData({ ...formData, marketingConsent: checked as boolean })
                  }
                />
                <div className="flex-1">
                  <Label htmlFor="marketing" className="text-sm font-normal cursor-pointer leading-relaxed">
                    By checking this box, I consent to receive marketing SMS messages from Global Ministries Orlando Inc (d/b/a Orlando Event Venue), including special offers, discounts, last-minute availability, and updates on packages or add-ons. Message frequency may vary. Message & data rates may apply. Reply HELP for help or STOP to opt-out.
                  </Label>
                </div>
              </div>
            </div>

            {/* Submit Button and Status */}
            <div className="flex flex-col items-center gap-4 pt-4">
              <Button
                type="submit"
                size="lg"
                disabled={isSubmitting || submitStatus === "success"}
                className="w-full md:w-auto min-w-[200px]"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Sending...
                  </>
                ) : submitStatus === "success" ? (
                  <>
                    <CheckCircle className="h-4 w-4 mr-2" />
                    Message Sent
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4 mr-2" />
                    Send Message
                  </>
                )}
              </Button>

              {submitStatus === "success" && (
                <p className="text-sm text-green-600 dark:text-green-500 font-medium">
                  Thanks! We received your message.
                </p>
              )}

              {submitStatus === "error" && (
                <p className="text-sm text-destructive font-medium">
                  Something went wrong. Please try again later.
                </p>
              )}

              {/* Legal Links */}
              <div className="text-center text-sm text-muted-foreground">
                For more information, please review our{" "}
                <a
                  href="/privacy-policy"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline hover:text-primary/80 font-medium"
                >
                  Privacy Policy
                </a>
                {" "}and{" "}
                <a
                  href="/terms-of-use"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline hover:text-primary/80 font-medium"
                >
                  Terms of Use
                </a>
                .
              </div>
            </div>
          </form>
        </div>
      </div>
    </section>
  );
};

export default ContactForm;
