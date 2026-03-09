-- Analytics Engine: lead_sources table + reporting views
-- Note: Some views reference deals, deal_submissions, commissions, closers tables
-- that are being created by other agent teams concurrently.
-- Views that depend on tables not yet created will be created as stubs
-- and can be updated once those tables exist.

-- ============================================================
-- Table 4.9: lead_sources — Lead Source Cost Tracking
-- ============================================================
CREATE TABLE IF NOT EXISTS lead_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL, -- "Lead Tycoons", "Google Ads - Indianapolis", etc.
  type TEXT NOT NULL CHECK (type IN (
    'live_transfer', 'google_ads', 'aged_lead', 'ucc_filing',
    'referral', 'sub_iso', 'organic', 'social_media', 'other'
  )),
  vendor_id UUID REFERENCES marketing_vendors(id),
  -- Cost tracking
  cost_per_lead NUMERIC,
  monthly_budget NUMERIC,
  -- Performance (calculated)
  total_leads INTEGER DEFAULT 0,
  total_funded INTEGER DEFAULT 0,
  total_spend NUMERIC DEFAULT 0,
  total_revenue NUMERIC DEFAULT 0,
  cost_per_funded_deal NUMERIC, -- calculated
  roi_percentage NUMERIC, -- calculated
  --
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'archived')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_lead_sources_type ON lead_sources(type);
CREATE INDEX IF NOT EXISTS idx_lead_sources_vendor_id ON lead_sources(vendor_id);
CREATE INDEX IF NOT EXISTS idx_lead_sources_status ON lead_sources(status);

-- RLS
ALTER TABLE lead_sources ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view lead_sources" ON lead_sources
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role IN ('admin', 'super_admin')
    )
  );

CREATE POLICY "Super admins can manage lead_sources" ON lead_sources
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'super_admin'
    )
  );

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_lead_sources_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER lead_sources_updated_at
  BEFORE UPDATE ON lead_sources
  FOR EACH ROW
  EXECUTE FUNCTION update_lead_sources_updated_at();


-- ============================================================
-- View: v_cost_per_funded_deal — Cost per funded deal by source
-- ============================================================
CREATE OR REPLACE VIEW v_cost_per_funded_deal AS
SELECT
  ls.id AS lead_source_id,
  ls.name AS source_name,
  ls.type AS source_type,
  ls.total_leads,
  ls.total_funded,
  ls.total_spend,
  ls.total_revenue,
  CASE WHEN ls.total_funded > 0
    THEN ls.total_spend / ls.total_funded
    ELSE NULL
  END AS cost_per_funded_deal,
  CASE WHEN ls.total_spend > 0
    THEN ((ls.total_revenue - ls.total_spend) / ls.total_spend) * 100
    ELSE NULL
  END AS roi_percentage,
  -- Also pull from deals table for more granular tracking
  COALESCE(d.deal_count, 0) AS deal_count,
  COALESCE(d.funded_count, 0) AS funded_deal_count,
  COALESCE(d.total_amount_funded, 0) AS total_amount_funded
FROM lead_sources ls
LEFT JOIN LATERAL (
  SELECT
    COUNT(*) AS deal_count,
    COUNT(*) FILTER (WHERE deals.status = 'funded') AS funded_count,
    COALESCE(SUM(deals.amount_funded) FILTER (WHERE deals.status = 'funded'), 0) AS total_amount_funded
  FROM deals
  WHERE deals.lead_source = ls.name
) d ON true
WHERE ls.status = 'active';


-- ============================================================
-- View: v_pipeline_velocity — Avg days per stage
-- ============================================================
CREATE OR REPLACE VIEW v_pipeline_velocity AS
SELECT
  'new_to_contacted' AS stage_transition,
  AVG(EXTRACT(EPOCH FROM (contacted_at - created_at)) / 86400)
    FILTER (WHERE contacted_at IS NOT NULL) AS avg_days,
  COUNT(*) FILTER (WHERE contacted_at IS NOT NULL) AS sample_size
FROM deals
UNION ALL
SELECT
  'contacted_to_qualified',
  AVG(EXTRACT(EPOCH FROM (qualified_at - contacted_at)) / 86400)
    FILTER (WHERE qualified_at IS NOT NULL AND contacted_at IS NOT NULL),
  COUNT(*) FILTER (WHERE qualified_at IS NOT NULL AND contacted_at IS NOT NULL)
FROM deals
UNION ALL
SELECT
  'qualified_to_app_sent',
  AVG(EXTRACT(EPOCH FROM (application_sent_at - qualified_at)) / 86400)
    FILTER (WHERE application_sent_at IS NOT NULL AND qualified_at IS NOT NULL),
  COUNT(*) FILTER (WHERE application_sent_at IS NOT NULL AND qualified_at IS NOT NULL)
FROM deals
UNION ALL
SELECT
  'app_sent_to_docs',
  AVG(EXTRACT(EPOCH FROM (docs_collected_at - application_sent_at)) / 86400)
    FILTER (WHERE docs_collected_at IS NOT NULL AND application_sent_at IS NOT NULL),
  COUNT(*) FILTER (WHERE docs_collected_at IS NOT NULL AND application_sent_at IS NOT NULL)
FROM deals
UNION ALL
SELECT
  'docs_to_submitted',
  AVG(EXTRACT(EPOCH FROM (submitted_at - docs_collected_at)) / 86400)
    FILTER (WHERE submitted_at IS NOT NULL AND docs_collected_at IS NOT NULL),
  COUNT(*) FILTER (WHERE submitted_at IS NOT NULL AND docs_collected_at IS NOT NULL)
FROM deals
UNION ALL
SELECT
  'submitted_to_offer',
  AVG(EXTRACT(EPOCH FROM (offer_received_at - submitted_at)) / 86400)
    FILTER (WHERE offer_received_at IS NOT NULL AND submitted_at IS NOT NULL),
  COUNT(*) FILTER (WHERE offer_received_at IS NOT NULL AND submitted_at IS NOT NULL)
FROM deals
UNION ALL
SELECT
  'offer_to_funded',
  AVG(EXTRACT(EPOCH FROM (funded_at - offer_presented_at)) / 86400)
    FILTER (WHERE funded_at IS NOT NULL AND offer_presented_at IS NOT NULL),
  COUNT(*) FILTER (WHERE funded_at IS NOT NULL AND offer_presented_at IS NOT NULL)
FROM deals
UNION ALL
SELECT
  'total_lead_to_funded',
  AVG(EXTRACT(EPOCH FROM (funded_at - created_at)) / 86400)
    FILTER (WHERE funded_at IS NOT NULL),
  COUNT(*) FILTER (WHERE funded_at IS NOT NULL)
FROM deals;


-- ============================================================
-- View: v_closer_performance — Closer performance scorecard
-- References profiles table (which exists) via assigned_closer_id
-- ============================================================
CREATE OR REPLACE VIEW v_closer_performance AS
SELECT
  d.assigned_closer_id AS closer_id,
  COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, '') AS closer_name,
  COUNT(*) AS total_leads_assigned,
  COUNT(*) FILTER (WHERE d.status = 'funded') AS total_deals_funded,
  COUNT(*) FILTER (WHERE d.status = 'declined' OR d.status = 'dead') AS total_deals_lost,
  CASE WHEN COUNT(*) > 0
    THEN (COUNT(*) FILTER (WHERE d.status = 'funded')::NUMERIC / COUNT(*)) * 100
    ELSE 0
  END AS close_rate,
  COALESCE(SUM(d.amount_funded) FILTER (WHERE d.status = 'funded'), 0) AS total_revenue,
  COALESCE(AVG(d.amount_funded) FILTER (WHERE d.status = 'funded'), 0) AS avg_deal_size,
  AVG(EXTRACT(EPOCH FROM (d.funded_at - d.created_at)) / 86400)
    FILTER (WHERE d.funded_at IS NOT NULL) AS avg_days_to_fund,
  -- Monthly breakdown for current month
  COUNT(*) FILTER (WHERE d.status = 'funded' AND d.funded_at >= date_trunc('month', CURRENT_DATE)) AS deals_this_month,
  COALESCE(SUM(d.amount_funded) FILTER (WHERE d.status = 'funded' AND d.funded_at >= date_trunc('month', CURRENT_DATE)), 0) AS revenue_this_month
FROM deals d
JOIN profiles p ON d.assigned_closer_id = p.id
WHERE d.assigned_closer_id IS NOT NULL
GROUP BY d.assigned_closer_id, p.first_name, p.last_name;


-- ============================================================
-- View: v_lender_approval_rates — Lender approval rates
-- ============================================================
CREATE OR REPLACE VIEW v_lender_approval_rates AS
SELECT
  l.id AS lender_id,
  l.company_name AS lender_name,
  COUNT(ds.id) AS total_submissions,
  COUNT(ds.id) FILTER (WHERE ds.status IN ('approved', 'offer_made', 'offer_accepted', 'funded')) AS total_approved,
  COUNT(ds.id) FILTER (WHERE ds.status = 'declined') AS total_declined,
  COUNT(ds.id) FILTER (WHERE ds.status = 'funded') AS total_funded,
  CASE WHEN COUNT(ds.id) > 0
    THEN (COUNT(ds.id) FILTER (WHERE ds.status IN ('approved', 'offer_made', 'offer_accepted', 'funded'))::NUMERIC / COUNT(ds.id)) * 100
    ELSE 0
  END AS approval_rate,
  COALESCE(AVG(ds.offer_amount) FILTER (WHERE ds.offer_amount IS NOT NULL), 0) AS avg_offer_amount,
  COALESCE(AVG(ds.factor_rate) FILTER (WHERE ds.factor_rate IS NOT NULL), 0) AS avg_factor_rate,
  COALESCE(AVG(ds.commission_points) FILTER (WHERE ds.commission_points IS NOT NULL), 0) AS avg_commission_points,
  AVG(EXTRACT(EPOCH FROM (ds.response_at - ds.submitted_at)) / 86400)
    FILTER (WHERE ds.response_at IS NOT NULL AND ds.submitted_at IS NOT NULL) AS avg_response_days
FROM lenders l
LEFT JOIN deal_submissions ds ON ds.lender_id = l.id
GROUP BY l.id, l.company_name;


-- ============================================================
-- View: v_monthly_revenue — Monthly revenue summary
-- ============================================================
CREATE OR REPLACE VIEW v_monthly_revenue AS
SELECT
  date_trunc('month', d.funded_at) AS month,
  COUNT(*) AS deals_funded,
  COALESCE(SUM(d.amount_funded), 0) AS total_funded_amount,
  COALESCE(AVG(d.amount_funded), 0) AS avg_deal_size,
  -- Count by deal type
  COUNT(*) FILTER (WHERE d.deal_type = 'mca') AS mca_deals,
  COUNT(*) FILTER (WHERE d.deal_type = 'term_loan') AS term_loan_deals,
  COUNT(*) FILTER (WHERE d.deal_type = 'line_of_credit') AS loc_deals,
  COUNT(*) FILTER (WHERE d.deal_type = 'sba') AS sba_deals,
  COUNT(*) FILTER (WHERE d.deal_type = 'equipment_financing') AS equipment_deals,
  -- Renewal vs new
  COUNT(*) FILTER (WHERE d.is_renewal = true) AS renewal_deals,
  COUNT(*) FILTER (WHERE d.is_renewal = false OR d.is_renewal IS NULL) AS new_deals
FROM deals d
WHERE d.status = 'funded' AND d.funded_at IS NOT NULL
GROUP BY date_trunc('month', d.funded_at)
ORDER BY month DESC;


-- ============================================================
-- View: v_market_performance — Market performance comparison
-- ============================================================
CREATE OR REPLACE VIEW v_market_performance AS
SELECT
  d.market,
  COUNT(*) AS total_leads,
  COUNT(*) FILTER (WHERE d.status = 'funded') AS total_funded,
  COUNT(*) FILTER (WHERE d.status IN ('declined', 'dead')) AS total_lost,
  CASE WHEN COUNT(*) > 0
    THEN (COUNT(*) FILTER (WHERE d.status = 'funded')::NUMERIC / COUNT(*)) * 100
    ELSE 0
  END AS close_rate,
  COALESCE(SUM(d.amount_funded) FILTER (WHERE d.status = 'funded'), 0) AS total_revenue,
  COALESCE(AVG(d.amount_funded) FILTER (WHERE d.status = 'funded'), 0) AS avg_deal_size,
  AVG(EXTRACT(EPOCH FROM (d.funded_at - d.created_at)) / 86400)
    FILTER (WHERE d.funded_at IS NOT NULL) AS avg_days_to_fund,
  -- This month
  COUNT(*) FILTER (WHERE d.created_at >= date_trunc('month', CURRENT_DATE)) AS leads_this_month,
  COUNT(*) FILTER (WHERE d.status = 'funded' AND d.funded_at >= date_trunc('month', CURRENT_DATE)) AS funded_this_month
FROM deals d
WHERE d.market IS NOT NULL
GROUP BY d.market
ORDER BY total_funded DESC;
