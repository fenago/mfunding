-- Create funding_applications table for public intake form
CREATE TABLE public.funding_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_name TEXT NOT NULL,
  ein TEXT,
  contact_first_name TEXT NOT NULL,
  contact_last_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  funding_amount INTEGER NOT NULL,
  business_type TEXT NOT NULL,
  time_in_business TEXT NOT NULL,
  monthly_revenue TEXT NOT NULL,
  funding_purpose TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.funding_applications ENABLE ROW LEVEL SECURITY;

-- Allow anonymous inserts (public form submission)
CREATE POLICY "Allow anonymous inserts" ON public.funding_applications
  FOR INSERT TO anon WITH CHECK (true);

-- Allow authenticated admins to read all applications
CREATE POLICY "Allow authenticated reads" ON public.funding_applications
  FOR SELECT TO authenticated USING (true);
