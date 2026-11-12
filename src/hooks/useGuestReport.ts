import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface BookingInfo {
  id: string;
  reservation_number: string;
  full_name: string;
  email: string;
  phone: string;
  event_date: string;
  event_type: string;
}

interface GuestReportData {
  guest_name: string;
  guest_email: string;
  guest_phone: string;
  guest_confirm_area_clean: boolean;
  guest_confirm_trash_bagged: boolean;
  guest_confirm_bathrooms_ok: boolean;
  guest_confirm_door_closed: boolean;
  issue_description: string;
  has_issue: boolean;
}

interface MediaUpload {
  fieldId: string;
  file: File;
}

interface ReviewData {
  rating: number;
  comment: string;
}

export const useGuestReport = () => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const lookupBooking = async (reservationNumber: string): Promise<BookingInfo | null> => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('bookings')
        .select('id, reservation_number, full_name, email, phone, event_date, event_type')
        .eq('reservation_number', reservationNumber.toUpperCase())
        .maybeSingle();

      if (error) {
        console.error('Error looking up booking:', error);
        return null;
      }

      return data;
    } catch (err) {
      console.error('Booking lookup failed:', err);
      return null;
    } finally {
      setLoading(false);
    }
  };

  const uploadMedia = async (
    bookingId: string,
    file: File,
    fieldId: string,
    category: 'host_post_event' | 'maintenance'
  ): Promise<string | null> => {
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${bookingId}/${fieldId}/${Date.now()}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from('cleaning-media')
        .upload(fileName, file);

      if (uploadError) {
        console.error('Upload error:', uploadError);
        return null;
      }

      const { data: urlData } = supabase.storage
        .from('cleaning-media')
        .getPublicUrl(fileName);

      // Create attachment record
      const { error: attachmentError } = await supabase
        .from('booking_attachments')
        .insert({
          booking_id: bookingId,
          storage_path: fileName,
          filename: file.name,
          content_type: file.type,
          size_bytes: file.size,
          category,
          description: fieldId,
        });

      if (attachmentError) {
        console.error('Attachment record error:', attachmentError);
      }

      return urlData.publicUrl;
    } catch (err) {
      console.error('Media upload failed:', err);
      return null;
    }
  };

  const submitReport = async (
    bookingId: string,
    reservationNumber: string,
    reportData: GuestReportData,
    mediaUploads: MediaUpload[],
    reviewData?: ReviewData
  ): Promise<boolean> => {
    setSubmitting(true);
    try {
      // Upload all media files
      for (const upload of mediaUploads) {
        const category = upload.fieldId === 'guest_issue_media' ? 'maintenance' : 'host_post_event';
        await uploadMedia(bookingId, upload.file, upload.fieldId, category);
      }

      // One server-side call records the report, marks host_report_step,
      // cancels the reminder jobs, opens a maintenance ticket for an issue,
      // stores the review and — when the event ended 24h+ ago (Orlando time) —
      // moves the booking from in_progress to post_event. It replaced browser
      // writes to bookings/scheduled_jobs/maintenance_tickets, several of
      // which RLS was silently rejecting (ClickUp 86e40ach2, S-9).
      const { data: submitResult, error: submitError } = await (supabase.rpc as any)(
        'submit_guest_report',
        {
          p_booking_id: bookingId,
          p_reservation_number: reservationNumber,
          p_report: {
            guest_name: reportData.guest_name,
            guest_email: reportData.guest_email,
            guest_phone: reportData.guest_phone,
            guest_confirm_area_clean: reportData.guest_confirm_area_clean,
            guest_confirm_trash_bagged: reportData.guest_confirm_trash_bagged,
            guest_confirm_bathrooms_ok: reportData.guest_confirm_bathrooms_ok,
            guest_confirm_door_closed: reportData.guest_confirm_door_closed,
            issue_description: reportData.issue_description || '',
            has_issue: reportData.has_issue,
          },
          p_review:
            reviewData && reviewData.rating > 0
              ? { rating: reviewData.rating, comment: reviewData.comment || '' }
              : null,
        }
      );

      if (submitError) {
        console.error('Report submission error:', submitError);
        toast({
          title: 'Error',
          description: 'Failed to submit report. Please try again.',
          variant: 'destructive',
        });
        return false;
      }

      const result = (submitResult ?? {}) as {
        transitioned?: boolean;
        event_date?: string | null;
        event_type?: string | null;
      };

      // Low rating alert (1-2 stars) stays best-effort and never blocks the report.
      if (reviewData && reviewData.rating > 0 && reviewData.rating <= 2) {
        try {
          await supabase.functions.invoke('send-low-rating-alert', {
            body: {
              reservation_number: reservationNumber,
              guest_name: reportData.guest_name,
              guest_email: reportData.guest_email,
              event_date: result.event_date || '',
              event_type: result.event_type || '',
              rating: reviewData.rating,
              comment: reviewData.comment || '',
            },
          });
          console.log('Low rating alert sent for reservation:', reservationNumber);
        } catch (alertError) {
          console.error('Low rating alert error:', alertError);
        }
      }

      if (result.transitioned) {
        console.log('Booking transitioned to post_event after host report submission');
      }

      // Trigger sync to GHL - this will send updated host_report_completed and review_received flags
      try {
        await supabase.functions.invoke('sync-to-ghl', {
          body: { booking_id: bookingId },
        });
      } catch (syncError) {
        console.error('GHL sync error:', syncError);
      }

      toast({
        title: 'Report Submitted',
        description: 'Thank you! Your post-event report has been received.',
      });

      return true;
    } catch (err) {
      console.error('Submit report failed:', err);
      toast({
        title: 'Error',
        description: 'An unexpected error occurred. Please try again.',
        variant: 'destructive',
      });
      return false;
    } finally {
      setSubmitting(false);
    }
  };

  return {
    loading,
    submitting,
    lookupBooking,
    submitReport,
  };
};
