import { User } from "src/modules/user/models/user.modal"
import { OrganizationType } from '@prisma/client';

export enum OrganizationTypeEnum {
  Restaurant = 'restaurant',
  Cafe = 'cafe',
  FastFood = 'fast-food',
  CoffeeShop = 'coffee-shop',
  Other = 'other'
}

export function parseOrganizationType(input: string): OrganizationType {
  switch (input.toLowerCase()) {
    case "restaurant": return OrganizationType.Restaurant;
    case "cafe": return OrganizationType.Cafe;
    case "fast-food": return OrganizationType.FastFood;
    case "coffee-shop": return OrganizationType.CoffeeShop;
    case "other": return OrganizationType.Other;
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