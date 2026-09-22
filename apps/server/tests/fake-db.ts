/**
 * In-memory stand-in for the JSON Server gateway. It implements the same surface
 * as `db.service`, so the API and socket tests exercise the real controllers,
 * services and engine without needing a running JSON Server or touching db.json.
 */
type Row = Record<string, unknown> & { id: string };

export function createFakeDb() {
  const store = new Map<string, Row[]>();

  const rows = (collection: string): Row[] => {
    if (!store.has(collection)) store.set(collection, []);
    return store.get(collection)!;
  };

  const matches = (row: Row, params: Record<string, unknown>) =>
    Object.entries(params)
      .filter(([key]) => !key.startsWith('_'))
      .every(([key, value]) => String(row[key]) === String(value));

  const db = {
    async list(collection: string, params: Record<string, unknown> = {}) {
      let result = rows(collection).filter((row) => matches(row, params));
      const sort = params._sort as string | undefined;
      if (sort) {
        const desc = params._order === 'desc';
        result = [...result].sort((a, b) =>
          desc ? String(b[sort]).localeCompare(String(a[sort])) : String(a[sort]).localeCompare(String(b[sort])),
        );
      }
      const limit = params._limit ? Number(params._limit) : undefined;
      return structuredClone(limit ? result.slice(0, limit) : result);
    },
    async findById(collection: string, id: string) {
      const row = rows(collection).find((candidate) => candidate.id === id);
      return row ? structuredClone(row) : null;
    },
    async findOne(collection: string, query: Record<string, unknown>) {
      const row = rows(collection).find((candidate) => matches(candidate, query));
      return row ? structuredClone(row) : null;
    },
    async create(collection: string, record: Row) {
      rows(collection).push(structuredClone(record));
      return structuredClone(record);
    },
    async update(collection: string, id: string, patch: Record<string, unknown>) {
      const list = rows(collection);
      const index = list.findIndex((row) => row.id === id);
      if (index === -1) throw new Error(`${collection}/${id} not found`);
      list[index] = { ...list[index], ...structuredClone(patch) };
      return structuredClone(list[index]);
    },
    async replace(collection: string, record: Row) {
      const list = rows(collection);
      const index = list.findIndex((row) => row.id === record.id);
      if (index === -1) throw new Error(`${collection}/${record.id} not found`);
      list[index] = structuredClone(record);
      return structuredClone(record);
    },
    async remove(collection: string, id: string) {
      const list = rows(collection);
      const index = list.findIndex((row) => row.id === id);
      if (index >= 0) list.splice(index, 1);
    },
    async ping() {
      return true;
    },
    /* test helpers */
    __reset() {
      store.clear();
    },
    __rows(collection: string) {
      return structuredClone(rows(collection));
    },
  };

  return db;
}

export type FakeDb = ReturnType<typeof createFakeDb>;
