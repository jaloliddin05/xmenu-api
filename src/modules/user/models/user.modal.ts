import { Organization } from "src/modules/organization/models/organization.model";

export class User {
    id: string
    phone: string
    password?: string | null;
    email: string | null;
    first_name: string | null;
    last_name: string | null;
    isActive: boolean
    url?: string | null;
    createdAt?:  string | Date
    organization?: Organization
}