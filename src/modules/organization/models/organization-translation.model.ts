import { Organization } from "./organization.model"

export class OrganizationTranslation {
  id:string
  lang:string   
  title:string
  description:string
  organization: Organization
  organization_id:string
  created_at:string | Date
}