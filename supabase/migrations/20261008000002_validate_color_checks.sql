-- Run after 20261008000001_color_persistence.sql. Validation uses a weaker
-- lock than adding and validating the checks in the first transaction.
begin;
set local lock_timeout = '5s';
alter table public.sections validate constraint moseek_sections_card_color_check;
commit;

begin;
set local lock_timeout = '5s';
alter table public.resources validate constraint moseek_resources_card_color_check;
commit;
