import { CategoryTranslation } from "./category-translation.model"

export class Category {
    id: string
    created_at:  string | Date
    translations: CategoryTranslation
}
