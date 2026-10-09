-- Keep enum addition in its own migration transaction. PostgreSQL requires
-- the transaction that adds an enum label to commit before policies use it.
alter type public.environment_role add value if not exists 'viewer';
