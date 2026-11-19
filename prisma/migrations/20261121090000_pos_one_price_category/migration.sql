-- One price category for the venue (docs/IIKO.md, decision 4): the branch has none of its own
ALTER TABLE "pos_branch_link" DROP COLUMN "price_category_id";
