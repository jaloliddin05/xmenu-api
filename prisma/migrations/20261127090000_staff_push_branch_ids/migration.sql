-- Branches whose orders a staff push device gets (ids, no foreign key); empty = all branches
ALTER TABLE "staff_push_subscription" ADD COLUMN "branch_ids" TEXT[] DEFAULT ARRAY[]::TEXT[];
