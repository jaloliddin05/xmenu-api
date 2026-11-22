-- DELETE /organization/:id failed with a foreign key error for every venue (signup always writes the uz/ru
-- description translations). Every relation to organization now has an explicit onDelete; these two were RESTRICT.
ALTER TABLE "organization_translation" DROP CONSTRAINT "organization_translation_organization_id_fkey";
ALTER TABLE "organization_translation" ADD CONSTRAINT "organization_translation_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "employee" DROP CONSTRAINT "employee_organization_id_fkey";
ALTER TABLE "employee" ADD CONSTRAINT "employee_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
