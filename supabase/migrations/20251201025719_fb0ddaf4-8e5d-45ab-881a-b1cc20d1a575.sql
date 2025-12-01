-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create enum for booking status
CREATE TYPE public.booking_status AS ENUM (
  'pending_review',
  'confirmed',
  'cancelled',
  'completed',
  'needs_info',
  'needs_payment',
  'declined'
);

-- Create enum for booking type
CREATE TYPE public.booking_type AS ENUM ('hourly', 'daily');

-- Create enum for package type
CREATE TYPE public.package_type AS ENUM ('none', 'basic', 'led', 'workshop');

-- Create enum for payment status
CREATE TYPE public.payment_status AS ENUM (
  'pending',
  'deposit_paid',
  'fully_paid',
  'failed',
  'refunded',
  'invoiced'
);

-- Create enum for app roles
CREATE TYPE public.app_role AS ENUM ('admin', 'staff');

-- Create profiles table for admin users
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create user_roles table
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, role)
);

-- Create bookings table
CREATE TABLE public.bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Booking details
  booking_type booking_type NOT NULL,
  event_date DATE NOT NULL,
  start_time TIME,
  end_time TIME,
  number_of_guests INTEGER NOT NULL CHECK (number_of_guests >= 1 AND number_of_guests <= 90),
  event_type TEXT NOT NULL,
  event_type_other TEXT,
  
  -- Contact information
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  company TEXT,
  
  -- Add-ons
  package package_type NOT NULL DEFAULT 'none',
  setup_breakdown BOOLEAN NOT NULL DEFAULT false,
  tablecloths BOOLEAN NOT NULL DEFAULT false,
  tablecloth_quantity INTEGER NOT NULL DEFAULT 0,
  
  -- Pricing breakdown
  base_rental DECIMAL(10,2) NOT NULL,
  cleaning_fee DECIMAL(10,2) NOT NULL DEFAULT 199.00,
  package_cost DECIMAL(10,2) NOT NULL DEFAULT 0,
  optional_services DECIMAL(10,2) NOT NULL DEFAULT 0,
  taxes_fees DECIMAL(10,2) NOT NULL DEFAULT 0,
  total_amount DECIMAL(10,2) NOT NULL,
  deposit_amount DECIMAL(10,2) NOT NULL,
  balance_amount DECIMAL(10,2) NOT NULL,
  
  -- Payment tracking
  payment_status payment_status NOT NULL DEFAULT 'pending',
  deposit_paid_at TIMESTAMPTZ,
  balance_paid_at TIMESTAMPTZ,
  stripe_session_id TEXT,
  stripe_payment_intent_id TEXT,
  
  -- Status and notes
  status booking_status NOT NULL DEFAULT 'pending_review',
  client_notes TEXT,
  internal_notes JSONB DEFAULT '[]'::jsonb,
  
  -- Contract and policies
  agree_to_rules BOOLEAN NOT NULL DEFAULT false,
  initials TEXT NOT NULL,
  signer_name TEXT NOT NULL,
  signature TEXT NOT NULL,
  signature_date DATE NOT NULL,
  contract_version TEXT DEFAULT 'v1.0',
  
  -- Audit fields
  ip_address INET,
  user_agent TEXT,
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ
);

-- Create attachments table
CREATE TABLE public.booking_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  storage_path TEXT NOT NULL,
  uploaded_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create blackout dates table
CREATE TABLE public.blackout_dates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  reason TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT valid_date_range CHECK (end_date >= start_date)
);

-- Create venue configuration table
CREATE TABLE public.venue_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE,
  value JSONB NOT NULL,
  description TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Insert default configuration
INSERT INTO public.venue_config (key, value, description) VALUES
  ('timezone', '"America/New_York"', 'Venue timezone'),
  ('buffer_hours', '0', 'Buffer hours between bookings'),
  ('hourly_rate', '140', 'Hourly rental rate'),
  ('daily_rate', '899', 'Daily rental rate'),
  ('cleaning_fee', '199', 'Cleaning fee per booking'),
  ('package_basic_hourly', '79', 'Basic package hourly rate'),
  ('package_led_hourly', '99', 'LED package hourly rate'),
  ('package_workshop_hourly', '149', 'Workshop package hourly rate'),
  ('setup_breakdown_fee', '100', 'Setup and breakdown fee'),
  ('tablecloth_unit_fee', '5', 'Tablecloth unit fee'),
  ('tablecloth_cleaning_fee', '25', 'Tablecloth cleaning fee'),
  ('tax_rate', '0.0', 'Tax rate (0.0 to 1.0)'),
  ('deposit_percentage', '0.5', 'Deposit percentage (0.5 = 50%)'),
  ('balance_due_days', '15', 'Days before event when balance is due');

-- Enable Row Level Security
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blackout_dates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.venue_config ENABLE ROW LEVEL SECURITY;

-- Create security definer function to check roles
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  );
$$;

-- Create function to check if user is admin or staff
CREATE OR REPLACE FUNCTION public.is_admin_or_staff(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role IN ('admin', 'staff')
  );
$$;

-- RLS Policies for profiles
CREATE POLICY "Users can view their own profile"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "Users can update their own profile"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id);

-- RLS Policies for user_roles
CREATE POLICY "Admins can view all roles"
  ON public.user_roles FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can manage roles"
  ON public.user_roles FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- RLS Policies for bookings
CREATE POLICY "Anyone can create bookings"
  ON public.bookings FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "Admin and staff can view all bookings"
  ON public.bookings FOR SELECT
  TO authenticated
  USING (public.is_admin_or_staff(auth.uid()));

CREATE POLICY "Admin and staff can update bookings"
  ON public.bookings FOR UPDATE
  TO authenticated
  USING (public.is_admin_or_staff(auth.uid()));

-- RLS Policies for attachments
CREATE POLICY "Anyone can upload attachments for their booking"
  ON public.booking_attachments FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "Admin and staff can view all attachments"
  ON public.booking_attachments FOR SELECT
  TO authenticated
  USING (public.is_admin_or_staff(auth.uid()));

CREATE POLICY "Admin and staff can delete attachments"
  ON public.booking_attachments FOR DELETE
  TO authenticated
  USING (public.is_admin_or_staff(auth.uid()));

-- RLS Policies for blackout dates
CREATE POLICY "Admin and staff can manage blackout dates"
  ON public.blackout_dates FOR ALL
  TO authenticated
  USING (public.is_admin_or_staff(auth.uid()));

CREATE POLICY "Everyone can view blackout dates"
  ON public.blackout_dates FOR SELECT
  TO anon, authenticated
  USING (true);

-- RLS Policies for venue config
CREATE POLICY "Admin can manage config"
  ON public.venue_config FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Everyone can view config"
  ON public.venue_config FOR SELECT
  TO anon, authenticated
  USING (true);

-- Create trigger function for updating updated_at
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- Create triggers for updated_at
CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_bookings_updated_at
  BEFORE UPDATE ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_venue_config_updated_at
  BEFORE UPDATE ON public.venue_config
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Create trigger function for profiles on user creation
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', '')
  );
  RETURN NEW;
END;
$$;

-- Create trigger for new user
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- Create function to add internal note
CREATE OR REPLACE FUNCTION public.add_internal_note(
  _booking_id uuid,
  _note text,
  _author_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _author_email text;
  _new_note jsonb;
BEGIN
  -- Get author email
  SELECT email INTO _author_email
  FROM public.profiles
  WHERE id = _author_id;
  
  -- Create note object
  _new_note := jsonb_build_object(
    'timestamp', NOW(),
    'author', _author_email,
    'note', _note
  );
  
  -- Append to internal_notes array
  UPDATE public.bookings
  SET internal_notes = internal_notes || _new_note
  WHERE id = _booking_id;
END;
$$;