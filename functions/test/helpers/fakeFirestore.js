"use strict";

// Firestore de mentira para las pruebas de la vigilancia del almacenamiento:
// documentos en un Map por ruta, con lo que usa ese codigo (get, set con
// merge, create que falla si ya existe, consultas con where/orderBy/limit,
// listDocuments y transacciones simples). Cuenta lecturas y escrituras.

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function deepMerge(target, source) {
  const out = isPlainObject(target) ? { ...target } : {};

  Object.entries(source || {}).forEach(([key, value]) => {
    out[key] = isPlainObject(value) && isPlainObject(out[key])
      ? deepMerge(out[key], value)
      : value;
  });

  return out;
}

function getField(data, field) {
  return String(field).split(".").reduce((value, key) => value?.[key], data);
}

function compare(a, b) {
  if (typeof a === "number" && typeof b === "number") return a - b;

  // Firestore ordena los textos por bytes, no por idioma.
  const left = String(a);
  const right = String(b);

  return left < right ? -1 : left > right ? 1 : 0;
}

function fakeFirestore(seed = {}) {
  const docs = new Map(Object.entries(seed));
  const stats = { reads: 0, writes: 0 };
  let autoIds = 0;

  const snapshotOf = docPath => {
    const exists = docs.has(docPath);
    const value = docs.get(docPath);

    return {
      id: docPath.split("/").pop(),
      ref: { path: docPath },
      exists,
      data: () => (exists ? structuredClone(value) : undefined)
    };
  };

  const childrenOf = collectionPath => [...docs.keys()].filter(key =>
    key.startsWith(`${collectionPath}/`) &&
    !key.slice(collectionPath.length + 1).includes("/"));

  function docRef(docPath) {
    return {
      id: docPath.split("/").pop(),
      path: docPath,
      async get() {
        stats.reads++;
        return snapshotOf(docPath);
      },
      async set(value, options = {}) {
        stats.writes++;
        docs.set(docPath, options.merge ? deepMerge(docs.get(docPath), value) : structuredClone(value));
      },
      async create(value) {
        if (docs.has(docPath)) {
          const error = new Error(`6 ALREADY_EXISTS: Document already exists: ${docPath}`);

          error.code = 6;
          throw error;
        }
        stats.writes++;
        docs.set(docPath, structuredClone(value));
      },
      collection: name => collection(`${docPath}/${name}`),
      // Subcolecciones con algun documento (como el Admin SDK).
      async listCollections() {
        const names = new Set(
          [...docs.keys()]
            .filter(key => key.startsWith(`${docPath}/`))
            .map(key => key.slice(docPath.length + 1).split("/")[0])
        );

        return [...names].map(name => collection(`${docPath}/${name}`));
      }
    };
  }

  function collection(collectionPath) {
    const make = state => ({
      // Sin id, uno automatico (como el Admin SDK).
      doc: (id = `auto${++autoIds}`) => docRef(`${collectionPath}/${id}`),
      where(field, op, value) {
        return make({ ...state, filters: [...state.filters, { field, op, value }] });
      },
      orderBy(field, direction = "asc") {
        // FieldPath.documentId() se ordena por el id del documento.
        const byName = String(field) === "__name__";

        return make({ ...state, order: { field: byName ? "__name__" : field, direction } });
      },
      startAfter(value) {
        return make({ ...state, after: value });
      },
      limit(count) {
        return make({ ...state, max: count });
      },
      async get() {
        let rows = childrenOf(collectionPath).map(snapshotOf);

        state.filters.forEach(({ field, op, value }) => {
          rows = rows.filter(row => {
            const current = getField(row.data(), field);

            if (op === "==") return current === value;
            if (current === undefined || current === null) return false;
            if (op === "<") return compare(current, value) < 0;
            if (op === "<=") return compare(current, value) <= 0;
            if (op === ">") return compare(current, value) > 0;
            if (op === ">=") return compare(current, value) >= 0;
            throw new Error(`operador no soportado: ${op}`);
          });
        });
        if (state.order) {
          const { field, direction } = state.order;
          const valueOf = row => (field === "__name__" ? row.id : getField(row.data(), field));

          rows = rows.filter(row => valueOf(row) !== undefined);
          rows.sort((a, b) => compare(valueOf(a), valueOf(b)));
          if (direction === "desc") rows.reverse();
          if (state.after !== undefined) {
            rows = rows.filter(row => direction === "desc"
              ? compare(valueOf(row), state.after) < 0
              : compare(valueOf(row), state.after) > 0);
          }
        }
        rows = rows.slice(0, state.max);
        stats.reads += Math.max(1, rows.length);

        return {
          empty: !rows.length,
          size: rows.length,
          docs: rows,
          forEach: fn => rows.forEach(fn)
        };
      },
      path: collectionPath,
      id: collectionPath.split("/").pop(),
      async listDocuments() {
        const ids = new Set(
          [...docs.keys()]
            .filter(key => key.startsWith(`${collectionPath}/`))
            .map(key => key.slice(collectionPath.length + 1).split("/")[0])
        );

        return [...ids].map(id => docRef(`${collectionPath}/${id}`));
      }
    });

    return make({ filters: [], order: null, after: undefined, max: Infinity });
  }

  // Transacciones en serie: suficiente para probar el candado (cada
  // transaccion lee y escribe sin intercalarse con otra).
  let queue = Promise.resolve();

  function runTransaction(fn) {
    const run = queue.then(async () => {
      const writes = [];
      const result = await fn({
        get: ref => ref.get(),
        set: (ref, value, options) => writes.push(() => ref.set(value, options))
      });

      for (const write of writes) await write();

      return result;
    });

    queue = run.catch(() => {});

    return run;
  }

  // Borra una coleccion con todo lo que cuelga de ella.
  async function recursiveDelete(collectionRef) {
    const prefix = `${collectionRef.path}/`;

    [...docs.keys()].filter(key => key.startsWith(prefix)).forEach(key => {
      stats.writes++;
      docs.delete(key);
    });
  }

  return {
    docs,
    stats,
    collection,
    doc: docRef,
    runTransaction,
    recursiveDelete
  };
}

module.exports = { fakeFirestore };
