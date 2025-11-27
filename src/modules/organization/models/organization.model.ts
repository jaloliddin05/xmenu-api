import { User } from "src/modules/user/models/user.modal"
import { OrganizationType } from '@prisma/client';

export enum OrganizationTypeEnum {
  Restaurant = 'restaurant',
  Cafe = 'cafe',
  FastFood = 'fast_food',
  CoffeeShop = 'coffee_shop',
  Other = 'other'
}

export function parseOrganizationType(input: string): OrganizationType {
  switch (input.toLowerCase()) {
    case "restaurant": return OrganizationType.restaurant;
    case "cafe": return OrganizationType.cafe;
    case "fast_food": return OrganizationType.fast_food;
    case "coffee_shop": return OrganizationType.cafe;
    case "other": return OrganizationType.other;
    default: throw new Error(`Invalid organization type: ${input}`);
  }
}

export class Organization {
  id:string
  url:string
  name: string
  isActive: boolean 
  created_at:string
  translations?:string
  owner_id?:string
  owner?: User
}