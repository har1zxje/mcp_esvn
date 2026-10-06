-- A Chat account has exactly one HRM employee in the current MVP. Company is
-- derived through that link, never selected by an HTTP/MCP caller. Fail with a
-- actionable message rather than a generic unique-constraint failure when a
-- legacy database still contains multiple links for the same Chat user.
DO $$
BEGIN
  IF EXISTS (
    SELECT chat_user_id
    FROM hrm_identity_links
    GROUP BY chat_user_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot enforce one HRM identity per Chat user: resolve duplicate hrm_identity_links.chat_user_id rows first.'
      USING ERRCODE = '23505';
  END IF;
END $$;

ALTER TABLE hrm_identity_links
  ADD CONSTRAINT hrm_identity_links_chat_user_unique UNIQUE (chat_user_id);
