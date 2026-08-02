-- The facility is a single site at a single address, so neither the timezone
-- nor the address is a property of an individual apartment.
--
-- The timezone moves to FACILITY_TIMEZONE in the environment. It still matters
-- — curfews, med windows and pass returns are local times that cross midnight —
-- it is just facility-wide. If a second site in another zone ever opens, this
-- is the assumption to revisit.
ALTER TABLE "apartments"
  DROP COLUMN "timezone",
  DROP COLUMN "addressLine1",
  DROP COLUMN "unitNumber",
  DROP COLUMN "city",
  DROP COLUMN "state",
  DROP COLUMN "postalCode";
