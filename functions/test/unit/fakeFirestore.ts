/**
 * A tiny in-memory stand-in for the parts of the Firestore Admin SDK that the
 * registration helpers touch: collection()/doc() navigation (including
 * sub-collections and parent links), where(...).get(), listDocuments(), and
 * document snapshots with id/ref/exists/data(). It is deliberately minimal;
 * add behaviour here only when a test needs it.
 *
 * Collections are addressed by their full path ("families/f1/campers"), so a
 * sub-collection is just a collection whose name contains slashes.
 */
import type {
  CollectionReference,
  DocumentReference,
  Firestore,
} from "firebase-admin/firestore";

type DocData = Record<string, unknown>;

type WhereClause = {field: string; op: string; value: unknown};

function splitPath(path: string): {parent: string | null; last: string} {
  const i = path.lastIndexOf("/");
  return i === -1 ?
    {parent: null, last: path} :
    {parent: path.slice(0, i), last: path.slice(i + 1)};
}

export class FakeDocRef {
  constructor(
    private readonly db: FakeFirestore,
    public readonly collectionName: string,
    public readonly id: string
  ) {}

  get path(): string {
    return `${this.collectionName}/${this.id}`;
  }

  /** The collection this document lives in. */
  get parent(): FakeCollection {
    return new FakeCollection(this.db, this.collectionName);
  }

  collection(name: string): FakeCollection {
    return new FakeCollection(this.db, `${this.path}/${name}`);
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

  /** Typed view for passing into code under test. */
  as<T = DocData>(): DocumentReference<T> {
    return this as unknown as DocumentReference<T>;
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

export class FakeCollection extends FakeQuery {
  constructor(
    private readonly fakeDb: FakeFirestore,
    private readonly name: string
  ) {
    super(fakeDb, name, []);
  }

  get path(): string {
    return this.name;
  }

  get id(): string {
    return splitPath(this.name).last;
  }

  /** The document this collection hangs off, or null for a root collection. */
  get parent(): FakeDocRef | null {
    const {parent} = splitPath(this.name);
    if (parent === null) return null;
    const doc = splitPath(parent);
    return new FakeDocRef(this.fakeDb, doc.parent!, doc.last);
  }

  doc(id?: string): FakeDocRef {
    return new FakeDocRef(this.fakeDb, this.name, id ?? this.fakeDb.nextId());
  }

  async listDocuments(): Promise<FakeDocRef[]> {
    return [...this.fakeDb.entries(this.name)].map(
      ([id]) => new FakeDocRef(this.fakeDb, this.name, id)
    );
  }

  /** Typed view for passing into code under test. */
  as<T = DocData>(): CollectionReference<T> {
    return this as unknown as CollectionReference<T>;
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

  /** A document by full path, e.g. "families/f1/campers/c1". */
  doc(path: string): FakeDocRef {
    const {parent, last} = splitPath(path);
    if (parent === null) {
      throw new Error(`Document path must have an even number of segments: ${path}`);
    }
    return new FakeDocRef(this, parent, last);
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

  /** Typed view for passing into code under test. */
  as(): Firestore {
    return this as unknown as Firestore;
  }
}
