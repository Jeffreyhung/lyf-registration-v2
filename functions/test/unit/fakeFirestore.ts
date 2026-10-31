/**
 * A tiny in-memory stand-in for the parts of the Firestore Admin SDK that the
 * registration helpers touch: collection()/doc() navigation (including
 * sub-collections and parent links), where(...).get(), listDocuments(), and
 * document snapshots with id/ref/exists/data(). It is deliberately minimal;
 * add behaviour here only when a test needs it.
 *
 * Collections are addressed by their full path ("families/f1/campers"), so a
 * sub-collection is just a collection whose name contains slashes.
 *
 * Top-level FieldValue sentinels (serverTimestamp, arrayUnion, arrayRemove,
 * increment, delete) are applied on write the way the server would, so a
 * test can assert on the resulting document instead of on sentinel objects.
 *
 * runTransaction() runs the callback once against the store directly (no
 * isolation, no retries); it exists so code that reads-then-writes inside a
 * transaction can be exercised, not to test concurrency.
 */
import {FieldValue, Timestamp} from "firebase-admin/firestore";
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

// Admin SDK sentinels are `*Transform` subclasses of FieldValue exposing a
// `methodName` getter ("FieldValue.arrayUnion", ...); array transforms carry
// `elements` and the increment transform carries `operand`.
type Sentinel = {
  methodName?: string;
  elements?: unknown[];
  operand?: number;
};

function sentinelKind(value: unknown): string | null {
  if (value === null || typeof value !== "object") return null;
  const name = (value as Sentinel).methodName;
  return typeof name === "string" && name.startsWith("FieldValue.") ?
    name.slice("FieldValue.".length) :
    null;
}

/** DocumentReferences compare by path; everything else by identity/value. */
function sameElement(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  const pathA = (a as {path?: unknown})?.path;
  const pathB = (b as {path?: unknown})?.path;
  return typeof pathA === "string" && pathA === pathB;
}

/** Apply `data` on top of `existing`, resolving top-level sentinels. */
function applyWrite(existing: DocData, data: DocData): DocData {
  const out: DocData = {...existing};
  for (const [key, value] of Object.entries(data)) {
    const kind = sentinelKind(value);
    if (kind === null && value instanceof FieldValue) {
      // sentinelKind reads private SDK fields; fail loudly if the SDK's
      // transform shape changes instead of storing the sentinel object raw.
      throw new Error(
        `FakeFirestore cannot interpret the FieldValue written to "${key}"`
      );
    }
    const current = out[key];
    switch (kind) {
      case null:
        out[key] = value;
        break;
      case "serverTimestamp":
        out[key] = Timestamp.now();
        break;
      case "delete":
        delete out[key];
        break;
      case "increment":
        out[key] =
          (typeof current === "number" ? current : 0) +
          ((value as Sentinel).operand ?? 0);
        break;
      case "arrayUnion": {
        const arr = Array.isArray(current) ? [...current] : [];
        for (const el of (value as Sentinel).elements ?? []) {
          if (!arr.some((x) => sameElement(x, el))) arr.push(el);
        }
        out[key] = arr;
        break;
      }
      case "arrayRemove": {
        const arr = Array.isArray(current) ? current : [];
        const remove = (value as Sentinel).elements ?? [];
        out[key] = arr.filter((x) => !remove.some((el) => sameElement(x, el)));
        break;
      }
      default:
        throw new Error(`FakeFirestore does not support FieldValue.${kind}`);
    }
  }
  return out;
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
      applyWrite(options?.merge ? existing : {}, data)
    );
  }

  async update(data: DocData) {
    const existing = this.db.read(this.collectionName, this.id);
    if (existing === undefined) {
      throw new Error(`No document to update: ${this.path}`);
    }
    this.db.write(this.collectionName, this.id, applyWrite(existing, data));
  }

  /** Like the SDK, fails with gRPC ALREADY_EXISTS (6) when the doc exists. */
  async create(data: DocData) {
    if (this.db.read(this.collectionName, this.id) !== undefined) {
      const err = new Error(`Document already exists: ${this.path}`) as Error & {
        code: number;
      };
      err.code = 6;
      throw err;
    }
    this.db.write(this.collectionName, this.id, applyWrite({}, data));
  }

  async delete() {
    this.db.remove(this.collectionName, this.id);
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

/** Anything with a get(): a document ref or a (collection) query. */
type Gettable = {get: () => Promise<unknown>};

/** The subset of Transaction the registration code uses. */
export class FakeTransaction {
  constructor(private readonly db: FakeFirestore) {}

  get<T extends Gettable>(refOrQuery: T): ReturnType<T["get"]> {
    return refOrQuery.get() as ReturnType<T["get"]>;
  }

  getAll(...refs: FakeDocRef[]) {
    return this.db.getAll(...refs);
  }

  set(ref: FakeDocRef, data: DocData, options?: {merge?: boolean}): this {
    void ref.set(data, options);
    return this;
  }

  update(ref: FakeDocRef, data: DocData): this {
    void ref.update(data);
    return this;
  }

  delete(ref: FakeDocRef): this {
    void ref.delete();
    return this;
  }
}

export class FakeFirestore {
  private readonly store = new Map<string, Map<string, DocData>>();
  private counter = 0;

  async getAll(...refs: FakeDocRef[]) {
    return Promise.all(refs.map((ref) => ref.get()));
  }

  async runTransaction<T>(fn: (t: FakeTransaction) => Promise<T>): Promise<T> {
    return fn(new FakeTransaction(this));
  }

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

  remove(collectionName: string, id: string): void {
    this.store.get(collectionName)?.delete(id);
  }

  entries(collectionName: string): Iterable<[string, DocData]> {
    return this.store.get(collectionName)?.entries() ?? [];
  }

  /** Every document in a collection, as {id, data} in insertion order. */
  all(collectionName: string): {id: string; data: DocData}[] {
    return [...this.entries(collectionName)].map(([id, data]) => ({id, data}));
  }

  /** Typed view for passing into code under test. */
  as(): Firestore {
    return this as unknown as Firestore;
  }
}
