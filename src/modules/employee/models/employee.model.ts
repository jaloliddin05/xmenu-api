import { Organization } from "src/modules/organization/models/organization.model"

export class Employee {
    id: string
    first_name: string
    last_name: string
    phone: string
    password: string
    url: string
    status: string
    organization_id: string
    organization: Organization
    created_at: string | Date
}
