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

      // Create or update host report
      const { error: reportError } = await supabase
        .from('booking_host_reports')
        .insert({
          booking_id: bookingId,
          guest_name: reportData.guest_name,
          guest_email: reportData.guest_email,
          guest_phone: reportData.guest_phone,
          guest_confirm_area_clean: reportData.guest_confirm_area_clean,
          guest_confirm_trash_bagged: reportData.guest_confirm_trash_bagged,
          guest_confirm_bathrooms_ok: reportData.guest_confirm_bathrooms_ok,
          guest_confirm_door_closed: reportData.guest_confirm_door_closed,
          notes: reportData.issue_description || null,
          status: 'submitted',
          submitted_at: new Date().toISOString(),
        });

      if (reportError) {
        console.error('Report submission error:', reportError);
        toast({
          title: 'Error',
          description: 'Failed to submit report. Please try again.',
          variant: 'destructive',
        });
        return false;
      }

      // Update booking host_report_step to 'completed'
      const { error: updateError } = await supabase
        .from('bookings')
        .update({
          host_report_step: 'completed',
          updated_at: new Date().toISOString(),
        })
        .eq('id', bookingId);

      if (updateError) {
        console.error('Failed to update host_report_step:', updateError);
      }

      // Cancel any pending host report reminder jobs
      const { error: cancelJobsError } = await supabase
        .from('scheduled_jobs')
        .update({
          status: 'cancelled',
          last_error: 'host_report_completed_before_job_run',
          updated_at: new Date().toISOString(),
        })
        .eq('booking_id', bookingId)
        .in('job_type', ['host_report_pre_start', 'host_report_during', 'host_report_post'])
        .eq('status', 'pending');

      if (cancelJobsError) {
        console.error('Failed to cancel host report jobs:', cancelJobsError);
      } else {
        console.log('Cancelled pending host report reminder jobs for booking:', bookingId);
      }

      // Log host report completed event
      await supabase.from('booking_events').insert({
        booking_id: bookingId,
        event_type: 'host_report_completed',
        channel: 'host',
        metadata: {
          submitted_at: new Date().toISOString(),
          guest_name: reportData.guest_name,
          guest_email: reportData.guest_email,
        },
      });

      // Create maintenance ticket if there's an issue
      if (reportData.has_issue && reportData.issue_description) {
        const { error: ticketError } = await supabase
          .from('maintenance_tickets')
          .insert({
            booking_id: bookingId,
            title: `Guest issue reported – reservation ${reservationNumber}`,
            description: reportData.issue_description,
            issue_type: 'guest_report',
            reported_by_role: 'host',
            priority: 'medium',
            status: 'open',
          });

        if (ticketError) {
          console.error('Maintenance ticket error:', ticketError);
        }
      }

      // Create review if rating provided
      if (reviewData && reviewData.rating > 0) {
        const { error: reviewError } = await supabase
          .from('booking_reviews')
          .insert({
            booking_id: bookingId,
            rating: reviewData.rating,
            comment: reviewData.comment || null,
            reviewer_name: reportData.guest_name,
            source: 'guest_report',
          });

        if (reviewError) {
          console.error('Review submission error:', reviewError);
        }

        // Send low rating alert if rating is 1 or 2 stars
        if (reviewData.rating <= 2) {
          try {
            // Fetch booking details for the alert
            const { data: bookingData } = await supabase
              .from('bookings')
              .select('event_date, event_type')
              .eq('id', bookingId)
              .single();

            await supabase.functions.invoke('send-low-rating-alert', {
              body: {
                reservation_number: reservationNumber,
                guest_name: reportData.guest_name,
                guest_email: reportData.guest_email,
                event_date: bookingData?.event_date || '',
                event_type: bookingData?.event_type || '',
                rating: reviewData.rating,
                comment: reviewData.comment || '',
              },
            });
            console.log('Low rating alert sent for reservation:', reservationNumber);
          } catch (alertError) {
            console.error('Low rating alert error:', alertError);
          }
        }
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
