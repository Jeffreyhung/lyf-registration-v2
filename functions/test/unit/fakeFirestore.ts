/**
 * A tiny in-memory stand-in for the parts of the Firestore Admin SDK that
 * findOrCreateFamily touches: collection().where().get(), collection().doc(),
 * and document snapshots with id/ref/data(). It is deliberately minimal; add
 * behaviour here only when a test needs it.
 */
type DocData = Record<string, unknown>;

type WhereClause = {field: string; op: string; value: unknown};

export class FakeDocRef {
  constructor(
    private readonly db: FakeFirestore,
    public readonly collectionName: string,
    public readonly id: string
  ) {}

  get path(): string {
    return `${this.collectionName}/${this.id}`;
  }

  async get() {
    const data = this.db.read(this.collectionName, this.id);
    return {
      id: this.id,
      ref: this,
      exists: data !== undefined,
      data: () => data,
    };
  }

  async set(data: DocData, options?: {merge?: boolean}) {
    const existing = this.db.read(this.collectionName, this.id) ?? {};
    this.db.write(
      this.collectionName,
      this.id,
      options?.merge ? {...existing, ...data} : {...data}
    );
  }

  async update(data: DocData) {
    const existing = this.db.read(this.collectionName, this.id);
    if (existing === undefined) {
      throw new Error(`No document to update: ${this.path}`);
    }
    this.db.write(this.collectionName, this.id, {...existing, ...data});
  }
}

class FakeQuery {
  constructor(
    private readonly db: FakeFirestore,
    private readonly collectionName: string,
    private readonly clauses: WhereClause[]
  ) {}

  where(field: string, op: string, value: unknown): FakeQuery {
    return new FakeQuery(this.db, this.collectionName, [
      ...this.clauses,
      {field, op, value},
    ]);
  }

  async get() {
    const docs = [...this.db.entries(this.collectionName)]
      .filter(([, data]) => this.clauses.every((c) => matches(data, c)))
      .map(([id, data]) => ({
        id,
        ref: new FakeDocRef(this.db, this.collectionName, id),
        exists: true,
        data: () => data,
      }));
    return {docs, size: docs.length, empty: docs.length === 0};
  }
}

function matches(data: DocData, {field, op, value}: WhereClause): boolean {
  const actual = data[field];
  switch (op) {
    case "==":
      return actual === value;
    case "array-contains":
      return Array.isArray(actual) && actual.includes(value);
    default:
      throw new Error(`FakeFirestore does not support operator "${op}"`);
  }
}

class FakeCollection extends FakeQuery {
  constructor(
    private readonly fakeDb: FakeFirestore,
    private readonly name: string
  ) {
    super(fakeDb, name, []);
  }

  doc(id?: string): FakeDocRef {
    return new FakeDocRef(this.fakeDb, this.name, id ?? this.fakeDb.nextId());
  }
}

export class FakeFirestore {
  private readonly store = new Map<string, Map<string, DocData>>();
  private counter = 0;

  /** Puts a document in place, replacing anything already there. */
  seed(collectionName: string, id: string, data: DocData): this {
    this.write(collectionName, id, data);
    return this;
  }

  collection(name: string): FakeCollection {
    return new FakeCollection(this, name);
  }

  nextId(): string {
    this.counter += 1;
    return `generated-${this.counter}`;
  }

  read(collectionName: string, id: string): DocData | undefined {
    return this.store.get(collectionName)?.get(id);
  }

  write(collectionName: string, id: string, data: DocData): void {
    if (!this.store.has(collectionName)) {
      this.store.set(collectionName, new Map());
    }
    this.store.get(collectionName)!.set(id, data);
  }

  entries(collectionName: string): Iterable<[string, DocData]> {
    return this.store.get(collectionName)?.entries() ?? [];
  }
}
