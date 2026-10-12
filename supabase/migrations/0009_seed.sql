-- Day-one data. Mirrors src/lib/contracts/catalog.ts exactly (supabase/tests/seed.test.ts
-- compares every field) plus companies, verksamhet/kontogrupp values and settings.

insert into public.companies (id, code, legal_name, short_name, org_nr, fiscal_start_month) values
  (1, 'MBAB', 'Miljonbemanning AB', 'MB AB', '556959-9318', 1),
  (2, 'MBR', 'Miljonbemanning Restart AB', 'MB Restart', '559208-9071', 1);

insert into public.dimensions (key, label, is_personal, unknown_policy) values
  ('verksamhet', 'Verksamhet', false, 'ask'),
  ('kund', 'Kund', false, 'ask'),
  ('uppdrag', 'Uppdrag', false, 'auto_create'),
  ('kostnadsstalle', 'Kostnadsställe', false, 'auto_create'),
  ('ort', 'Ort', false, 'auto_create'),
  ('konsult', 'Konsult', true, 'auto_create'),
  ('franvarotyp', 'Frånvarotyp', false, 'auto_create'),
  ('resultattyp', 'Resultat', false, 'auto_create'),
  ('ordertyp', 'Ordertyp', false, 'auto_create'),
  ('kontogrupp', 'Kontogrupp', false, 'ask');

insert into public.datasets (key, name, kind) values
  ('ip_timmar', 'Intelliplan – timmar och pass', 'table'),
  ('ip_franvaro', 'Intelliplan – frånvaro', 'table'),
  ('ip_fakturering', 'Intelliplan – fakturerat och lön', 'table'),
  ('ip_konsulter', 'Intelliplan – konsultlista', 'cases'),
  ('wb_deltagare', 'Workbuster – deltagare', 'cases'),
  ('wb_ordrar', 'Workbuster – ordrar', 'table'),
  ('fx_bokforing', 'Fortnox – bokföring (SIE4)', 'ledger'),
  ('fx_kundforsaljning', 'Fortnox – försäljning per kund', 'table'),
  ('budget', 'Budget', 'table');

insert into public.dataset_dimensions (dataset_id, dimension_id)
select ds.id, dim.id
from (values
  ('ip_timmar', 'kund'),
  ('ip_timmar', 'uppdrag'),
  ('ip_timmar', 'konsult'),
  ('ip_timmar', 'verksamhet'),
  ('ip_franvaro', 'kund'),
  ('ip_franvaro', 'uppdrag'),
  ('ip_franvaro', 'konsult'),
  ('ip_franvaro', 'franvarotyp'),
  ('ip_fakturering', 'kund'),
  ('ip_fakturering', 'uppdrag'),
  ('ip_fakturering', 'konsult'),
  ('ip_konsulter', 'ort'),
  ('wb_deltagare', 'verksamhet'),
  ('wb_deltagare', 'ort'),
  ('wb_deltagare', 'resultattyp'),
  ('wb_ordrar', 'verksamhet'),
  ('wb_ordrar', 'ordertyp'),
  ('wb_ordrar', 'ort'),
  ('fx_bokforing', 'kostnadsstalle'),
  ('fx_kundforsaljning', 'kund'),
  ('budget', 'kontogrupp'),
  ('budget', 'kostnadsstalle')
) as v (dataset_key, dimension_key)
join public.datasets ds on ds.key = v.dataset_key
join public.dimensions dim on dim.key = v.dimension_key;

insert into public.account_groups (key, name, sign, sort) values
  ('intakter', 'Intäkter', -1, 1),
  ('varor_ul', 'Varor och underleverantörer', 1, 2),
  ('ovriga_externa', 'Övriga externa kostnader', 1, 3),
  ('personal', 'Personalkostnader', 1, 4),
  ('avskrivningar', 'Avskrivningar', 1, 5),
  ('kostnader', 'Rörelsens kostnader', 1, 6),
  ('finansiella', 'Finansiella poster', -1, 7),
  ('bokslut_skatt', 'Bokslutsdispositioner och skatt', -1, 8),
  ('resultat', 'Resultat', -1, 9);

insert into public.account_group_ranges (group_key, from_account, to_account) values
  ('intakter', 3000, 3999),
  ('varor_ul', 4000, 4999),
  ('ovriga_externa', 5000, 6999),
  ('personal', 7000, 7699),
  ('avskrivningar', 7700, 7899),
  ('kostnader', 4000, 7999),
  ('finansiella', 8000, 8799),
  ('bokslut_skatt', 8800, 8999),
  ('resultat', 3000, 8999);

-- One statement per metric, in catalog order, so distinct metrics can look up their
-- base metric.
insert into public.metrics (key, name, unit, kind, dataset_id, higher_is_better, decimals,
  description, headline_subject, snapshot_rollup, base_metric_id, distinct_dimension_id,
  account_group_key, formula, is_system)
select 'timmar', 'Fakturerade timmar', 'h', 'sum',
  (select id from public.datasets where key = 'ip_timmar'),
  true, 0,
  'Attesterade och exporterade timmar.',
  'TIMMARNA', null,
  null,
  null,
  null, null, true;
insert into public.metrics (key, name, unit, kind, dataset_id, higher_is_better, decimals,
  description, headline_subject, snapshot_rollup, base_metric_id, distinct_dimension_id,
  account_group_key, formula, is_system)
select 'pass', 'Pass', 'st', 'sum',
  (select id from public.datasets where key = 'ip_timmar'),
  true, 0,
  'Antal arbetade pass.',
  'PASSEN', null,
  null,
  null,
  null, null, true;
insert into public.metrics (key, name, unit, kind, dataset_id, higher_is_better, decimals,
  description, headline_subject, snapshot_rollup, base_metric_id, distinct_dimension_id,
  account_group_key, formula, is_system)
select 'konsulter', 'Konsulter i arbete', 'st', 'distinct',
  (select id from public.datasets where key = 'ip_timmar'),
  true, 0,
  'Unika konsulter (räknas på anställnings-id) med timmar i perioden.',
  'KONSULTERNA', null,
  (select id from public.metrics where key = 'timmar'),
  (select id from public.dimensions where key = 'konsult'),
  null, null, true;
insert into public.metrics (key, name, unit, kind, dataset_id, higher_is_better, decimals,
  description, headline_subject, snapshot_rollup, base_metric_id, distinct_dimension_id,
  account_group_key, formula, is_system)
select 'sjuktimmar', 'Sjuktimmar', 'h', 'sum',
  (select id from public.datasets where key = 'ip_franvaro'),
  false, 0,
  'Timmar med sjukfrånvaro.',
  'SJUKTIMMARNA', null,
  null,
  null,
  null, null, true;
insert into public.metrics (key, name, unit, kind, dataset_id, higher_is_better, decimals,
  description, headline_subject, snapshot_rollup, base_metric_id, distinct_dimension_id,
  account_group_key, formula, is_system)
select 'sjukpass', 'Sjukpass', 'st', 'sum',
  (select id from public.datasets where key = 'ip_franvaro'),
  false, 0,
  'Antal pass med sjukfrånvaro.',
  'SJUKPASSEN', null,
  null,
  null,
  null, null, true;
insert into public.metrics (key, name, unit, kind, dataset_id, higher_is_better, decimals,
  description, headline_subject, snapshot_rollup, base_metric_id, distinct_dimension_id,
  account_group_key, formula, is_system)
select 'fakturerat_ip', 'Fakturerat (Intelliplan)', 'kr', 'sum',
  (select id from public.datasets where key = 'ip_fakturering'),
  true, 0,
  'Fakturerat belopp enligt fakturaunderlaget.',
  'FAKTURERINGEN', null,
  null,
  null,
  null, null, true;
insert into public.metrics (key, name, unit, kind, dataset_id, higher_is_better, decimals,
  description, headline_subject, snapshot_rollup, base_metric_id, distinct_dimension_id,
  account_group_key, formula, is_system)
select 'lonekostnad', 'Lönekostnad', 'kr', 'sum',
  (select id from public.datasets where key = 'ip_fakturering'),
  false, 0,
  'Lönekostnad enligt löneunderlaget.',
  'LÖNEKOSTNADEN', null,
  null,
  null,
  null, null, true;
insert into public.metrics (key, name, unit, kind, dataset_id, higher_is_better, decimals,
  description, headline_subject, snapshot_rollup, base_metric_id, distinct_dimension_id,
  account_group_key, formula, is_system)
select 'anstallda_konsulter', 'Anställda konsulter', 'st', 'snapshot',
  (select id from public.datasets where key = 'ip_konsulter'),
  true, 0,
  'Konsulter med aktiv anställning vid månadens slut.',
  'ANTALET ANSTÄLLDA', 'last',
  null,
  null,
  null, null, true;
insert into public.metrics (key, name, unit, kind, dataset_id, higher_is_better, decimals,
  description, headline_subject, snapshot_rollup, base_metric_id, distinct_dimension_id,
  account_group_key, formula, is_system)
select 'nyanstallda', 'Nyanställda konsulter', 'st', 'sum',
  (select id from public.datasets where key = 'ip_konsulter'),
  true, 0,
  'Anställningar som startat under perioden.',
  'NYANSTÄLLNINGARNA', null,
  null,
  null,
  null, null, true;
insert into public.metrics (key, name, unit, kind, dataset_id, higher_is_better, decimals,
  description, headline_subject, snapshot_rollup, base_metric_id, distinct_dimension_id,
  account_group_key, formula, is_system)
select 'avslutade_anstallningar', 'Avslutade anställningar', 'st', 'sum',
  (select id from public.datasets where key = 'ip_konsulter'),
  false, 0,
  'Anställningar som avslutats under perioden.',
  'AVSLUTEN', null,
  null,
  null,
  null, null, true;
insert into public.metrics (key, name, unit, kind, dataset_id, higher_is_better, decimals,
  description, headline_subject, snapshot_rollup, base_metric_id, distinct_dimension_id,
  account_group_key, formula, is_system)
select 'anstallningsmanader', 'Anställningsmånader', 'man', 'snapshot',
  (select id from public.datasets where key = 'ip_konsulter'),
  null, 0,
  'Summa anställningstid i månader för aktiva anställningar vid månadens slut.',
  'ANSTÄLLNINGSMÅNADERNA', 'last',
  null,
  null,
  null, null, true;
insert into public.metrics (key, name, unit, kind, dataset_id, higher_is_better, decimals,
  description, headline_subject, snapshot_rollup, base_metric_id, distinct_dimension_id,
  account_group_key, formula, is_system)
select 'aktiva_deltagare', 'Aktiva deltagare', 'st', 'snapshot',
  (select id from public.datasets where key = 'wb_deltagare'),
  true, 0,
  'Deltagare utan avbrott med pågående placering vid månadens slut.',
  'DELTAGARNA', 'last',
  null,
  null,
  null, null, true;
insert into public.metrics (key, name, unit, kind, dataset_id, higher_is_better, decimals,
  description, headline_subject, snapshot_rollup, base_metric_id, distinct_dimension_id,
  account_group_key, formula, is_system)
select 'nya_deltagare', 'Nya deltagare', 'st', 'sum',
  (select id from public.datasets where key = 'wb_deltagare'),
  true, 0,
  'Deltagare som startat under perioden.',
  'NYA DELTAGARE', null,
  null,
  null,
  null, null, true;
insert into public.metrics (key, name, unit, kind, dataset_id, higher_is_better, decimals,
  description, headline_subject, snapshot_rollup, base_metric_id, distinct_dimension_id,
  account_group_key, formula, is_system)
select 'avslutade_deltagare', 'Avslutade deltagare', 'st', 'sum',
  (select id from public.datasets where key = 'wb_deltagare'),
  null, 0,
  'Deltagare som avslutat under perioden.',
  'AVSLUTEN', null,
  null,
  null,
  null, null, true;
insert into public.metrics (key, name, unit, kind, dataset_id, higher_is_better, decimals,
  description, headline_subject, snapshot_rollup, base_metric_id, distinct_dimension_id,
  account_group_key, formula, is_system)
select 'avbrott_deltagare', 'Avbrott', 'st', 'sum',
  (select id from public.datasets where key = 'wb_deltagare'),
  false, 0,
  'Deltagare med avbrott under perioden.',
  'AVBROTTEN', null,
  null,
  null,
  null, null, true;
insert into public.metrics (key, name, unit, kind, dataset_id, higher_is_better, decimals,
  description, headline_subject, snapshot_rollup, base_metric_id, distinct_dimension_id,
  account_group_key, formula, is_system)
select 'resultat_deltagare', 'Till arbete eller studier', 'st', 'sum',
  (select id from public.datasets where key = 'wb_deltagare'),
  true, 0,
  'Avslutade deltagare med resultat arbete eller studier.',
  'RESULTATEN', null,
  null,
  null,
  null, null, true;
insert into public.metrics (key, name, unit, kind, dataset_id, higher_is_better, decimals,
  description, headline_subject, snapshot_rollup, base_metric_id, distinct_dimension_id,
  account_group_key, formula, is_system)
select 'af_intakt', 'AF-ersättning', 'kr', 'sum',
  (select id from public.datasets where key = 'wb_ordrar'),
  true, 0,
  'Ersättning från Arbetsförmedlingen enligt ordrarna.',
  'AF-ERSÄTTNINGEN', null,
  null,
  null,
  null, null, true;
insert into public.metrics (key, name, unit, kind, dataset_id, higher_is_better, decimals,
  description, headline_subject, snapshot_rollup, base_metric_id, distinct_dimension_id,
  account_group_key, formula, is_system)
select 'intakter', 'Intäkter', 'kr', 'ledger',
  (select id from public.datasets where key = 'fx_bokforing'),
  true, 0,
  'Konto 3000–3999.',
  'INTÄKTERNA', null,
  null,
  null,
  'intakter', null, true;
insert into public.metrics (key, name, unit, kind, dataset_id, higher_is_better, decimals,
  description, headline_subject, snapshot_rollup, base_metric_id, distinct_dimension_id,
  account_group_key, formula, is_system)
select 'varor_ul', 'Varor och underleverantörer', 'kr', 'ledger',
  (select id from public.datasets where key = 'fx_bokforing'),
  false, 0,
  'Konto 4000–4999.',
  'UL-KOSTNADERNA', null,
  null,
  null,
  'varor_ul', null, true;
insert into public.metrics (key, name, unit, kind, dataset_id, higher_is_better, decimals,
  description, headline_subject, snapshot_rollup, base_metric_id, distinct_dimension_id,
  account_group_key, formula, is_system)
select 'ovriga_externa', 'Övriga externa kostnader', 'kr', 'ledger',
  (select id from public.datasets where key = 'fx_bokforing'),
  false, 0,
  'Konto 5000–6999.',
  'DE EXTERNA KOSTNADERNA', null,
  null,
  null,
  'ovriga_externa', null, true;
insert into public.metrics (key, name, unit, kind, dataset_id, higher_is_better, decimals,
  description, headline_subject, snapshot_rollup, base_metric_id, distinct_dimension_id,
  account_group_key, formula, is_system)
select 'personal', 'Personalkostnader', 'kr', 'ledger',
  (select id from public.datasets where key = 'fx_bokforing'),
  false, 0,
  'Konto 7000–7699.',
  'PERSONALKOSTNADERNA', null,
  null,
  null,
  'personal', null, true;
insert into public.metrics (key, name, unit, kind, dataset_id, higher_is_better, decimals,
  description, headline_subject, snapshot_rollup, base_metric_id, distinct_dimension_id,
  account_group_key, formula, is_system)
select 'avskrivningar', 'Avskrivningar', 'kr', 'ledger',
  (select id from public.datasets where key = 'fx_bokforing'),
  false, 0,
  'Konto 7700–7899.',
  'AVSKRIVNINGARNA', null,
  null,
  null,
  'avskrivningar', null, true;
insert into public.metrics (key, name, unit, kind, dataset_id, higher_is_better, decimals,
  description, headline_subject, snapshot_rollup, base_metric_id, distinct_dimension_id,
  account_group_key, formula, is_system)
select 'kostnader', 'Rörelsens kostnader', 'kr', 'ledger',
  (select id from public.datasets where key = 'fx_bokforing'),
  false, 0,
  'Konto 4000–7999.',
  'KOSTNADERNA', null,
  null,
  null,
  'kostnader', null, true;
insert into public.metrics (key, name, unit, kind, dataset_id, higher_is_better, decimals,
  description, headline_subject, snapshot_rollup, base_metric_id, distinct_dimension_id,
  account_group_key, formula, is_system)
select 'finansiella', 'Finansiella poster', 'kr', 'ledger',
  (select id from public.datasets where key = 'fx_bokforing'),
  true, 0,
  'Konto 8000–8799, netto.',
  'FINANSNETTOT', null,
  null,
  null,
  'finansiella', null, true;
insert into public.metrics (key, name, unit, kind, dataset_id, higher_is_better, decimals,
  description, headline_subject, snapshot_rollup, base_metric_id, distinct_dimension_id,
  account_group_key, formula, is_system)
select 'resultat', 'Resultat', 'kr', 'ledger',
  (select id from public.datasets where key = 'fx_bokforing'),
  true, 0,
  'Periodens resultat, konto 3000–8999.',
  'RESULTATET', null,
  null,
  null,
  'resultat', null, true;
insert into public.metrics (key, name, unit, kind, dataset_id, higher_is_better, decimals,
  description, headline_subject, snapshot_rollup, base_metric_id, distinct_dimension_id,
  account_group_key, formula, is_system)
select 'fakturerat_kund', 'Fakturerat per kund', 'kr', 'sum',
  (select id from public.datasets where key = 'fx_kundforsaljning'),
  true, 0,
  'Kundfakturor exkl. moms enligt Fortnox.',
  'FAKTURERINGEN', null,
  null,
  null,
  null, null, true;
insert into public.metrics (key, name, unit, kind, dataset_id, higher_is_better, decimals,
  description, headline_subject, snapshot_rollup, base_metric_id, distinct_dimension_id,
  account_group_key, formula, is_system)
select 'budget_belopp', 'Budget', 'kr', 'sum',
  (select id from public.datasets where key = 'budget'),
  null, 0,
  'Budgeterat belopp per kontogrupp. Används som budget för bokföringsmåtten.',
  'BUDGETEN', null,
  null,
  null,
  null, null, true;
insert into public.metrics (key, name, unit, kind, dataset_id, higher_is_better, decimals,
  description, headline_subject, snapshot_rollup, base_metric_id, distinct_dimension_id,
  account_group_key, formula, is_system)
select 'faktor', 'Faktor', 'faktor', 'formula',
  null,
  true, 2,
  'Fakturerat ÷ lönekostnad. Lönepåslaget ändras i formeln.',
  'FAKTORN', null,
  null,
  null,
  null, 'fakturerat_ip / (lonekostnad * 1.0)', true;
insert into public.metrics (key, name, unit, kind, dataset_id, higher_is_better, decimals,
  description, headline_subject, snapshot_rollup, base_metric_id, distinct_dimension_id,
  account_group_key, formula, is_system)
select 'sjukfranvaro', 'Sjukfrånvaro', 'pct', 'formula',
  null,
  false, 1,
  'Sjuktimmar ÷ (fakturerade timmar + sjuktimmar).',
  'SJUKFRÅNVARON', null,
  null,
  null,
  null, 'sjuktimmar / (timmar + sjuktimmar) * 100', true;
insert into public.metrics (key, name, unit, kind, dataset_id, higher_is_better, decimals,
  description, headline_subject, snapshot_rollup, base_metric_id, distinct_dimension_id,
  account_group_key, formula, is_system)
select 'sjukpass_per_konsult', 'Sjukpass per konsult', 'st', 'formula',
  null,
  false, 2,
  'Sjukpass ÷ konsulter i arbete.',
  'SJUKPASSEN PER KONSULT', null,
  null,
  null,
  null, 'sjukpass / konsulter', true;
insert into public.metrics (key, name, unit, kind, dataset_id, higher_is_better, decimals,
  description, headline_subject, snapshot_rollup, base_metric_id, distinct_dimension_id,
  account_group_key, formula, is_system)
select 'timmar_per_konsult', 'Timmar per konsult', 'h', 'formula',
  null,
  true, 1,
  'Fakturerade timmar ÷ konsulter i arbete.',
  'TIMMARNA PER KONSULT', null,
  null,
  null,
  null, 'timmar / konsulter', true;
insert into public.metrics (key, name, unit, kind, dataset_id, higher_is_better, decimals,
  description, headline_subject, snapshot_rollup, base_metric_id, distinct_dimension_id,
  account_group_key, formula, is_system)
select 'intakt_per_konsult', 'Fakturerat per konsult', 'kr', 'formula',
  null,
  true, 0,
  'Fakturerat (Intelliplan) ÷ konsulter i arbete.',
  'FAKTURERINGEN PER KONSULT', null,
  null,
  null,
  null, 'fakturerat_ip / konsulter', true;
insert into public.metrics (key, name, unit, kind, dataset_id, higher_is_better, decimals,
  description, headline_subject, snapshot_rollup, base_metric_id, distinct_dimension_id,
  account_group_key, formula, is_system)
select 'resultatmarginal', 'Resultatmarginal', 'pct', 'formula',
  null,
  true, 1,
  'Resultat ÷ intäkter.',
  'MARGINALEN', null,
  null,
  null,
  null, 'resultat / intakter * 100', true;
insert into public.metrics (key, name, unit, kind, dataset_id, higher_is_better, decimals,
  description, headline_subject, snapshot_rollup, base_metric_id, distinct_dimension_id,
  account_group_key, formula, is_system)
select 'anstallningstid', 'Genomsnittlig anställningstid', 'man', 'formula',
  null,
  true, 1,
  'Anställningsmånader ÷ anställda konsulter vid månadens slut.',
  'ANSTÄLLNINGSTIDEN', null,
  null,
  null,
  null, 'anstallningsmanader / anstallda_konsulter', true;
insert into public.metrics (key, name, unit, kind, dataset_id, higher_is_better, decimals,
  description, headline_subject, snapshot_rollup, base_metric_id, distinct_dimension_id,
  account_group_key, formula, is_system)
select 'resultatandel', 'Andel till arbete eller studier', 'pct', 'formula',
  null,
  true, 1,
  'Till arbete eller studier ÷ avslutade deltagare.',
  'ANDELEN TILL ARBETE ELLER STUDIER', null,
  null,
  null,
  null, 'resultat_deltagare / avslutade_deltagare * 100', true;

insert into public.dimension_values (dimension_id, code, label, sort)
select dim.id, v.code, v.label, v.sort
from (values
  ('verksamhet', 'rom2', 'ROM2', 1),
  ('verksamhet', 'krom', 'KROM', 2),
  ('verksamhet', 'kvl', 'KVL', 3),
  ('verksamhet', 'karriärvägledning', 'Karriärvägledning', 4),
  ('verksamhet', 'stöd och matchning', 'Stöd och matchning', 5),
  ('verksamhet', 'bemanning', 'Bemanning', 6),
  ('kontogrupp', 'intakter', 'Intäkter', 1),
  ('kontogrupp', 'varor_ul', 'Varor och underleverantörer', 2),
  ('kontogrupp', 'ovriga_externa', 'Övriga externa kostnader', 3),
  ('kontogrupp', 'personal', 'Personalkostnader', 4),
  ('kontogrupp', 'avskrivningar', 'Avskrivningar', 5),
  ('kontogrupp', 'kostnader', 'Rörelsens kostnader', 6),
  ('kontogrupp', 'finansiella', 'Finansiella poster', 7),
  ('kontogrupp', 'bokslut_skatt', 'Bokslutsdispositioner och skatt', 8),
  ('kontogrupp', 'resultat', 'Resultat', 9)
) as v (dimension_key, code, label, sort)
join public.dimensions dim on dim.key = v.dimension_key;

insert into public.settings (key, value) values
  ('deviation_threshold_pct', '25'),
  ('min_engine_version', '1');
