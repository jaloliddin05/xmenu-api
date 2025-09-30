import { User } from "src/modules/user/models/user.modal"

export enum OrganizationTypeEnum {
  Restaurant = 'restaurant',
  Cafe = 'cafe',
  FastFood = 'fast-food',
  CoffeeShop = 'coffee-shop',
  Other = 'other'
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