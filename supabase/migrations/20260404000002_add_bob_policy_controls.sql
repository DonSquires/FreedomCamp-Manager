-- Bob policy controls for configurable escalation behavior.
-- Keeps escalation keywords data-driven so Grand Master can tune rules
-- without redeploying edge functions.

CREATE TABLE IF NOT EXISTS bob_policy_controls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  singleton_key text NOT NULL UNIQUE DEFAULT 'default',
  escalation_keywords text[] NOT NULL DEFAULT ARRAY[
    'illegal',
    'break the law',
    'privacy breach',
    'unauthorized access',
    'steal',
    'hack',
    'cover up',
    'hide evidence',
    'tamper',
    'forge',
    'falsify',
    'dox',
    'blackmail',
    'bribe',
    'harass'
  ],
  updated_by uuid NULL REFERENCES user_profiles(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO bob_policy_controls (singleton_key)
VALUES ('default')
ON CONFLICT (singleton_key) DO NOTHING;
