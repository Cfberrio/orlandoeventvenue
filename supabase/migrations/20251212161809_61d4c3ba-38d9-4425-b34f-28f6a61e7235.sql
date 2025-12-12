-- Create scheduled_jobs table for deferred tasks
CREATE TABLE public.scheduled_jobs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  job_type text NOT NULL,
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  run_at timestamp with time zone NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  completed_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Create index for efficient job processing
CREATE INDEX idx_scheduled_jobs_pending ON public.scheduled_jobs (run_at, status) WHERE status = 'pending';
CREATE INDEX idx_scheduled_jobs_booking ON public.scheduled_jobs (booking_id);

-- Enable RLS
ALTER TABLE public.scheduled_jobs ENABLE ROW LEVEL SECURITY;

-- Admin and staff can view/manage scheduled jobs
CREATE POLICY "Admin and staff can view scheduled_jobs"
ON public.scheduled_jobs
FOR SELECT
USING (is_admin_or_staff(auth.uid()));

CREATE POLICY "Admin and staff can manage scheduled_jobs"
ON public.scheduled_jobs
FOR ALL
USING (is_admin_or_staff(auth.uid()));

-- Add trigger for updated_at
CREATE TRIGGER update_scheduled_jobs_updated_at
BEFORE UPDATE ON public.scheduled_jobs
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();