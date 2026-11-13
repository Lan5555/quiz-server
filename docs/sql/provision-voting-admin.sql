-- Set this email to the exact VOTING_ADMIN_EMAIL configured on your backend.
-- This creates/enables the administrator; the password hash stays in backend configuration.
-- Run against the same PostgreSQL database/schema used by quiz-server.
BEGIN;
DO $provision_voting_admin$
DECLARE
  admin_email text := 'okekejohnson24@gmail.com';
  existing_id uuid;
BEGIN
  IF position('@' IN admin_email) <= 1 THEN
    RAISE EXCEPTION 'Replace REPLACE_WITH_VOTING_ADMIN_EMAIL with your configured admin email before running this script';
  END IF;
  admin_email := lower(btrim(admin_email));
  PERFORM pg_advisory_xact_lock(hashtextextended('voting-admin:' || admin_email, 0));
  IF (SELECT count(*) FROM voting_admins WHERE lower(btrim(email)) = admin_email) > 1 THEN
    RAISE EXCEPTION 'Multiple administrator records match this email; resolve duplicate records before provisioning';
  END IF;
  SELECT id INTO existing_id FROM voting_admins WHERE lower(btrim(email)) = admin_email FOR UPDATE;
  IF existing_id IS NULL THEN
    INSERT INTO voting_admins(id,email,name,enabled,can_manage_votes)
    VALUES(gen_random_uuid(),admin_email,'Administrator',true,true);
  ELSE
    UPDATE voting_admins SET enabled=true,can_manage_votes=true WHERE id=existing_id;
  END IF;
END;
$provision_voting_admin$;
COMMIT;
