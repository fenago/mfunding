-- Analytics views for dashboard performance
-- These pre-aggregate expensive analytical queries

-- Funnel snapshot view
CREATE OR REPLACE VIEW v_funnel_summary AS
SELECT
  status,
  COUNT(*) as count,
  COUNT(*) FILTER (WHERE is_live_transfer = true) as live_transfer_count,
  COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE) as today_count,
  COUNT(*) FILTER (WHERE created_at >= date_trunc('week', CURRENT_DATE)) as this_week_count,
  COUNT(*) FILTER (WHERE created_at >= date_trunc('month', CURRENT_DATE)) as this_month_count,
  AVG(amount_funded) FILTER (WHERE amount_funded IS NOT NULL) as avg_deal_size,
  SUM(amount_funded) FILTER (WHERE amount_funded IS NOT NULL) as total_funded
FROM customers
GROUP BY status;

-- Vendor performance view
CREATE OR REPLACE VIEW v_vendor_performance AS
SELECT
  mv.id as vendor_id,
  mv.vendor_name,
  mv.status as vendor_status,
  mv.cost_per_lead,
  mv.total_spend,
  mv.total_revenue,
  COUNT(c.id) as total_leads,
  COUNT(c.id) FILTER (WHERE c.status = 'funded') as funded_count,
  COUNT(c.id) FILTER (WHERE c.status = 'approved') as approved_count,
  COUNT(c.id) FILTER (WHERE c.status = 'declined') as declined_count,
  COUNT(c.id) FILTER (WHERE c.is_live_transfer = true) as live_transfer_leads,
  COUNT(c.id) FILTER (WHERE c.is_live_transfer = true AND c.status = 'funded') as live_transfer_funded,
  AVG(c.amount_funded) FILTER (WHERE c.amount_funded IS NOT NULL) as avg_deal_size,
  AVG(EXTRACT(EPOCH FROM (c.funded_at - c.created_at)) / 86400)
    FILTER (WHERE c.funded_at IS NOT NULL) as avg_days_to_fund
FROM marketing_vendors mv
LEFT JOIN customers c ON c.vendor_id = mv.id
GROUP BY mv.id, mv.vendor_name, mv.status, mv.cost_per_lead, mv.total_spend, mv.total_revenue;
