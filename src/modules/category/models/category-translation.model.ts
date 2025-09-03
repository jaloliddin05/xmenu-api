import { Category } from "./category.model"

export class CategoryTranslation {
    id: string
    lang:  string
    title:  string
    category:  Category
    category_id:  string
    created_at:  string | Date
}
