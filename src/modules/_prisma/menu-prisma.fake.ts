/**
 * In-memory Prisma for the menu tables (organization → category → product → option groups/options,
 * translations, files). Nested `where` filters are evaluated through the relations below, so an
 * ownership check like `{ product: { category: { organization_id } } }` is really tested, not just
 * asserted. Supports the query shapes the menu services use; anything else throws loudly.
 */
type Row = Record<string, any>;
/** `reverse`: a to-one relation whose foreign key is on the other table (pos_link) */
type Rel = { table: string; fk: string; many?: boolean; reverse?: boolean };

const posLink = (fk: string): Rel => ({
  table: 'pos_menu_link',
  fk,
  reverse: true,
});

const RELATIONS: Record<string, Record<string, Rel>> = {
  organization: {
    categories: { table: 'category', fk: 'organization_id', many: true },
    translations: {
      table: 'organization_translation',
      fk: 'organization_id',
      many: true,
    },
    logo: { table: 'file', fk: 'logo_id' },
    banner: { table: 'file', fk: 'banner_id' },
  },
  organization_translation: {
    organization: { table: 'organization', fk: 'organization_id' },
  },
  category: {
    organization: { table: 'organization', fk: 'organization_id' },
    translations: {
      table: 'category_translation',
      fk: 'category_id',
      many: true,
    },
    products: { table: 'product', fk: 'category_id', many: true },
    pos_link: posLink('category_id'),
  },
  category_translation: { category: { table: 'category', fk: 'category_id' } },
  product: {
    category: { table: 'category', fk: 'category_id' },
    translations: {
      table: 'product_translation',
      fk: 'product_id',
      many: true,
    },
    additional_product_groups: {
      table: 'additional_product_group',
      fk: 'product_id',
      many: true,
    },
    images: { table: 'file', fk: 'product_id', many: true },
    pos_link: posLink('product_id'),
  },
  product_translation: { product: { table: 'product', fk: 'product_id' } },
  additional_product_group: {
    product: { table: 'product', fk: 'product_id' },
    organization: { table: 'organization', fk: 'organization_id' },
    translations: {
      table: 'additional_product_group_translation',
      fk: 'additional_product_group_id',
      many: true,
    },
    additional_products: {
      table: 'additional_product',
      fk: 'additional_product_group_id',
      many: true,
    },
    pos_link: posLink('group_id'),
  },
  additional_product_group_translation: {
    additional_product_group: {
      table: 'additional_product_group',
      fk: 'additional_product_group_id',
    },
  },
  additional_product: {
    additional_product_group: {
      table: 'additional_product_group',
      fk: 'additional_product_group_id',
    },
    translations: {
      table: 'additional_product_translation',
      fk: 'additional_product_id',
      many: true,
    },
    pos_link: posLink('option_id'),
  },
  additional_product_translation: {
    additional_product: {
      table: 'additional_product',
      fk: 'additional_product_id',
    },
  },
  file: { product: { table: 'product', fk: 'product_id' } },
  // POS tables (modules/pos): empty unless a spec seeds them
  pos_integration: {
    branch_links: {
      table: 'pos_branch_link',
      fk: 'integration_id',
      many: true,
    },
    stop_items: { table: 'pos_stop_item', fk: 'integration_id', many: true },
  },
  pos_branch_link: {},
  pos_stop_item: {},
  pos_menu_link: {
    integration: { table: 'pos_integration', fk: 'integration_id' },
  },
};

function matchScalar(value: unknown, cond: unknown): boolean {
  if (cond === undefined) return true;
  if (cond !== null && typeof cond === 'object' && !Array.isArray(cond)) {
    const c = cond as Record<string, any>;
    if ('not' in c && value === c.not) return false;
    if ('in' in c && !c.in.includes(value)) return false;
    if ('notIn' in c && c.notIn.includes(value)) return false;
    if ('gt' in c && !((value as number) > c.gt)) return false;
    if ('gte' in c && !((value as number) >= c.gte)) return false;
    if ('lt' in c && !((value as number) < c.lt)) return false;
    if ('lte' in c && !((value as number) <= c.lte)) return false;
    return true;
  }
  return value === cond;
}

class FakeTable {
  constructor(
    private readonly db: FakeMenuPrisma,
    readonly name: string,
  ) {}

  get rows(): Row[] {
    return this.db.data[this.name];
  }

  findFirst = async (args: any = {}) => {
    const row = this.rows.find((r) =>
      this.db.matches(this.name, r, args.where ?? {}),
    );
    return row ? this.db.shape(this.name, row, args) : null;
  };

  findUnique = this.findFirst;

  findUniqueOrThrow = async (args: any) => {
    const row = await this.findFirst(args);
    if (!row) throw new Error(`${this.name} not found`);
    return row;
  };

  findMany = async (args: any = {}) =>
    this.rows
      .filter((r) => this.db.matches(this.name, r, args.where ?? {}))
      .map((r) => this.db.shape(this.name, r, args));

  create = async ({ data, ...rest }: any) => {
    const row: Row = { id: this.db.nextId(this.name) };
    this.rows.push(row);
    this.db.write(this.name, row, data);
    this.db.log.push({ table: this.name, op: 'create', id: row.id });
    return this.db.shape(this.name, row, rest);
  };

  update = async ({ where, data, ...rest }: any) => {
    const row = this.rows.find((r) => this.db.matches(this.name, r, where));
    if (!row) throw new Error(`${this.name} to update not found`);
    this.db.write(this.name, row, data);
    this.db.log.push({ table: this.name, op: 'update', id: row.id });
    return this.db.shape(this.name, row, rest);
  };

  updateMany = async ({ where, data }: any) => {
    const rows = this.rows.filter((r) =>
      this.db.matches(this.name, r, where ?? {}),
    );
    for (const r of rows) this.db.write(this.name, r, data);
    this.db.log.push({
      table: this.name,
      op: 'updateMany',
      ids: rows.map((r) => r.id),
    });
    return { count: rows.length };
  };

  deleteMany = async ({ where }: any = {}) => {
    const gone = this.rows.filter((r) =>
      this.db.matches(this.name, r, where ?? {}),
    );
    this.db.data[this.name] = this.rows.filter((r) => !gone.includes(r));
    this.db.log.push({
      table: this.name,
      op: 'deleteMany',
      ids: gone.map((r) => r.id),
    });
    return { count: gone.length };
  };

  count = async (args: any = {}) => (await this.findMany(args)).length;

  delete = async ({ where, ...rest }: any) => {
    const row = this.rows.find((r) => this.db.matches(this.name, r, where));
    if (!row) throw new Error(`${this.name} to delete not found`);
    const shaped = this.db.shape(this.name, row, rest);
    this.db.data[this.name] = this.rows.filter((r) => r !== row);
    this.db.log.push({ table: this.name, op: 'delete', id: row.id });
    return shaped;
  };
}

export class FakeMenuPrisma {
  data: Record<string, Row[]> = Object.fromEntries(
    Object.keys(RELATIONS).map((t) => [t, []]),
  );
  /** Every write, in order: lets a spec assert that a refused request changed nothing. */
  log: { table: string; op: string; id?: string; ids?: string[] }[] = [];
  private seq = 0;

  constructor() {
    for (const t of Object.keys(RELATIONS))
      (this as any)[t] = new FakeTable(this, t);
  }

  nextId(table: string) {
    return `${table}-${++this.seq}`;
  }

  /** Inserts a row as-is (test setup; not logged). */
  seed(table: string, row: Row): Row & { id: string } {
    const r = { id: this.nextId(table), ...row };
    this.data[table].push(r);
    return r;
  }

  async $transaction(arg: any) {
    if (typeof arg === 'function') return arg(this);
    return Promise.all(arg);
  }

  matches(table: string, row: Row, where: Record<string, any>): boolean {
    for (const [key, cond] of Object.entries(where)) {
      if (cond === undefined) continue;
      if (key === 'AND' || key === 'OR') {
        const parts = (cond as Record<string, any>[]).map((c) =>
          this.matches(table, row, c),
        );
        if (key === 'AND' ? parts.includes(false) : !parts.includes(true))
          return false;
        continue;
      }
      const rel = RELATIONS[table][key];
      if (!rel) {
        if (!matchScalar(row[key], cond)) return false;
        continue;
      }
      if (rel.many)
        throw new Error(
          `FakeMenuPrisma: filter on to-many ${table}.${key} not supported`,
        );
      const parent = this.related(rel, row);
      if (cond === null) {
        if (parent) return false;
        continue;
      }
      if (!parent || !this.matches(rel.table, parent, cond)) return false;
    }
    return true;
  }

  /** The row a to-one relation points at (or, reversed, the row pointing back). */
  related(rel: Rel, row: Row): Row | undefined {
    return rel.reverse
      ? this.data[rel.table].find((r) => r[rel.fk] === row.id)
      : this.data[rel.table].find((r) => r.id === row[rel.fk]);
  }

  shape(table: string, row: Row, args: { include?: any; select?: any }): Row {
    const out: Row = { ...row };
    // Relations can be loaded through `include` or named inside `select`
    const include = { ...(args.include ?? {}) };
    for (const [key, sub] of Object.entries(args.select ?? {})) {
      if (RELATIONS[table][key]) include[key] = sub;
    }
    for (const [key, sub] of Object.entries(include)) {
      if (!sub) continue;
      const rel = RELATIONS[table][key];
      if (!rel)
        throw new Error(`FakeMenuPrisma: unknown relation ${table}.${key}`);
      const subArgs = typeof sub === 'object' ? (sub as any) : {};
      if (rel.many) {
        out[key] = this.data[rel.table]
          .filter(
            (r) =>
              r[rel.fk] === row.id &&
              this.matches(rel.table, r, subArgs.where ?? {}),
          )
          .map((r) => this.shape(rel.table, r, subArgs));
      } else {
        const parent = this.related(rel, row);
        out[key] = parent ? this.shape(rel.table, parent, subArgs) : null;
      }
    }
    if (args.select) {
      return Object.fromEntries(
        Object.keys(args.select)
          .filter((k) => args.select[k])
          .map((k) => [k, out[k]]),
      );
    }
    return out;
  }

  write(table: string, row: Row, data: Record<string, any>) {
    for (const [key, value] of Object.entries(data ?? {})) {
      if (value === undefined) continue;
      const rel = RELATIONS[table][key];
      if (!rel) {
        if (value && typeof value === 'object' && 'increment' in value)
          row[key] = (row[key] ?? 0) + value.increment;
        else if (value && typeof value === 'object' && 'decrement' in value)
          row[key] = (row[key] ?? 0) - value.decrement;
        else row[key] = value;
        continue;
      }
      if (rel.many) {
        for (const child of value.create ?? []) {
          this.data[rel.table].push({
            id: this.nextId(rel.table),
            ...child,
            [rel.fk]: row.id,
          });
        }
        for (const { id } of value.connect ?? []) {
          const child = this.data[rel.table].find((r) => r.id === id);
          if (!child)
            throw new Error(
              `FakeMenuPrisma: connect to missing ${rel.table} ${id}`,
            );
          child[rel.fk] = row.id;
        }
      } else if (value.connect) {
        if (!this.data[rel.table].some((r) => r.id === value.connect.id)) {
          throw new Error(
            `FakeMenuPrisma: connect to missing ${rel.table} ${value.connect.id}`,
          );
        }
        row[rel.fk] = value.connect.id;
      }
    }
  }
}

/** Two tenants with one product each, plus an option group and option under each product. */
export function seedTwoTenants(db: FakeMenuPrisma) {
  const make = (name: string) => {
    const org = db.seed('organization', {
      name,
      slug: name.toLowerCase(),
      owner_id: `owner-${name}`,
    });
    const category = db.seed('category', {
      organization_id: org.id,
      index: 1,
      is_active: true,
    });
    const categoryTr = db.seed('category_translation', {
      category_id: category.id,
      lang: 'ru',
      title: `${name} cat`,
    });
    const product = db.seed('product', {
      category_id: category.id,
      index: 1,
      price: 100,
      is_active: true,
    });
    const productTr = db.seed('product_translation', {
      product_id: product.id,
      lang: 'ru',
      title: `${name} dish`,
    });
    const image = db.seed('file', {
      product_id: product.id,
      url: `/img/${name}.png`,
    });
    const group = db.seed('additional_product_group', {
      product_id: product.id,
      organization_id: org.id,
      is_multiple: false,
    });
    const groupTr = db.seed('additional_product_group_translation', {
      additional_product_group_id: group.id,
      lang: 'ru',
      title: `${name} sauces`,
    });
    const option = db.seed('additional_product', {
      additional_product_group_id: group.id,
      price: 5,
    });
    const optionTr = db.seed('additional_product_translation', {
      additional_product_id: option.id,
      lang: 'ru',
      title: `${name} ketchup`,
    });
    return {
      org,
      category,
      categoryTr,
      product,
      productTr,
      image,
      group,
      groupTr,
      option,
      optionTr,
    };
  };
  return { mine: make('Mine'), theirs: make('Theirs') };
}
