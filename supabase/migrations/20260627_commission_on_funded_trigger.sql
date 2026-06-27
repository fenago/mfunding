-- GHL is the source of truth for the pipeline stage. Commission creation must
-- therefore be source-agnostic: fire when a deal becomes funded whether that
-- happens in our app, via the ghl-webhook, or by a manual update.
CREATE OR REPLACE FUNCTION public.create_commission_on_funded()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_points NUMERIC;
  v_gross NUMERIC;
  v_closer_id UUID;
  v_split NUMERIC;
  v_closer_amt NUMERIC;
BEGIN
  IF NEW.status = 'funded'
     AND (OLD.status IS DISTINCT FROM 'funded')
     AND COALESCE(NEW.amount_funded, 0) > 0
     AND NOT EXISTS (SELECT 1 FROM commissions WHERE deal_id = NEW.id) THEN

    v_points := CASE WHEN NEW.is_renewal THEN 6 ELSE 8 END;
    v_gross := NEW.amount_funded * v_points / 100.0;

    SELECT id, COALESCE(company_lead_split, 50) INTO v_closer_id, v_split
      FROM closers WHERE user_id = NEW.assigned_closer_id LIMIT 1;

    IF v_closer_id IS NOT NULL THEN
      v_closer_amt := v_gross * COALESCE(v_split, 50) / 100.0;
    ELSE
      v_split := NULL;
      v_closer_amt := 0;
    END IF;

    INSERT INTO commissions (
      deal_id, gross_commission, commission_points, closer_id, closer_split_percentage,
      closer_amount, company_amount, payment_status, notes
    ) VALUES (
      NEW.id, v_gross, v_points, v_closer_id, v_split,
      v_closer_amt, v_gross - v_closer_amt, 'pending', 'Auto-created on funded (DB trigger)'
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS deals_commission_on_funded ON deals;
CREATE TRIGGER deals_commission_on_funded
  AFTER UPDATE ON deals
  FOR EACH ROW EXECUTE FUNCTION public.create_commission_on_funded();
